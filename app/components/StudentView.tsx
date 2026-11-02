"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Users } from "lucide-react";
import { scopedClientAuthHeaders } from "@/lib/client-auth";
import type { UserContext } from "@/lib/auth";
import StudentQuizView from "./StudentQuizView";
import StudentContentReviewView from "./StudentContentReviewView";
import AppFrame from "./layout/AppFrame";
import AppHeader, { taskContext, type TaskShell } from "./layout/AppHeader";
import StepTabs, { type StepTab } from "./layout/StepTabs";
import { studentNavActions } from "./layout/studentNav";
import {
  STUDENT_VIEW_STEPS,
  type StepDisplayState,
  type StepProgress,
  type StudentStepId,
  type StudentViewStepId,
} from "@/lib/student-progress";
import type { ActivityStatus } from "@/lib/activity-status";
import { notifyTaskCompleted, notifyTaskReopened } from "@/lib/genius-notify";

type Props = {
  user: UserContext;
  shell?: TaskShell;
};

// Class questions and the quiz report are built in #182; until then they show locked.
type StudentTabId = StudentViewStepId | "class-questions" | "report";

const STATUS_POLL_MS = 15000;

const INITIAL_SERVER_STATUS: Record<StudentStepId, ActivityStatus> = {
  assessment: "locked",
  "content-review": "locked",
  "content-rating": "locked",
};

// The server (`/api/activity-status`, backed by `lib/activity-status.ts`) is
// the source of truth for whether a step is locked, since it alone knows the
// real cross-step dependencies and newly published material. Child progress
// reports request an immediate refresh; they never override newer server status.
//
// The stepper only shows two steps to students -- Content Review and
// Material Rating are grouped into one "Explore and ask" step (Material
// Rating is a card below the questions, locked until they're submitted,
// not its own tab) -- so a view step's status is derived from the real activities it
// groups (STUDENT_VIEW_STEPS[].activityIds). Whether the *group* is locked
// follows only its first/primary activity (content-review): Material
// Rating being internally "locked" until the review is done is expected
// and must not re-lock the whole step once content-review itself is open.
function buildDisplayStates(
  serverStatus: Record<StudentStepId, ActivityStatus>,
): Record<StudentViewStepId, StepDisplayState> {
  const activityStatusFor = (id: StudentStepId) => {
    if (serverStatus[id] === "locked") return "locked" as const;
    if (serverStatus[id] === "completed") return "completed" as const;
    return "active" as const;
  };

  const result = {} as Record<StudentViewStepId, StepDisplayState>;
  for (const step of STUDENT_VIEW_STEPS) {
    const [primaryActivityId] = step.activityIds;
    const allCompleted = step.activityIds.every((id) => activityStatusFor(id) === "completed");
    const status =
      activityStatusFor(primaryActivityId) === "locked"
        ? ("locked" as const)
        : allCompleted
          ? ("completed" as const)
          : ("active" as const);

    result[step.id] = {
      status,
      label: status === "completed" ? "Completed" : status === "active" ? "In progress" : "Not available yet",
    };
  }
  return result;
}

