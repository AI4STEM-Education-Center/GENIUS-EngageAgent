"use client";

import type { StudentStepId, StepDisplayState } from "@/lib/student-progress";
import { STUDENT_STEPS } from "@/lib/student-progress";

type Props = {
  activeStep: StudentStepId;
  states: Record<StudentStepId, StepDisplayState>;
  onSelectStep: (step: StudentStepId) => void;
};

const PILL_STYLES: Record<StepDisplayState["status"], string> = {
  completed: "bg-emerald-100 text-emerald-700",
  active: "bg-white/20 text-white",
  locked: "bg-slate-100 text-slate-500",
};

const CARD_STYLES: Record<StepDisplayState["status"], string> = {
  completed: "border-slate-200 bg-white",
  active: "border-[#BA0C2F] bg-[#BA0C2F] text-white",
  locked: "border-slate-200 bg-white opacity-60",
};

export default function StudentProgressStepper({ activeStep, states, onSelectStep }: Props) {
  const completedCount = STUDENT_STEPS.filter((step) => states[step.id].status === "completed").length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <p className="text-base font-semibold text-slate-900">Your progress</p>
      <p className="mt-0.5 text-sm text-slate-500">
        {completedCount} of {STUDENT_STEPS.length} activities completed
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {STUDENT_STEPS.map((step, index) => {
          const state = states[step.id];
          const clickable = state.status !== "locked";
          const isActive = step.id === activeStep;

          return (
            <button
              key={step.id}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelectStep(step.id)}
              aria-current={isActive ? "step" : undefined}
              className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition ${CARD_STYLES[state.status]} ${
                clickable ? "cursor-pointer" : "cursor-not-allowed"
              } ${isActive && state.status !== "active" ? "ring-2 ring-[#BA0C2F] ring-offset-2" : ""}`}
            >
              <div className="flex w-full items-center justify-between">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    state.status === "active"
                      ? "bg-white/25 text-white"
                      : state.status === "completed"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {state.status === "completed" ? "✓" : index + 1}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${PILL_STYLES[state.status]}`}>
                  {state.label}
                </span>
              </div>
              <p className={`text-sm font-semibold ${state.status === "active" ? "text-white" : "text-slate-900"}`}>
                {index + 1}. {step.title}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
