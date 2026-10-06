import type { ResponseFormatJSONSchema } from "openai/resources/shared";
import { stageSequences } from "./material-activities";

const text = { type: "string" };
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export function materialOutputFormat(strategy: string): ResponseFormatJSONSchema {
  const inquiryStrategy = strategy === "cognitive conflict" || strategy === "experience bridging";
  const studentTitle = inquiryStrategy
    ? { type: "string", description: "A natural scene title or short student question. No strategy labels, teacher directions, scientific answers, or future results. For experience bridging, do not name the formal concept before the name stage." }
    : text;
  const studentText = inquiryStrategy
    ? { type: "string", description: `Exact concise student-facing content with one achievable thinking task. Use only the supplied scene/evidence; do not print that task's answer and ask for a copy. No teacher script, expected answers or method labels. Final question stage asks the learner to write their OWN scientific question arising from the earlier experience/comparison, with general unfinished starters rather than a completed question. ${strategy === "experience bridging" ? "Keep one lived experience through recall, closer noticing and naming; a recalled or imagined opening choice remains valid in all later tasks. Name the concept only in name, after observation; describe science within that experience without presuming a learner response or explaining the mechanism. Connect is optional and uses instances of the same phenomenon." : "Keep the same predicted feature and conditions throughout, testing a plausible diagnostic/curriculum-supported incomplete rule rather than declaring an ordinary outcome surprising. Never reveal the result in phenomenon or prediction. Discrepant supplies source-labeled evidence and a meaningful task not already answered in its text. Comparison permits matches and differences without inventing the learner's response."}` }
    : text;
  return {
    type: "json_schema",
    json_schema: {
      name: "engagement_material",
      strict: true,
      schema: object({ items: { type: "array", minItems: 1, maxItems: 1, items: object({
        type: { type: "string", enum: ["Inquiry activity"] }, title: studentTitle,
        textModes: { type: "array", items: { type: "string", enum: ["questions", "phenomenon", "dialogue"] } },
        visualBrief: text,
        activity: object({
          version: { type: "integer", enum: [1] },
          ...(strategy === "cognitive conflict" ? { observedOutcome: { type: "string", description: "One concrete declarative sentence stating the scientifically accurate result AND its source: an inspectable schematic or explicitly hypothetical data provided in discrepant text. Keep the SAME predicted feature and conditions. This result is revealed with comparison, never as the opening or prediction. Not a question, explanation, invented learner prediction, invented citation or unsupported claim about real measurements." } } : {}),
          stages: { type: "array", minItems: strategy === "cognitive conflict" ? 5 : 4, maxItems: 5, items: object({
            id: { type: "string", enum: [...new Set(stageSequences[strategy].flat())] }, title: studentTitle, text: studentText,
          }) },
          image: object({
            scene: { type: "string", description: "One-sentence summary only. Do not introduce extra panels, objects or states absent from panels." },
            panels: { type: "array", minItems: strategy === "experience bridging" ? 1 : 2, maxItems: strategy === "analogy" ? 2 : strategy === "experience bridging" ? 1 : 3, items: object({
              description: { type: "string", description: "Exactly ONE frozen moment in ONE panel. Explicit actor, action, contact, object identity and visible geometry showing the relevant phenomenon. For deformation, specify the visibly changed silhouette, not just a different position. No subpanels, insets, before-and-after states, labels or camera movement." },
              caption: { type: "string", minLength: 1, maxLength: 100, description: "Short student-facing caption, at most 100 characters, displayed outside the image. Describe the same action and contact as the panel and its stage; never label hand pressure as a falling collision. Analogy: name only this object, not its counterpart/mapping." },
              alt: { type: "string", description: "Concise accessible description of this panel only, not drawing instructions or unobservable mechanisms." },
            }) },
            revealAt: { type: "integer", enum: strategy === "experience bridging" ? [0, 1] : [2] },
          }),
          ...(strategy === "analogy" ? {
            mappingDepth: { type: "string", enum: ["entities", "configurations", "mechanisms"] },
            analogyMapping: object({ target: text, analogue: text, correspondences: { type: "array", minItems: 1, maxItems: 3, items: object({ targetPart: text, analoguePart: text, relationship: text }) } }),
          } : {}),
        }),
      }) } }),
    },
  };
}
