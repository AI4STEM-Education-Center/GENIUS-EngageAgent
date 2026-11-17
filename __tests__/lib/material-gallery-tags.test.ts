import { expect, it } from "vitest";
import { galleryMatches, galleryPromptTags } from "@/lib/material-gallery-tags";
import type { GalleryMaterial } from "@/lib/material-gallery";
import { slidePrompt } from "@/lib/slides/prompts";
import { getLessonGenerationContext } from "@/lib/lesson-context";
import { getLesson } from "@/lib/quiz-data";
import { runInLessonScope } from "@/lib/lesson-scope";

it.each(["analogy", "cognitive conflict", "experience bridging", "engaged critiquing"] as const)("keeps every slide prompt dimension as a searchable tag for %s", strategy => {
  const tags = galleryPromptTags(3, strategy, "slides", { title: "Shared" });
  const keys = Object.keys(JSON.parse(slidePrompt(getLessonGenerationContext(3)!, strategy).user).referenceVariables);
  for (const key of keys) expect(tags[key]).toEqual(expect.any(String));
  expect(tags.CURRENT_UNDERSTANDING).toBe("Not shared");
  expect(tags.LEARNER_CONTEXT).toBe("Not shared");
  expect(tags.CLASS_PROFILE).toBe("Not shared");
});

it("uses the task's configured curriculum and selected focus, not a numbered-lesson default", () => {
  const custom = { ...getLesson(3)!, topic: "Waves", target_concept: "Energy transfer by waves", learning_objective: "Compare traveling waves", core_ideas: ["Waves transfer energy"] };
  runInLessonScope([custom], () => {
    const tags = galleryPromptTags(3, "analogy", "slides", { title: "Shared", focus: { coreIdeas: [0], misconceptions: [] } });
    expect(tags).toMatchObject({ TOPIC: "Waves", TARGET_CONCEPT: "Energy transfer by waves", TARGET_UNDERSTANDING: "Waves transfer energy", LEARNING_OBJECTIVE: "Compare traveling waves" });
  });
});

it("does not recommend a different curriculum as the same lesson/focus just because local numbers and codes overlap", () => {
  const material = { lessonNumber: 3, strategy: "analogy", focus: { coreIdeas: [0], misconceptions: [] }, promptTags: { TOPIC: "Waves", LEARNING_OBJECTIVE: "Compare traveling waves" } } as unknown as GalleryMaterial;
  expect(galleryMatches(material, 3, "analogy", material.focus, { TOPIC: "Collisions", LEARNING_OBJECTIVE: "Compare contact forces" })).toMatchObject({ score: 10, reasons: ["Same strategy"] });
  expect(galleryMatches(material, 3, "analogy", material.focus, material.promptTags)).toMatchObject({ score: 30, reasons: ["Same lesson", "Same strategy", "Same focus"] });
});


it("records the selected misconception parameters without adding unselected focus items", () => {
  const tags = galleryPromptTags(3, "cognitive conflict", "slides", { title: "Shared", focus: { misconceptions: ["a"], coreIdeas: [] } });
  expect(tags.FOCUS_ITEMS).toBe("MC08");
  expect(tags.KNOWLEDGE_GAP).toBe(tags.MISCONCEPTION_OR_GAP);
  expect(tags.KNOWLEDGE_GAP).not.toContain("Same force always");
});
