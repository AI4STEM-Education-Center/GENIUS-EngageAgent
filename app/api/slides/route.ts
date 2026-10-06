import { getAllLessons } from "@/lib/quiz-data";
import { slideOutputFormat, slidePrompt } from "@/lib/slides/prompts";
import { authorizeSlides, readSlideBody, requestAnalogyMethod, requestClassroomContext, requestDraft, slideContext, slideDiagnosticContext, slideFailure, slideJson, SlideRequestError } from "@/lib/slides/server";
import { existingGenerationKey, resolveSlideModel, slideModelCatalog, slideTextRequestLimits, slideTextSettings } from "@/lib/slides/model-config";
import { analogyPromptRevision, isSlidePromptVersion, SLIDE_PROMPT_REVISION } from "@/lib/slides/prompt-versions";
import { beginSlideJob } from "@/lib/slides/jobs";
import { loadSlideSource } from "@/lib/slides/source-prompts";

export const runtime = "nodejs";
// Submit a background job; generation and polling use separate short requests.
export const maxDuration = 30;

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
    existingGenerationKey();
    const diagnostic = await slideDiagnosticContext(authorized, lesson.lessonNumber);
    const source = await loadSlideSource(strategy, analogyMethod);
    const prompt = slidePrompt(lesson, strategy, draft, body.feedback as string | undefined, diagnostic, { version: promptVersion, referenceText: source.text, classroomContext, analogyMethod });
    const limits = slideTextRequestLimits(model, "generate");
    const format = slideOutputFormat(strategy, analogyMethod).json_schema;
    const { reasoning_effort } = slideTextSettings(model);
    return await beginSlideJob(request, authorized, {
      model,
      ...(reasoning_effort ? { reasoning: { effort: reasoning_effort } } : {}),
      instructions: prompt.system,
      input: [{ role: "user", content: prompt.user }],
      text: { format: { ...format, type: "json_schema", schema: format.schema! } },
      max_output_tokens: limits.maxCompletionTokens,
    }, {
      kind: "draft", model, strategy, ...(analogyMethod ? { analogyMethod } : {}),
      promptProvenance: { version: promptVersion, revision: strategy === "analogy" ? analogyPromptRevision(analogyMethod) : SLIDE_PROMPT_REVISION, sourceSha256: source.sha256, ...(analogyMethod ? { analogyMethod } : {}) },
    });
  } catch (error) { return slideFailure(error); }
}
