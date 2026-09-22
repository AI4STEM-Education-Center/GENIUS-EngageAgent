"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UserContext } from "@/lib/auth";
import StudentQuizView from "./StudentQuizView";
import StudentContentReviewView from "./StudentContentReviewView";
import StudentContentRatingView from "./StudentContentRatingView";
import StudentProgressStepper from "./StudentProgressStepper";
import {
  STUDENT_STEPS,
  type StepDisplayState,
  type StepProgress,
  type StudentStepId,
} from "@/lib/student-progress";
import type { ActivityStatus } from "@/lib/activity-status";

type Props = {
  user: UserContext;
};

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
function buildDisplayStates(
  serverStatus: Record<StudentStepId, ActivityStatus>,
  progress: Record<StudentStepId, StepProgress>,
): Record<StudentStepId, StepDisplayState> {
  const statusFor = (id: StudentStepId) => {
    if (serverStatus[id] === "locked") return "locked" as const;
    if (serverStatus[id] === "completed" || progress[id].kind === "completed") return "completed" as const;
    return "active" as const;
  };

  const assessmentStatus = statusFor("assessment");
  const reviewStatus = statusFor("content-review");
  const ratingStatus = statusFor("content-rating");

  return {
    assessment: {
      status: assessmentStatus,
      label: assessmentStatus === "completed" ? "Completed" : assessmentStatus === "active" ? "In progress" : "Not available yet",
    },
    "content-review": {
      status: reviewStatus,
      label: reviewStatus === "completed" ? "Completed" : reviewStatus === "active" ? "In progress" : "Not available yet",
    },
    "content-rating": {
      status: ratingStatus,
      label: ratingStatus === "completed" ? "Completed" : ratingStatus === "active" ? "In progress" : "Not available yet",
    },
  };
}

export default function StudentView({ user }: Props) {
  const [activeStep, setActiveStep] = useState<StudentStepId>("assessment");
  const [progress, setProgress] = useState<Record<StudentStepId, StepProgress>>(INITIAL_PROGRESS);
  const [serverStatus, setServerStatus] = useState<Record<StudentStepId, ActivityStatus>>(INITIAL_SERVER_STATUS);
  const activeStepRef = useRef(activeStep);
  useEffect(() => {
    activeStepRef.current = activeStep;
  }, [activeStep]);

  const classId = user.classId;
  const assignmentId = user.assignmentId;
  const studentId = user.userId;

  // Bumped whenever a child reports a step just completed, to re-poll the
  // authoritative server status. The fetch lives inside the effect (rather
  // than a shared callback also invoked from an event handler) so this stays
  // a plain "synchronize with an external system" effect.
  const [statusRefreshToken, setStatusRefreshToken] = useState(0);

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
        setServerStatus(next);

        // Auto-advance to the next step only right as it newly unlocks, so
        // revisiting an already-completed step doesn't bounce the student away.
        const currentIndex = STUDENT_STEPS.findIndex((step) => step.id === activeStepRef.current);
        if (next[activeStepRef.current] === "completed" && currentIndex < STUDENT_STEPS.length - 1) {
          const nextStepId = STUDENT_STEPS[currentIndex + 1].id;
          if (next[nextStepId] !== "locked") {
            setActiveStep(nextStepId);
          }
        }
      } catch {
        // Best-effort -- children's own onProgress callbacks still drive same-session UI.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [classId, assignmentId, studentId, statusRefreshToken]);

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
    if (next.kind === "completed") {
      setStatusRefreshToken((token) => token + 1);
    }
  }, []);

  const displayStates = buildDisplayStates(serverStatus, progress);

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

        <StudentProgressStepper activeStep={activeStep} states={displayStates} onSelectStep={setActiveStep} />

        {/* All three step views stay mounted (hidden when inactive) so each
            keeps polling/reporting its own progress regardless of which tab
            is currently visible. */}
        <div className={activeStep === "assessment" ? "" : "hidden"}>
          <StudentQuizView user={user} onProgress={(p) => reportProgress("assessment", p)} />
        </div>
        <div className={activeStep === "content-review" ? "" : "hidden"}>
          <StudentContentReviewView user={user} onProgress={(p) => reportProgress("content-review", p)} />
        </div>
        <div className={activeStep === "content-rating" ? "" : "hidden"}>
          <StudentContentRatingView user={user} onProgress={(p) => reportProgress("content-rating", p)} />
        </div>
      </div>
    </div>
  );
}
