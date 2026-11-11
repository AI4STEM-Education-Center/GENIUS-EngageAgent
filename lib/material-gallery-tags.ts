import { GALLERY_TAG_LABELS, type GalleryMaterial, type GalleryMetadata } from "./material-gallery";
import { getLesson } from "./quiz-data";
import { getEngagementStrategyLabel } from "./engagement-strategies";
import { resolveStrategyFocus } from "./strategy-focus";
import { getLessonGenerationContext } from "./lesson-context";
import { slidePrompt } from "./slides/prompts";
import type { SlideDraft, SlideStrategy } from "./slides/model";

/** Snapshot the teaching variables, using the same slide reference-variable
 * builder as generation. Class-specific inputs are shareable summaries that
 * the teacher explicitly reviews; raw diagnostics/context are never copied. */
export function galleryPromptTags(lessonNumber: number, strategy: string, format: "slides" | "video",
  metadata: Omit<GalleryMetadata, "sharingConfirmed">, draft?: SlideDraft, textModes?: string[]): Record<string, string> {
  const lesson = getLessonGenerationContext(lessonNumber);
  if (!lesson) return {};
  const focus = metadata.focus ? resolveStrategyFocus(lessonNumber, strategy, metadata.focus) : null;
  const curriculum = getLesson(lessonNumber);
  const variables: Record<string, unknown> = format === "slides"
    ? JSON.parse(slidePrompt(lesson, strategy as SlideStrategy, undefined, "", undefined,
      { focus, analogyMethod: draft?.analogyMethod }).user).referenceVariables
    : { SUBJECT: "Physics", TOPIC: curriculum?.topic?.trim() && curriculum.target_concept?.trim() ? curriculum.topic.trim() : lesson.lessonTitle, TARGET_CONCEPT: curriculum?.target_concept || lesson.lessonTitle,
      LEARNING_OBJECTIVE: lesson.learningObjective, TARGET_UNDERSTANDING: lesson.learningObjective,
      PREFERRED_MEDIA_TYPE: "Video activity", VISUAL_STYLE: "Classroom illustration and animation" };
  const tags: Record<string, string> = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key,
    typeof value === "string" ? value : Object.values(value && typeof value === "object" ? value : {}).filter(v => typeof v === "string").join("; ")]));
  // These dimensions are never inferred from private student or classroom text.
  tags.GRADE_LEVEL = metadata.gradeBand || "Not shared (prompt default: high school)";
  tags.CURRENT_UNDERSTANDING = metadata.quizPattern || "Not shared";
  tags.MISCONCEPTION_OR_GAP = focus?.kind === "misconceptions" ? focus.items.join("; ") : tags.MISCONCEPTION_OR_GAP || "Not selected";
  tags.KNOWLEDGE_GAP ||= tags.MISCONCEPTION_OR_GAP;
  if (focus?.kind === "coreIdeas") tags.TARGET_UNDERSTANDING = focus.items.join(" ");
  tags.SELECTED_STRATEGY = getEngagementStrategyLabel(strategy);
  tags.LEARNER_CONTEXT = metadata.teachingContext || "Not shared";
  tags.CLASS_PROFILE = metadata.classProfile || "Not shared";
  tags.EXPERIENCE_CONTEXT = metadata.experienceContext || "Not supplied";
  if (strategy === "analogy" && draft?.analogyMethod) tags.ANALOGY_METHOD = draft.analogyMethod;
  if (textModes?.length) tags.TEXT_MODES = textModes.join(", ");
  return Object.fromEntries(Object.entries(tags).filter(([key, value]) => key in GALLERY_TAG_LABELS && typeof value === "string")
    .map(([key, value]) => [key, value.slice(0, 4000)]));
}

export function galleryMatches(material: GalleryMaterial, lesson: number, strategy: string, focus?: { misconceptions: string[]; coreIdeas: number[] }, contextTags?: Record<string, string>) {
  const reasons: string[] = [];
  // Lesson numbers and focus codes are task-local. New tagged materials must
  // also agree with this task's curriculum snapshot before calling it a match.
  const sameLesson = material.lessonNumber === lesson && (!material.promptTags || !contextTags
    || ["TOPIC", "LEARNING_OBJECTIVE"].every(key => material.promptTags?.[key] === contextTags[key]));
  if (sameLesson) reasons.push("Same lesson");
  if (material.strategy === strategy) reasons.push("Same strategy");
  if (sameLesson && material.focus && focus &&
    (material.focus.misconceptions.some(id => focus.misconceptions.includes(id)) || material.focus.coreIdeas.some(id => focus.coreIdeas.includes(id)))) reasons.push("Same focus");
  return { score: (reasons.includes("Same lesson") ? 4 : 0) + (reasons.includes("Same strategy") ? 2 : 0) + (reasons.includes("Same focus") ? 8 : 0), reasons };
}