function StudentWorkspace({ user, shell }: Props) {
  const [activeStep, setActiveStep] = useState<StudentViewStepId>("assessment");
  const [serverStatus, setServerStatus] = useState<Record<StudentStepId, ActivityStatus>>(INITIAL_SERVER_STATUS);
  const activeStepRef = useRef(activeStep);
  useEffect(() => {
    activeStepRef.current = activeStep;
  }, [activeStep]);

  const classId = user.classId;
  const assignmentId = user.assignmentId;
  const studentId = user.userId;

  // Bumped to re-poll the authoritative server status: whenever a child
  // reports a progress change, on a timer, and when the tab regains focus --
  // so a step unlocks without a reload once the teacher publishes (#109).
  // The fetch lives inside the effect (rather than a shared callback also
  // invoked from an event handler) so this stays a plain "synchronize with
  // an external system" effect.
  const [statusRefreshToken, setStatusRefreshToken] = useState(0);

  useEffect(() => {
    if (!classId || !assignmentId || !studentId) return;

    const refreshStatus = () => setStatusRefreshToken((token) => token + 1);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshStatus();
    };

    const intervalId = window.setInterval(refreshStatus, STATUS_POLL_MS);
    window.addEventListener("focus", refreshStatus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshStatus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [classId, assignmentId, studentId]);

  // The previous poll's statuses (null before the first one), so auto-advance
  // can tell a step that *just* unlocked from one that was already open.
  const prevServerStatusRef = useRef<Record<StudentStepId, ActivityStatus> | null>(null);
  // Notify once per completion transition; a new publication can reopen work.
  const notifiedCompletionRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!classId || !assignmentId || !studentId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/activity-status?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&studentId=${encodeURIComponent(studentId)}`,
          { headers: scopedClientAuthHeaders({ classId, assignmentId }), cache: "no-store" },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { activities?: { id: StudentStepId; status: ActivityStatus }[] };
        if (!data.activities || cancelled) return;

        const next = { ...INITIAL_SERVER_STATUS };
        for (const activity of data.activities) {
          next[activity.id] = activity.status;
        }
        const prev = prevServerStatusRef.current;
        prevServerStatusRef.current = next;
        setServerStatus(next);

        // The last real job is Material Rating -- report task completion to
        // GENIUS once it's done, not at quiz submission (#98).
        if (next["content-rating"] !== "completed" && notifiedCompletionRef.current !== false) {
          notifiedCompletionRef.current = false;
          notifyTaskReopened(classId, assignmentId, user.geniusId);
        }
        if (next["content-rating"] === "completed" && !notifiedCompletionRef.current) {
          notifiedCompletionRef.current = true;
          notifyTaskCompleted(classId, assignmentId, user.geniusId);
        }

        // Open published material when the current activity is unavailable.
        // A student already working in an available activity keeps that view.
        const currentIndex = STUDENT_VIEW_STEPS.findIndex((step) => step.id === activeStepRef.current);
        const currentStep = STUDENT_VIEW_STEPS[currentIndex];
        if (next[currentStep.activityIds[0]] === "locked") {
          const availableStep = STUDENT_VIEW_STEPS.find((step) => next[step.activityIds[0]] !== "locked");
          if (availableStep) setActiveStep(availableStep.id);
          return;
        }

        // Auto-advance to the next step only on the first load or right as it
        // newly unlocks (or the current step newly completes), so revisiting
        // an already-completed step doesn't bounce the student away on the
        // next poll.
        const isDone = (status: Record<StudentStepId, ActivityStatus>) =>
          STUDENT_VIEW_STEPS[currentIndex].activityIds.every((id) => status[id] === "completed");
        if (isDone(next) && currentIndex < STUDENT_VIEW_STEPS.length - 1) {
          const nextStep = STUDENT_VIEW_STEPS[currentIndex + 1];
          const isOpen = (status: Record<StudentStepId, ActivityStatus>) =>
            status[nextStep.activityIds[0]] !== "locked";
          const justBecameReady = !prev || !isDone(prev) || !isOpen(prev);
          if (isOpen(next) && justBecameReady) {
            setActiveStep(nextStep.id);
          }
        }
      } catch {
        // Leave the last verified status in place and retry on the next poll/focus.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [classId, assignmentId, studentId, statusRefreshToken, user.geniusId]);

  // Children re-create their `onProgress` closure on every StudentView render
  // (it's an inline arrow in the JSX below) and re-report their current kind
  // whenever that happens, not just on real transitions. Tracking the last
  // reported kind per step here -- and bailing out before touching state when
  // it's unchanged -- is what keeps that from cascading into a render loop.
  const lastReportedKindRef = useRef<Record<StudentStepId, StepProgress["kind"]>>({
    assessment: "not-available",
    "content-review": "not-available",
    "content-rating": "not-available",
  });

  const reportProgress = useCallback((step: StudentStepId, next: StepProgress) => {
    if (lastReportedKindRef.current[step] === next.kind) return;
    lastReportedKindRef.current[step] = next.kind;
    // Any transition (e.g. content-review seeing newly published material, or
    // a step completing) is a hint the server status changed -- re-poll now
    // rather than waiting for the next tick.
    setStatusRefreshToken((token) => token + 1);
  }, []);

  const displayStates = buildDisplayStates(serverStatus);
  const tabs: StepTab<StudentTabId>[] = [
    ...STUDENT_VIEW_STEPS.map((step, index) => ({
      id: step.id,
      title: step.title,
      status: displayStates[step.id].label,
      marker: index + 1,
      done: displayStates[step.id].status === "completed",
      locked: displayStates[step.id].status === "locked",
    })),
    { id: "class-questions", title: "Class questions", status: "Your teacher will share these", marker: <Users size={13} />, locked: true },
    { id: "report", title: "My quiz report", status: "After the lesson", marker: <FileText size={13} />, locked: true },
  ];

  return (
    <AppFrame narrow
      header={<AppHeader userName={user.name} homeHref={shell?.homeHref} context={taskContext(user, shell)} canSignOut={shell?.canSignOut} showName
        actions={studentNavActions({ homeHref: shell?.homeHref, classHref: shell?.classHref })} />}
      tabs={<StepTabs label="Student steps" tabs={tabs} activeId={activeStep}
        onSelect={(id) => { if (id === "assessment" || id === "explore-and-ask") setActiveStep(id); }} />}>
      <div className="flex flex-col gap-6">
        {/* The assessment and content-review views stay mounted (hidden when
            inactive) so they keep polling/reporting progress regardless of
            which tab is visible. Material Rating is a card below the review
            questions, locked until they're submitted (#101, #110), rather
            than its own tab or a second copy of the material. */}
        <div className={activeStep === "assessment" ? "" : "hidden"}>
          <StudentQuizView user={user} onProgress={(p) => reportProgress("assessment", p)} />
        </div>
        <div className={activeStep === "explore-and-ask" ? "flex flex-col gap-6" : "hidden"}>
          <StudentContentReviewView
            user={user}
            onProgress={(p) => reportProgress("content-review", p)}
            ratingUnlocked={serverStatus["content-review"] === "completed"}
            onRatingProgress={(p) => reportProgress("content-rating", p)}
          />
        </div>
      </div>
    </AppFrame>
  );
}

export default function StudentView(props: Props) {
  return <StudentWorkspace key={JSON.stringify([props.user.geniusId, props.user.classId, props.user.assignmentId])} {...props} />;
}
