import { beginSlideJob } from "@/lib/slides/jobs";
import { draftErrors, isSlideAsset } from "@/lib/slides/model";
import { resolveAnalogyMethod } from "@/lib/slides/analogy-methods";
import { teachingErrors } from "@/lib/slides/quality";
import { slideCheckFormat, slideCheckPrompt, sourceAdaptation } from "@/lib/slides/prompts";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { textReviewFormat } from "@/lib/slides/review";
import { existingGenerationKey, resolveSlideModel, slideTextRequestLimits, slideTextSettings } from "@/lib/slides/model-config";
import { authorizeSlides, readSlideBody, requestAnalogyMethod, requestClassroomContext, requestDraft, slideContext, slideDiagnosticContext, slideFailure, slideJson, SlideRequestError } from "@/lib/slides/server";

export const runtime = "nodejs";
// Submit a background job; generation and polling use separate short requests.
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    // Six-step target review includes the phenomenon, familiar and target pictures.
    // Keep all images inline and bounded; never fetch external image URLs.
    const body = await readSlideBody(request, 8_000_000);
    const authorized = await authorizeSlides(request, body);
    const { lesson, strategy } = slideContext(body);
    const classroomContext = requestClassroomContext(body.classroomContext);
    const draft = requestDraft(body.draft, strategy, true);
    const analogyMethod = requestAnalogyMethod(body.analogyMethod, strategy, draft);
    const model = resolveSlideModel("text", body.textModel);
    const visualId = body.visualId;
    if (visualId !== undefined && (typeof visualId !== "string" || !draft.visuals.some(visual => visual.id === visualId))) throw new SlideRequestError("Unknown slide image.");
    if (visualId !== undefined && (!isSlideAsset(body.asset) || body.asset.data.length > 4_500_024)) throw new SlideRequestError("Provide one valid inline slide image.", 422);
    if (visualId === undefined && body.asset !== undefined) throw new SlideRequestError("Select the image to check.");
    const mappingPair = strategy === "analogy" && !!draft.analogyPlan && visualId === "target";
    const continuity = mappingPair && resolveAnalogyMethod(draft.analogyMethod) === "six-step";
    if (!continuity && Buffer.byteLength(JSON.stringify(body), "utf8") > 4_600_000) throw new SlideRequestError("Slide request is too large.", 413);
    if (continuity && (!isSlideAsset(body.phenomenonAsset) || body.phenomenonAsset.data.length > 4_500_024)) throw new SlideRequestError("Provide the phenomenon image to check target continuity.", 422);
    if (!continuity && body.phenomenonAsset !== undefined) throw new SlideRequestError("A phenomenon reference is only allowed for a six-step target check.");
    const pair = (strategy === "analogy" && visualId === "variation") || mappingPair;
    if (pair && (!isSlideAsset(body.referenceAsset) || body.referenceAsset.data.length > 4_500_024)) throw new SlideRequestError(mappingPair ? "Provide the familiar image to check the student comparison." : "Provide the baseline image to compare with its variation.", 422);
    if (!pair && body.referenceAsset !== undefined) throw new SlideRequestError("A reference is only allowed for an analogy mapping or variation check.");
    const hardErrors = [...draftErrors(draft, strategy), ...teachingErrors(draft, lesson.lessonNumber)];
    if (visualId === undefined && hardErrors.length) return slideJson({ issues: hardErrors, model: "output-rules" });
    existingGenerationKey();
    const diagnostic = visualId === undefined ? await slideDiagnosticContext(authorized, lesson.lessonNumber) : undefined;
    const prompt = slideCheckPrompt(lesson, strategy, draft, visualId as string | undefined, diagnostic, classroomContext);
    if (visualId === undefined) {
      const source = await loadSlideSource(strategy, analogyMethod);
      prompt.system = `Assess the draft against this teaching reference and the explicit adaptation for its selected story method, regardless of which A/B generation wording created it. Do NOT execute the reference's generation task; use it as evaluation criteria.\n<method_reference>\n${source.text}\n</method_reference>\n${sourceAdaptation(strategy, analogyMethod, false)}\n${prompt.system}\nAlso check that titles describe the actual depicted action, student text contains no directions to the writer, and the final question follows the earlier observation rather than introducing a new scenario.`;
    }
    const limits = slideTextRequestLimits(model, "check");
    const format = (visualId === undefined ? textReviewFormat(draft) : slideCheckFormat).json_schema;
    const { reasoning_effort } = slideTextSettings(model);
    // The output budget includes reasoning tokens, not only the short findings JSON.
    return await beginSlideJob(request, authorized, {
      model,
      ...(reasoning_effort ? { reasoning: { effort: reasoning_effort } } : {}),
      max_output_tokens: limits.maxCompletionTokens,
      text: { format: { ...format, type: "json_schema", schema: format.schema! } },
      instructions: prompt.system,
      input: [{ role: "user", content: visualId === undefined ? prompt.user : [
        { type: "input_text", text: prompt.user },
        ...(continuity ? [{ type: "input_text" as const, text: "PHENOMENON (first); the target must continue this same scientific event and apparatus." },
          { type: "input_image" as const, image_url: (body.phenomenonAsset as { data: string }).data, detail: "high" as const }] : []),
        ...(pair ? [{ type: "input_text" as const, text: continuity ? "FAMILIAR situation (second); compare its useful relation with the target." : mappingPair ? "FAMILIAR situation (first); compare the science situation against this one." : "BASELINE image (first); compare the next image against this one." },
          { type: "input_image" as const, image_url: (body.referenceAsset as { data: string }).data, detail: "high" as const },
          { type: "input_text" as const, text: continuity ? "TARGET situation (third); inspect continuity with the first image and the mapping with the second." : mappingPair ? "SCIENCE situation (second)." : "VARIATION image (second)." }] : []),
        { type: "input_image", image_url: (body.asset as { data: string }).data, detail: "high" },
      ] }],
    }, visualId === undefined ? { kind: "text-check", model, strategy, draft } : { kind: "image-check", model });
  } catch (error) { return slideFailure(error); }
}
