export type StudentStepId = "assessment" | "content-review" | "content-rating";

/**
 * What a step component itself observes, independent of whether earlier
 * steps have unlocked it yet. The parent combines this with lock state to
 * decide what to actually show.
 */
export type StepProgress =
  | { kind: "not-available" }
  | { kind: "active" }
  | { kind: "completed" };

export type StepDisplayStatus = "locked" | "active" | "completed";

export type StepDisplayState = {
  status: StepDisplayStatus;
  /** Short pill label, e.g. "Waiting for teacher", "Not available yet". */
  label: string;
};

export const STUDENT_STEPS: { id: StudentStepId; title: string }[] = [
  { id: "assessment", title: "Assessment" },
  { id: "content-review", title: "Content Review" },
  { id: "content-rating", title: "Material Rating" },
];
