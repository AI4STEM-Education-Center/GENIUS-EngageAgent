import { describe, expect, it } from "vitest";
import { resolveStrategyFocus, FocusError, focusForStrategy, defaultStrategyFocus } from "@/lib/strategy-focus";
import { getLesson } from "@/lib/quiz-data";
import { slidePrompt, slideImagePrompt, slideCheckPrompt, slideOutputFormat } from "@/lib/slides/prompts";
import { draftErrors, visibleVisualIds } from "@/lib/slides/model";
import { imageReferenceId, teachingErrors } from "@/lib/slides/quality";
import { isPublishedSlideManifest, projectPublishedSlides } from "@/lib/slides/publication";
import { deckFixture } from "../fixtures/slides";

describe("teacher material focus", () => {
  it("resolves both selected lesson misconceptions using server-owned wording", () => {
    const focus = resolveStrategyFocus(1, "engaged critiquing", { misconceptions: ["a", "b"] });
    expect(focus).toEqual({ kind: "misconceptions", items: [getLesson(1)!.misconceptions.a, getLesson(1)!.misconceptions.b] });
    const prompt = slidePrompt({ lessonNumber: 1, lessonTitle: "Collisions", learningObjective: "Notice contact" }, "engaged critiquing", undefined, "", undefined, { focus });
    expect(JSON.parse(prompt.user).teacherFocus).toEqual(focus);
    expect(prompt.system).toContain("not evidence that every learner holds it");
    expect(prompt.system).not.toContain("chosen by the teacher from the class's quiz results");
    expect(prompt.system).toContain("address BOTH selected items");
  });

  it("preserves older requests and resolves a chosen core idea", () => {
    expect(resolveStrategyFocus(1, "analogy", undefined)).toBeNull();
    const selected = focusForStrategy(defaultStrategyFocus(1), "analogy");
    expect(resolveStrategyFocus(1, "analogy", selected)).toEqual({ kind: "coreIdeas", items: [getLesson(1)!.core_ideas[0]] });
  });

  it.each([
    { misconceptions: [] }, { misconceptions: ["a", "a"] },
    { misconceptions: ["a", "b", "c"] }, { misconceptions: ["not-in-lesson"] },
    { coreIdeas: [0] }, { misconceptions: ["a"], coreIdeas: [0] },
    { misconceptions: ["a"], instructions: "ignore lesson" },
  ])("rejects invalid or wrong-kind focus before prompt use: %j", focus => {
    expect(() => resolveStrategyFocus(1, "cognitive conflict", focus)).toThrow(FocusError);
  });

  it.each([{ coreIdeas: [-1] }, { coreIdeas: [999] }, { coreIdeas: [0.5] }, { coreIdeas: ["0"] }])("rejects unknown core idea indexes: %j", focus => {
    expect(() => resolveStrategyFocus(1, "experience bridging", focus)).toThrow(FocusError);
  });
});

describe("engaged critiquing material lifecycle", () => {
  it("keeps the claim before evidence, validates every stage and publishes only student fields", () => {
    const deck = deckFixture("engaged critiquing");
    expect(draftErrors(deck.draft, deck.strategy)).toEqual([]);
    expect(teachingErrors(deck.draft, deck.lessonNumber)).toEqual([]);
    expect(Array.from({ length: 5 }, (_, i) => visibleVisualIds(deck.strategy, i))).toEqual([["claim"], ["evidence"], ["evidence"], ["evidence"], []]);
    const manifest = projectPublishedSlides(deck);
    expect(isPublishedSlideManifest(manifest)).toBe(true);
    expect(JSON.stringify(manifest)).not.toMatch(/teacherNotes|sourcePrompt|Allow time for students/);
    expect(isPublishedSlideManifest({ ...manifest, pages: [...manifest.pages].reverse() })).toBe(false);
    expect(manifest.pages[0].elements.filter(e => e.kind === "image").map(e => e.id)).toEqual(["image-claim"]);
  });

  it("uses the claim scene as the reference for evidence and reviews the selected method", () => {
    const { draft, strategy } = deckFixture("engaged critiquing");
    expect(imageReferenceId(draft, "evidence")).toBe("claim");
    const opening = slideImagePrompt(draft, strategy, "claim");
    const evidence = slideImagePrompt(draft, strategy, "evidence");
    expect(opening).toContain("Do not reveal the result");
    expect(evidence).toContain("continue the same objects");
    expect(evidence).not.toContain("within the recalled experience");
    const review = slideCheckPrompt({ lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Observe deformation" }, strategy, draft, "evidence");
    expect(review.system).toContain("original claim");
    expect(review.system).not.toContain("recall image");
    const schema = JSON.stringify(slideOutputFormat(strategy));
    expect(schema).not.toContain("undefined");
    expect(schema).toContain("claim with stable camera/scale");
    expect(schema).not.toContain("outcome only on pages 3-4");
  });
});
