import OpenAI from "openai";
import { getAllLessons } from "@/lib/quiz-data";
import { slideOutputFormat, slidePrompt } from "@/lib/slides/prompts";
import { authorizeSlides, readSlideBody, requestAnalogyMethod, requestClassroomContext, requestDraft, slideContext, slideDiagnosticContext, slideFailure, slideJson, SlideRequestError } from "@/lib/slides/server";
import { existingGenerationKey, resolveSlideModel, slideModelCatalog, slideTextRequestLimits, slideTextSettings } from "@/lib/slides/model-config";
import { analogyPromptRevision, isSlidePromptVersion, SLIDE_PROMPT_REVISION } from "@/lib/slides/prompt-versions";
import { SIX_STEP_CONTEXT_FIELDS } from "@/lib/slides/analogy";
import { loadSlideSource } from "@/lib/slides/source-prompts";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    await authorizeSlides(request, Object.fromEntries(new URL(request.url).searchParams));
    return slideJson({ lessons: getAllLessons().map(lesson => ({ lessonNumber: lesson.lesson_number, lessonTitle: lesson.lesson_title, learningObjective: lesson.learning_objective })), models: slideModelCatalog() });
  } catch (error) { return slideFailure(error); }
}

export async function POST(request: Request) {
  try {
    const body = await readSlideBody(request);
    const authorized = await authorizeSlides(request, body);
    const { lesson, strategy } = slideContext(body);
    const classroomContext = requestClassroomContext(body.classroomContext);
    const promptVersion = body.promptVersion === undefined ? "optimized" : body.promptVersion;
    if (!isSlidePromptVersion(promptVersion)) throw new SlideRequestError("Unknown slide prompt version.");
    const operation = body.operation ?? "generate";
    if (operation !== "generate" && operation !== "review") throw new SlideRequestError("Unknown slide operation.");
    const draft = operation === "review" ? requestDraft(body.draft, strategy, true) : undefined;
    const analogyMethod = requestAnalogyMethod(body.analogyMethod, strategy, draft);
    if (body.feedback !== undefined && (typeof body.feedback !== "string" || body.feedback.length > 6000)) throw new SlideRequestError("Revision feedback must be at most 6000 characters.");
    const model = resolveSlideModel("text", body.textModel);
    const apiKey = existingGenerationKey();
    const diagnostic = await slideDiagnosticContext(authorized, lesson.lessonNumber);
    const source = await loadSlideSource(strategy, analogyMethod);
    const prompt = slidePrompt(lesson, strategy, draft, body.feedback as string | undefined, diagnostic, { version: promptVersion, referenceText: source.text, classroomContext, analogyMethod });
    const limits = slideTextRequestLimits(model, "generate");
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: limits.timeoutMs });
    const result = await client.chat.completions.create({
      model, ...slideTextSettings(model),
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      response_format: slideOutputFormat(strategy, analogyMethod), max_completion_tokens: limits.maxCompletionTokens,
    }, { signal: request.signal });
    const choice = result.choices[0];
    if (choice?.finish_reason !== "stop" || !choice.message.content || choice.message.refusal) throw new SlideRequestError("The model did not return a complete slide draft. Please try again.", 502);
    let parsed: unknown;
    try { parsed = JSON.parse(choice.message.content); }
    catch { throw new SlideRequestError("The model returned an unreadable draft. Please try again.", 502); }
    // Retain bounded, editable text even if it needs shortening; export stays strict.
    const generated = requestDraft(parsed, strategy, true, analogyMethod);
    if (strategy === "analogy" && !generated.analogyPlan) throw new SlideRequestError("The analogy design is incomplete. Please retry generation.", 502);
    if (analogyMethod === "six-step" && (SIX_STEP_CONTEXT_FIELDS.some(field => !generated.analogyPlan?.[field]?.trim()) || generated.analogyPlan?.mappingHint !== "")) {
      throw new SlideRequestError("The teacher-led analogy design is incomplete. Please retry generation.", 502);
    }
    return slideJson({ draft: generated, model,
      promptProvenance: { version: promptVersion, revision: strategy === "analogy" ? analogyPromptRevision(analogyMethod) : SLIDE_PROMPT_REVISION, sourceSha256: source.sha256, ...(analogyMethod ? { analogyMethod } : {}) } });
  } catch (error) { return slideFailure(error); }
}
