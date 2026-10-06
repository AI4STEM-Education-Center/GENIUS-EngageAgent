import type { AnalogyPlan } from "@/lib/slides/analogy";

export const analogyPlanFixture = (): AnalogyPlan => ({
  targetDifficulty: "The distribution of a stationary bridge load between its two supports is not directly visible.",
  familiarExperience: "Two people hold a board while a bag rests on it; shifting the bag changes how much each person supports.",
  depth: "configurations",
  sharedRelation: "A load nearer one of two supports places a greater share of the load on that support.",
  providedMapping: "The two people's hands correspond to the two bridge supports.",
  openMapping: "Students connect the board carrying the bag to the bridge deck carrying a load.",
  changedInput: "Move the same stationary load from the center of the bridge toward the left support.",
  fixedConditions: "Keep the bridge, supports, load weight and resting state unchanged.",
  predictionFocus: "Compare the load supported on the left in the two starting conditions.",
  predictionSupport: "The familiar board experience supports reasoning about load distribution when the load moves nearer one support.",
  boundaryDecision: "omit",
  boundaryReason: "The task concerns stationary load distribution, where the chosen relationship is useful without a further caveat.",
  mappingHint: "The hands holding the board act like the supports holding the bridge.",
  responseStarter: "The board could correspond to...",
});
