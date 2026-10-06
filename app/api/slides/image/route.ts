import { isSlideAsset } from "@/lib/slides/model";
import { resolveAnalogyMethod } from "@/lib/slides/analogy-methods";
import { slideImagePrompt } from "@/lib/slides/prompts";
import { authorizeSlides, readSlideBody, requestAnalogyMethod, requestDraft, slideContext, slideFailure, SlideRequestError } from "@/lib/slides/server";
import { resolveSlideModel } from "@/lib/slides/model-config";
import { beginSlideJob } from "@/lib/slides/jobs";

export const runtime = "nodejs";
// Submit a provider background job; every web request stays short.
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await readSlideBody(request, 4_600_000);
    const authorized = await authorizeSlides(request, body);
    const { strategy } = slideContext(body);
    const draft = requestDraft(body.draft, strategy);
    requestAnalogyMethod(body.analogyMethod, strategy, draft);
    if (typeof body.visualId !== "string" || !draft.visuals.some(item => item.id === body.visualId)) throw new SlideRequestError("Unknown slide image.");
    if (body.feedback !== undefined && (typeof body.feedback !== "string" || body.feedback.length > 4000)) throw new SlideRequestError("Image feedback must be at most 4000 characters.");
    const variation = strategy === "analogy" && body.visualId === "variation";
    const targetContinuation = strategy === "analogy" && resolveAnalogyMethod(draft.analogyMethod) === "six-step" && body.visualId === "target";
    let reference: string | undefined;
    if (variation || targetContinuation) {
      if (!isSlideAsset(body.referenceAsset) || body.referenceAsset.data.length > 4_500_024 || !body.referenceAsset.data.startsWith("data:image/jpeg;base64,")) throw new SlideRequestError(targetContinuation ? "Generate the phenomenon image before its target continuation." : "Generate the baseline target image before its variation.", 422);
      const bytes = Buffer.from(body.referenceAsset.data.split(",")[1], "base64");
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new SlideRequestError(targetContinuation ? "Invalid phenomenon JPEG." : "Invalid baseline JPEG.", 422);
      reference = body.referenceAsset.data;
    } else if (body.referenceAsset !== undefined) throw new SlideRequestError("A reference image is only used for an analogy variation or six-step target continuation.");
    const model = resolveSlideModel("image", body.imageModel);
    const imageTool = { type: "image_generation" as const, model, size: "1536x1024" as const, quality: "high" as const,
      output_format: "jpeg" as const, output_compression: 85, action: reference ? "edit" as const : "generate" as const };
    return await beginSlideJob(request, authorized, {
      model: "gpt-4.1",
      instructions: "Generate exactly one classroom image with the image generation tool. Preserve every scientific constraint, object, contact relationship, comparison and no-text requirement in the supplied image brief. Do not introduce another scene, explanation, label or decorative object. When a reference image is supplied, edit that image as directed while preserving the required apparatus and visual continuity. Return the image without a prose explanation.",
      input: [{ role: "user", content: [
        { type: "input_text", text: slideImagePrompt(draft, strategy, body.visualId, body.feedback as string | undefined) },
        ...(reference ? [{ type: "input_image" as const, image_url: reference, detail: "high" as const }] : []),
      ] }],
      tools: [imageTool], tool_choice: { type: "image_generation" }, max_output_tokens: 2000,
    }, { kind: "image", model });
  } catch (error) { return slideFailure(error); }
}
