export type MaterialStage = { id: string; title: string; text: string };
export type MaterialPanel = { description: string; caption: string; alt: string };
export type AnalogyMapping = {
  target: string;
  analogue: string;
  correspondences: { targetPart: string; analoguePart: string; relationship: string }[];
};
export type MaterialActivity = {
  version: 1;
  stages: MaterialStage[];
  image: { scene: string; revealAt: number; panels?: MaterialPanel[] };
  mappingDepth?: "entities" | "configurations" | "mechanisms";
  analogyMapping?: AnalogyMapping;
  observedOutcome?: string;
};

export const MATERIAL_STRATEGIES = ["analogy", "cognitive conflict", "experience bridging", "engaged critiquing"] as readonly string[];

export const stageSequences: Record<string, string[][]> = {
  "engaged critiquing": [["claim", "evidence", "critique", "revise", "question"]],
  "experience bridging": [
    ["experience", "notice", "name", "question"],
    ["experience", "notice", "name", "connect", "question"],
  ],
  "cognitive conflict": [["phenomenon", "prediction", "discrepant", "compare", "question"]],
  analogy: [
    ["target", "analogue", "mapping", "question"],
    ["target", "analogue", "mapping", "limits", "question"],
  ],
};

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const nonempty = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);

/** Use the same contract for generated JSON, restored drafts and published materials. */
export function parseMaterialActivity(value: unknown, strategy: string): MaterialActivity | undefined {
  if (!record(value) || value.version !== 1 || !Object.hasOwn(stageSequences, strategy)) return undefined;
  if (!Array.isArray(value.stages) || !stageSequences[strategy].some(sequence =>
    sequence.length === (value.stages as unknown[]).length && sequence.every((id, i) => {
      const stage = (value.stages as unknown[])[i];
      return record(stage) && stage.id === id;
    }))) return undefined;
  if (!value.stages.every(stage => record(stage) && nonempty(stage.title, 100) && nonempty(stage.text, 1600))) return undefined;
  if (!record(value.image) || !nonempty(value.image.scene, 5000)) return undefined;
  // A combined illustration must not reveal a comparison before the learner is ready.
  const minimumReveal = strategy === "experience bridging" ? 0 : strategy === "engaged critiquing" ? 1 : 2;
  if (!Number.isInteger(value.image.revealAt) || Number(value.image.revealAt) < minimumReveal || Number(value.image.revealAt) >= value.stages.length) return undefined;
  if (strategy === "analogy" && !["entities", "configurations", "mechanisms"].includes(String(value.mappingDepth))) return undefined;
  if (strategy === "cognitive conflict" && !nonempty(value.observedOutcome, 800)) return undefined;
  let panels: MaterialPanel[] | undefined;
  if (value.image.panels !== undefined) {
    const input = value.image.panels;
    const validCount = Array.isArray(input) && (strategy === "analogy" ? input.length === 2 : strategy === "experience bridging" ? input.length === 1 : input.length >= (strategy === "engaged critiquing" ? 1 : 2) && input.length <= 3);
    if (!validCount || !Array.isArray(input) || !input.every(panel => record(panel) && nonempty(panel.description, 1400) && nonempty(panel.caption, 100) && nonempty(panel.alt, 500))) return undefined;
    panels = input.map(panel => ({ description: panel.description.trim(), caption: panel.caption.trim(), alt: panel.alt.trim() }));
  }
  let analogyMapping: AnalogyMapping | undefined;
  if (value.analogyMapping !== undefined) {
    const mapping = value.analogyMapping;
    if (strategy !== "analogy" || !record(mapping) || !nonempty(mapping.target, 250) || !nonempty(mapping.analogue, 250) ||
      !Array.isArray(mapping.correspondences) || mapping.correspondences.length < 1 || mapping.correspondences.length > 3 ||
      !mapping.correspondences.every(pair => record(pair) && nonempty(pair.targetPart, 200) && nonempty(pair.analoguePart, 200) && nonempty(pair.relationship, 400))) return undefined;
    analogyMapping = { target: mapping.target.trim(), analogue: mapping.analogue.trim(), correspondences: mapping.correspondences.map(pair => ({ targetPart: pair.targetPart.trim(), analoguePart: pair.analoguePart.trim(), relationship: pair.relationship.trim() })) };
  }
  // The model can copy its schema key into a learner's task. Repair only this
  // exact internal reference, including old published drafts; retain the
  // teacher's wording and the structured evidence rather than rewriting a task.
  const studentText = (text: string) => strategy === "cognitive conflict"
    ? text.replace(/`?\b(?:activity\.)?observedOutcome\b`?/g, "observed result")
    : text;
  return {
    version: 1,
    stages: value.stages.map(stage => ({ id: stage.id, title: studentText(stage.title.trim()), text: studentText(stage.id === "compare" && strategy === "cognitive conflict"
      ? `What we observed in the activity: ${String(value.observedOutcome).trim()}\nHow did what we observed match or differ from your recorded prediction?`
      : stage.text.trim()) })),
    image: { scene: value.image.scene.trim(), revealAt: Number(value.image.revealAt), ...(panels ? { panels } : {}) },
    ...(strategy === "analogy" ? { mappingDepth: value.mappingDepth as MaterialActivity["mappingDepth"] } : {}),
    ...(analogyMapping ? { analogyMapping } : {}),
    ...(strategy === "cognitive conflict" ? { observedOutcome: String(value.observedOutcome).trim() } : {}),
  };
}

/** New generations require the panel plan; older saved activities remain readable. */
export function parseGeneratedMaterialActivity(value: unknown, strategy: string): MaterialActivity | undefined {
  const activity = parseMaterialActivity(value, strategy);
  if (!activity?.image.panels || (strategy === "analogy" && !activity.analogyMapping)) return undefined;
  if (strategy === "experience bridging" ? activity.image.revealAt > 1 : activity.image.revealAt !== (strategy === "engaged critiquing" ? 1 : 2)) return undefined;
  return activity;
}
