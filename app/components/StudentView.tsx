"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UserContext } from "@/lib/auth";
import StudentQuizView from "./StudentQuizView";
import StudentContentReviewView from "./StudentContentReviewView";
import StudentProgressStepper from "./StudentProgressStepper";
import {
  STUDENT_VIEW_STEPS,
  type StepDisplayState,
  type StepProgress,
  type StudentStepId,
  type StudentViewStepId,
} from "@/lib/student-progress";
import type { ActivityStatus } from "@/lib/activity-status";
import { notifyTaskCompleted } from "@/lib/genius-notify";

type Props = {
  user: UserContext;
};

const STATUS_POLL_MS = 15000;

const INITIAL_PROGRESS: Record<StudentStepId, StepProgress> = {
  assessment: { kind: "not-available" },
  "content-review": { kind: "not-available" },
  "content-rating": { kind: "not-available" },
};

const INITIAL_SERVER_STATUS: Record<StudentStepId, ActivityStatus> = {
  assessment: "locked",
  "content-review": "locked",
  "content-rating": "locked",
};

// The server (`/api/activity-status`, backed by `lib/activity-status.ts`) is
// the source of truth for whether a step is locked, since it alone knows the
// real cross-step dependencies (e.g. content-rating requires content-review
// to be complete). Child self-reports via `onProgress` are only trusted to
// flip an already-unlocked step to "completed" instantly, without waiting on
// a server round trip.
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
  progress: Record<StudentStepId, StepProgress>,
): Record<StudentViewStepId, StepDisplayState> {
  const activityStatusFor = (id: StudentStepId) => {
    if (serverStatus[id] === "locked") return "locked" as const;
    if (serverStatus[id] === "completed" || progress[id].kind === "completed") return "completed" as const;
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

export default function StudentView({ user }: Props) {
  const [activeStep, setActiveStep] = useState<StudentViewStepId>("assessment");
  const [progress, setProgress] = useState<Record<StudentStepId, StepProgress>>(INITIAL_PROGRESS);
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
  // Status is polled, so only report completion to GENIUS once per page load.
  const notifiedCompletionRef = useRef(false);

  useEffect(() => {
    if (!classId || !assignmentId || !studentId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/activity-status?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&studentId=${encodeURIComponent(studentId)}`,
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
        // Best-effort -- children's own onProgress callbacks still drive same-session UI.
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
    setProgress((prev) => ({ ...prev, [step]: next }));
    // Any transition (e.g. content-review seeing newly published material, or
    // a step completing) is a hint the server status changed -- re-poll now
    // rather than waiting for the next tick.
    setStatusRefreshToken((token) => token + 1);
  }, []);

  const displayStates = buildDisplayStates(serverStatus, progress);
  const availableSteps = STUDENT_VIEW_STEPS.filter((step) => displayStates[step.id].status !== "locked");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Engage Agent
            </p>
            <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-sky-700">
              Student
            </span>
          </div>
          <p className="text-sm text-slate-500">
            Welcome, <span className="font-semibold text-slate-700">{user.name}</span>
          </p>
        </header>

        <StudentProgressStepper
          steps={STUDENT_VIEW_STEPS}
          activeStep={activeStep}
          states={displayStates}
          onSelectStep={setActiveStep}
          completedSteps={availableSteps.filter((step) => displayStates[step.id].status === "completed").length}
          totalSteps={availableSteps.length}
        />

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
    </div>
  );
}
