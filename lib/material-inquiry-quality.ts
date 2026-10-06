import { parseGeneratedMaterialActivity } from "./material-activities";

/** Deliberately narrow, high-confidence checks after semantic review.
 * This does not claim to judge all inquiry quality or replace the model reviewer.
 * Restored/published legacy activities are not rejected by these generation gates.
 */
export function materialInquiryIssues(item: { title?: unknown; activity?: unknown }, strategy: string): string[] {
  if (strategy !== "cognitive conflict") return [];
  const activity = parseGeneratedMaterialActivity(item.activity, strategy);
  if (!activity) return []; // Structural validation remains the caller's responsibility.
  const issues: string[] = [];
  const prediction = activity.stages.find(stage => stage.id === "prediction")!.text;
  const predictsContactShape = /\b(?:shape|round|flatten|squash|deform)/iu.test(prediction)
    && /\b(?:during|while|when)\b[^.!?]{0,70}\b(?:contact|press(?:ed|ing)?|touch(?:es|ing)?|squeez(?:ed|ing)?)\b/iu.test(prediction);
  if (predictsContactShape) {
    const fields = [
      { field: "title", text: typeof item.title === "string" ? item.title : "" },
      ...activity.stages.slice(0, 2).flatMap((stage, index) => [
        { field: `activity.stages[${index}].title`, text: stage.title },
        { field: `activity.stages[${index}].text`, text: stage.text },
      ]),
    ];
    for (const { field, text } of fields) {
      const leaked = (text.match(/[^.!?]+[.!?]?/gu) ?? []).find(sentence => {
        // Outcome options, questions and conditional hypotheses are permitted.
        if (sentence.trim().endsWith("?") || /\b(?:if|whether|could|would|might|will|predict(?:ion)?|not|no)\b/iu.test(sentence)) return false;
        // A stated initial or recovered condition need not disclose the contact result.
        if (/\b(?:before\b[^.!?]{0,40}\b(?:press|contact|touch)|after\b[^.!?]{0,40}\b(?:release|contact|bounce))\b/iu.test(sentence)) return false;
        return /\b(?:squashes|flattens|deforms)\b|\b(?:visible|noticeable|clear)\s+(?:shape change|flattening|deformation)\b|\b(?:is|becomes|looks|turns)\s+(?:visibly\s+)?(?:flattened|squashed|flatter|wider and lower)\b/iu.test(sentence);
      });
      if (leaked) issues.push(`${field}: states the contact-shape result before the written prediction: "${leaked.trim()}". Keep only the setup here; reserve the result for discrepant.`);
    }
  }
  const descriptions = activity.image.panels!.map(panel => panel.description.toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim());
  if (new Set(descriptions).size !== descriptions.length) {
    issues.push("activity.image.panels: repeats the same panel description. Supply genuinely different planned states/conditions that test the predicted feature, not duplicate or cosmetically emphasized views.");
  }
  return issues;
}
