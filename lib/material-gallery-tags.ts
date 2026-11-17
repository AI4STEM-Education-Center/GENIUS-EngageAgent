import { GALLERY_TAG_LABELS, type GalleryMaterial, type GalleryMetadata } from "./material-gallery";
import { toMisconceptionIds } from "./misconceptions";
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
  if (focus?.kind === "misconceptions") tags.KNOWLEDGE_GAP = focus.items.join("; ");
  else tags.KNOWLEDGE_GAP ||= tags.MISCONCEPTION_OR_GAP;
  if (focus?.kind === "coreIdeas") tags.TARGET_UNDERSTANDING = focus.items.join(" ");
  tags.SELECTED_STRATEGY = getEngagementStrategyLabel(strategy);
  if (metadata.focus) tags.FOCUS_ITEMS = [...metadata.focus.misconceptions.map(code => toMisconceptionIds(lessonNumber, code).join(" + ") || `Target ${code}`),
    ...metadata.focus.coreIdeas.map(index => `Core idea ${index + 1}`)].join(" · ");
  tags.LEARNER_CONTEXT = metadata.teachingContext || "Not shared";
  tags.CLASS_PROFILE = metadata.classProfile || "Not shared";
  tags.EXPERIENCE_CONTEXT = metadata.experienceContext || "Not supplied";
  if (strategy === "analogy" && draft?.analogyMethod) tags.ANALOGY_METHOD = draft.analogyMethod;
  if (metadata.keywords?.length) tags.KEYWORDS = metadata.keywords.join(", ");
  if (textModes?.length) tags.TEXT_MODES = textModes.join(", ");
  return Object.fromEntries(Object.entries(tags).filter(([key, value]) => key in GALLERY_TAG_LABELS && typeof value === "string")
    .map(([key, value]) => [key, value.slice(0, 4000)]));
}

export function galleryMatches(material: GalleryMaterial, lesson: number, strategy: string, focus?: { misconceptions: string[]; coreIdeas: number[] }, contextTags?: Record<string, string>) {
  const reasons: string[] = [];
  const sameLesson = material.lessonNumber === lesson && (!material.promptTags || !contextTags
    || ["TOPIC", "LEARNING_OBJECTIVE"].every(key => material.promptTags?.[key] === contextTags[key]));
  const sameStrategy = material.strategy === strategy;
  const overlappingFocus = sameLesson && material.focus && focus
    ? material.focus.misconceptions.filter(id => focus.misconceptions.includes(id)).length + material.focus.coreIdeas.filter(id => focus.coreIdeas.includes(id)).length : 0;
  const normalize = (value?: string) => value?.trim().toLocaleLowerCase().replace(/[–—]/gu, "-").replace(/\s+/gu, " ") || "";
  const equal = (a?: string, b?: string) => Boolean(normalize(a) && normalize(b) && !/^(not |unknown)/u.test(normalize(a)) && normalize(a) === normalize(b));
  const tags = [
    { label: "Lesson", value: `Lesson ${material.lessonNumber}`, matched: sameLesson },
    { label: "Strategy", value: getEngagementStrategyLabel(material.strategy), matched: sameStrategy },
    { label: "Focus", value: material.promptTags?.FOCUS_ITEMS || (material.focus ? [...material.focus.misconceptions.map(id => `Target ${id}`), ...material.focus.coreIdeas.map(i => `Core idea ${i + 1}`)].join(" · ") : "Not recorded"), matched: overlappingFocus > 0 },
    { label: "Grade", value: material.gradeBand || "Not provided", matched: equal(material.gradeBand, contextTags?.GRADE_LEVEL) },
    { label: "Prior quiz", value: material.quizPattern || "Not recorded", matched: equal(material.quizPattern, contextTags?.CURRENT_UNDERSTANDING) },
    { label: "Experience", value: material.experienceContext || "Not provided", matched: equal(material.experienceContext, contextTags?.EXPERIENCE_CONTEXT) },
    { label: "Format", value: material.format === "video" ? "Animated video" : "Slide deck", matched: equal(material.format, contextTags?.FORMAT) },
  ];
  if (sameLesson) reasons.push("Same lesson");
  if (sameStrategy) reasons.push("Same strategy");
  if (overlappingFocus) reasons.push("Same focus");
  for (const tag of tags.slice(3)) if (tag.matched) reasons.push(`Same ${tag.label.toLowerCase()}`);
  // Each known matching dimension has equal weight, like the prototype.
  // Two shared focus items break ties without outweighing another dimension.
  return { score: tags.filter(tag => tag.matched).length * 10 + Math.max(0, overlappingFocus - 1), reasons, tags };
}
