import { slideRevisionOutputFormat, slideRevisionPrompt, validSlideRevisionIndex } from "@/lib/slides/slide-revision";
import { listTaskLessons } from "@/lib/lessons-store";
import { enterLessonScope, loadTaskLessons } from "@/lib/lesson-scope";
import { slideOutputFormat, slidePrompt } from "@/lib/slides/prompts";
import { authorizeSlides, readSlideBody, requestAnalogyMethod, requestClassroomContext, requestDraft, requestFocus, slideContext, slideDiagnosticContext, slideFailure, slideJson, SlideRequestError } from "@/lib/slides/server";
import { existingGenerationKey, resolveSlideModel, slideModelCatalog, slideTextRequestLimits, slideTextSettings } from "@/lib/slides/model-config";
import { analogyPromptRevision, isSlidePromptVersion, SLIDE_PROMPT_REVISION } from "@/lib/slides/prompt-versions";
import { beginSlideJob } from "@/lib/slides/jobs";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { materialClassroomContext } from "@/lib/material-classroom-context";

export const runtime = "nodejs";
// Submit a background job; generation and polling use separate short requests.
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const { classId, assignmentId } = await authorizeSlides(request, Object.fromEntries(new URL(request.url).searchParams));
    return slideJson({ lessons: (await listTaskLessons(classId, assignmentId)).map(lesson => ({ lessonNumber: lesson.lessonNumber, lessonTitle: lesson.title, learningObjective: lesson.learningObjective })), models: slideModelCatalog() });
  } catch (error) { return slideFailure(error); }
}

export async function POST(request: Request) {
  try {
    const body = await readSlideBody(request);
    const authorized = await authorizeSlides(request, body);
    enterLessonScope(await loadTaskLessons(authorized, body.lessonNumber));
    const { lesson, strategy } = slideContext(body);
    const taskContext = requestClassroomContext(body.classroomContext);
    const promptVersion = body.promptVersion === undefined ? "optimized" : body.promptVersion;
    if (!isSlidePromptVersion(promptVersion)) throw new SlideRequestError("Unknown slide prompt version.");
    const operation = body.operation ?? "generate";
    if (operation !== "generate" && operation !== "review" && operation !== "review-slide") throw new SlideRequestError("Unknown slide operation.");
    const draft = operation !== "generate" ? requestDraft(body.draft, strategy, true) : undefined;
    if (operation === "review-slide" ? !draft || !validSlideRevisionIndex(draft, body.slideIndex) : body.slideIndex !== undefined) throw new SlideRequestError("Choose one valid slide to revise.");
    const analogyMethod = requestAnalogyMethod(body.analogyMethod, strategy, draft);
    if (body.feedback !== undefined && (typeof body.feedback !== "string" || body.feedback.length > 6000)) throw new SlideRequestError("Revision feedback must be at most 6000 characters.");
    const model = resolveSlideModel("text", body.textModel);
    const focus = requestFocus(lesson.lessonNumber, strategy, body.focus);
    existingGenerationKey();
    const classroomContext = await materialClassroomContext(authorized.classId, taskContext);
    if (operation === "review-slide" && draft) {
      const slideIndex = Number(body.slideIndex);
      const prompt = slideRevisionPrompt(lesson, strategy, draft, slideIndex, body.feedback as string | undefined, classroomContext, focus);
      const format = slideRevisionOutputFormat(draft, strategy, slideIndex).json_schema;
      const { reasoning_effort } = slideTextSettings(model);
      return await beginSlideJob(request, authorized, {
        model, ...(reasoning_effort ? { reasoning: { effort: reasoning_effort } } : {}),
        instructions: prompt.system, input: [{ role: "user", content: prompt.user }],
        text: { format: { ...format, type: "json_schema", schema: format.schema! } },
        max_output_tokens: slideTextRequestLimits(model, "generate").maxCompletionTokens,
      }, { kind: "slide-revision", model, strategy, lessonNumber: lesson.lessonNumber, slideIndex, draft });
    }
    const diagnostic = await slideDiagnosticContext(authorized, lesson.lessonNumber);
    const source = await loadSlideSource(strategy, analogyMethod);
    const prompt = slidePrompt(lesson, strategy, draft, body.feedback as string | undefined, diagnostic, { version: promptVersion, referenceText: source.text, classroomContext, analogyMethod, focus });
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
      ...(strategy === "cognitive conflict" ? { requireOpeningPhenomenon: true } : {}),
      promptProvenance: { version: promptVersion, revision: strategy === "analogy" ? analogyPromptRevision(analogyMethod) : SLIDE_PROMPT_REVISION, sourceSha256: source.sha256, ...(analogyMethod ? { analogyMethod } : {}) },
    });
  } catch (error) { return slideFailure(error); }
}
