// Student-facing topic orientation, shared by prompts, preview and PowerPoint.
// These labels name the investigation without supplying its predicted result.
const LEARNING_TARGETS: Readonly<Record<number, string>> = {
  1: "Shape and motion during contact",
  2: "Energy transfer during collisions",
  3: "Deformation during contact",
  4: "Deformation and recovery",
  5: "Contact forces",
  6: "Forces, motion and deformation",
  7: "Kinetic energy",
  8: "Energy stores and transfers",
};

export function getSlideLearningTarget(lessonNumber: number): string {
  const target = LEARNING_TARGETS[lessonNumber];
  if (!target) throw new Error("This lesson needs a slide learning target before generation.");
  return target;
}
