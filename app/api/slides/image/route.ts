import OpenAI, { toFile } from "openai";
import { isSlideAsset } from "@/lib/slides/model";
import { resolveAnalogyMethod } from "@/lib/slides/analogy-methods";
import { slideImagePrompt } from "@/lib/slides/prompts";
import { authorizeSlides, readSlideBody, requestAnalogyMethod, requestDraft, slideContext, slideFailure, slideJson, SlideRequestError } from "@/lib/slides/server";
import { existingGenerationKey, resolveSlideModel } from "@/lib/slides/model-config";

export const runtime = "nodejs";
// Local high-quality image requests exceeded the former 50-second SDK limit.
// Hosting/proxy limits still need independent verification before deployment.
export const maxDuration = 150;

export async function POST(request: Request) {
  try {
    const body = await readSlideBody(request, 4_600_000);
    await authorizeSlides(request, body);
    const { strategy } = slideContext(body);
    const draft = requestDraft(body.draft, strategy);
    requestAnalogyMethod(body.analogyMethod, strategy, draft);
    if (typeof body.visualId !== "string" || !draft.visuals.some(item => item.id === body.visualId)) throw new SlideRequestError("Unknown slide image.");
    if (body.feedback !== undefined && (typeof body.feedback !== "string" || body.feedback.length > 4000)) throw new SlideRequestError("Image feedback must be at most 4000 characters.");
    const variation = strategy === "analogy" && body.visualId === "variation";
    const targetContinuation = strategy === "analogy" && resolveAnalogyMethod(draft.analogyMethod) === "six-step" && body.visualId === "target";
    let reference: Buffer | undefined;
    if (variation || targetContinuation) {
      if (!isSlideAsset(body.referenceAsset) || body.referenceAsset.data.length > 4_500_024 || !body.referenceAsset.data.startsWith("data:image/jpeg;base64,")) throw new SlideRequestError(targetContinuation ? "Generate the phenomenon image before its target continuation." : "Generate the baseline target image before its variation.", 422);
      reference = Buffer.from(body.referenceAsset.data.split(",")[1], "base64");
      if (reference[0] !== 0xff || reference[1] !== 0xd8 || reference[2] !== 0xff) throw new SlideRequestError(targetContinuation ? "Invalid phenomenon JPEG." : "Invalid baseline JPEG.", 422);
    } else if (body.referenceAsset !== undefined) throw new SlideRequestError("A reference image is only used for an analogy variation or six-step target continuation.");
    const model = resolveSlideModel("image", body.imageModel);
    const apiKey = existingGenerationKey();
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
    const settings = { model, n: 1, size: "1536x1024" as const, quality: "high" as const, output_format: "jpeg" as const, output_compression: 85,
      prompt: slideImagePrompt(draft, strategy, body.visualId, body.feedback as string | undefined) };
    const result = reference
      ? await client.images.edit({ ...settings, image: await toFile(reference, targetContinuation ? "phenomenon.jpg" : "baseline.jpg", { type: "image/jpeg" }) }, { signal: request.signal })
      : await client.images.generate(settings, { signal: request.signal });
    const base64 = result.data?.[0]?.b64_json;
    if (!base64 || base64.length > 4_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) throw new SlideRequestError("No usable image returned, or the image exceeded the download limit. Retry this image.", 502);
    const bytes = Buffer.from(base64, "base64");
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new SlideRequestError("Invalid image returned. Retry this image.", 502);
    return slideJson({ asset: { data: `data:image/jpeg;base64,${base64}`, width: 1536, height: 1024, model } });
  } catch (error) { return slideFailure(error); }
}
