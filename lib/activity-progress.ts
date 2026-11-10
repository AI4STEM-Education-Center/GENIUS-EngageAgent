/**
 * How far a teacher has got through an activity's four steps (#176). One set of
 * rules for the server (worked out from saved data) and the step bar (worked
 * out in the browser from the page's live state).
 */
export type ActivityStep = "assessment" | "strategy" | "materials" | "discussion";
export type StepState = "not-started" | "in-progress" | "done";
export type ActivityProgress = Record<ActivityStep, StepState>;

export type ProgressInputs = {
  /** A lesson is chosen for the quiz. */
  lessonChosen: boolean;
  /** The quiz or a survey has been published (a closed quiz counts). */
  assessmentPublished: boolean;
  /** A strategy is selected in Step 2. Only the browser knows this (it's kept in the
   * teacher's draft), so the server counts sent materials instead. */
  strategyChosen: boolean;
  /** Materials exist as a draft (the browser knows this; the server doesn't). */
  materialsDrafted?: boolean;
  /** At least one material was sent to students. */
  materialsSent: boolean;
  boardPublished: boolean;
  reportsReleased: boolean;
};

export function activityProgress(input: ProgressInputs): ActivityProgress {
  return {
    assessment: input.assessmentPublished ? "done" : input.lessonChosen ? "in-progress" : "not-started",
    // Sent materials mean a strategy was chosen, even where the choice isn't known.
    strategy: input.strategyChosen || input.materialsSent ? "done" : input.assessmentPublished ? "in-progress" : "not-started",
    materials: input.materialsSent ? "done" : input.materialsDrafted ? "in-progress" : "not-started",
    // As in the v8.4 prototype, Step 4 is done once reports are released; a
    // published board alone is still in progress.
    discussion: input.reportsReleased ? "done" : input.materialsSent || input.boardPublished ? "in-progress" : "not-started",
  };
}
