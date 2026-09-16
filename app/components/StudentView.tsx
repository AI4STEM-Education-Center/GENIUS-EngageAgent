"use client";

import { useCallback, useMemo, useState } from "react";
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

type Props = {
  user: UserContext;
};

const INITIAL_PROGRESS: Record<StudentStepId, StepProgress> = {
  assessment: { kind: "not-available" },
  "content-review": { kind: "not-available" },
  "content-rating": { kind: "not-available" },
};

function buildDisplayStates(
  progress: Record<StudentStepId, StepProgress>,
): Record<StudentStepId, StepDisplayState> {
  const assessment = progress.assessment;
  const assessmentStatus = assessment.kind === "completed" ? "completed" : assessment.kind === "active" ? "active" : "locked";

  const reviewUnlocked = assessment.kind === "completed";
  const review = progress["content-review"];
  const reviewStatus = !reviewUnlocked ? "locked" : review.kind === "completed" ? "completed" : "active";

  const ratingUnlocked = reviewUnlocked && review.kind === "completed";
  const rating = progress["content-rating"];
  const ratingStatus = !ratingUnlocked ? "locked" : rating.kind === "completed" ? "completed" : "active";

  return {
    assessment: {
      status: assessmentStatus,
      label: assessmentStatus === "completed" ? "Completed" : assessmentStatus === "active" ? "In progress" : "Not available yet",
    },
    "content-review": {
      status: reviewStatus,
      label: reviewStatus === "completed" ? "Completed" : reviewStatus === "active" ? "Waiting for teacher" : "Not available yet",
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
  // Snapshot of `progress` as of the last render where we checked for a
  // step transition. Comparing against it below (during render, not in an
  // effect) is React's documented pattern for "adjusting state when a prop
  // changes" without an extra render/effect round-trip.
  const [previousProgress, setPreviousProgress] = useState(INITIAL_PROGRESS);

  const displayStates = useMemo(() => buildDisplayStates(progress), [progress]);

  const reportProgress = useCallback((step: StudentStepId, next: StepProgress) => {
    setProgress((prev) => (prev[step].kind === next.kind ? prev : { ...prev, [step]: next }));
  }, []);

  // Auto-advance to the next step only at the moment a step *becomes*
  // completed, so revisiting an already-completed step doesn't bounce the
  // student away from it.
  if (progress !== previousProgress) {
    const currentIndex = STUDENT_STEPS.findIndex((step) => step.id === activeStep);
    const justCompleted =
      progress[activeStep].kind === "completed" && previousProgress[activeStep].kind !== "completed";

    if (justCompleted && currentIndex < STUDENT_STEPS.length - 1) {
      const nextStep = STUDENT_STEPS[currentIndex + 1].id;
      if (displayStates[nextStep].status !== "locked") {
        setActiveStep(nextStep);
      }
    }

    setPreviousProgress(progress);
  }

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
