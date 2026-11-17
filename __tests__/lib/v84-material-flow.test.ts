import { expect, it } from "vitest";
import { quizBand, parseTeachingContext } from "@/lib/material-teaching-context";
import { slideVideo, preserveSlideVideos } from "@/lib/slides/video";
import { reviewTarget } from "@/lib/slides/review-target";
import { galleryMatches } from "@/lib/material-gallery-tags";
import { isPublishedSlideManifest, projectPublishedSlides } from "@/lib/slides/publication";
import { parseExperienceSuggestions } from "@/lib/material-experiences";
import { applyVideoTextAdaptation } from "@/lib/material-video-adaptation";
import { conflictActivity } from "../fixtures/material-activities";
import type { GalleryMaterial } from "@/lib/material-gallery";
import { deckFixture } from "../fixtures/slides";

it("uses real response denominators and keeps unknown teaching data unknown", () => {
  expect([quizBand(0, 0), quizBand(54, 100), quizBand(55, 100), quizBand(70, 100), quizBand(71, 100)]).toEqual(["", "Under 55% correct", "55–70% correct", "55–70% correct", "Over 70% correct"]);
  expect(parseTeachingContext({ gradeBand: " Middle school ", experienceContext: "Soccer" })).toEqual({ gradeBand: "Middle school", experienceContext: "Soccer" });
  expect(() => parseTeachingContext({ studentName: "Do not copy" })).toThrow();
});

it("ranks all seven dimensions and never rewards two missing values", () => {
  const material: GalleryMaterial = { id: "fixture", revision: 1, title: "Contact forces", description: "", createdAt: "2026-11-16", isOwner: false,
    lessonNumber: 3, strategy: "analogy", format: "slides", focus: { coreIdeas: [0], misconceptions: [] },
    gradeBand: "Middle school", quizPattern: "55–70% correct", experienceContext: "Soccer", promptTags: { TOPIC: "Collisions", LEARNING_OBJECTIVE: "Explore forces" } };
  const tags = { ...material.promptTags, GRADE_LEVEL: "Middle school", CURRENT_UNDERSTANDING: "55–70% correct", EXPERIENCE_CONTEXT: "soccer", FORMAT: "slides" };
  expect(galleryMatches(material, 3, "analogy", material.focus, tags).tags.filter(tag => tag.matched)).toHaveLength(7);
  const missing = { ...material, gradeBand: "", quizPattern: "", experienceContext: "" };
  expect(galleryMatches(missing, 3, "analogy", material.focus, tags).score).toBeLessThan(galleryMatches(material, 3, "analogy", material.focus, tags).score);
  expect(galleryMatches(missing, 3, "analogy", material.focus, material.promptTags).tags.filter(tag => tag.matched)).toHaveLength(3);
});

it.each(["javascript:alert(1)", "https://localhost/a.mp4", "https://127.0.0.1/a.mp4", "https://host.local/a.mp4", "https://user:password@example.com/a.mp4", "https://example.com/page", "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ"])("rejects unsafe or non-video links: %s", url => {
  expect(slideVideo(url)).toBeNull();
});

it("publishes playable video references without exposing teacher-only fields and keeps them through AI edits", () => {
  const deck = deckFixture("cognitive conflict");
  deck.draft.slides[0].videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  expect(slideVideo(deck.draft.slides[0].videoUrl)?.embed).toContain("youtube-nocookie.com/embed/");
  const revised = structuredClone(deck.draft); delete revised.slides[0].videoUrl;
  expect(preserveSlideVideos(deck.draft, revised).slides[0].videoUrl).toBe(deck.draft.slides[0].videoUrl);
  const manifest = projectPublishedSlides(deck);
  expect(isPublishedSlideManifest(manifest)).toBe(true);
  expect(manifest.pages[0].videoUrl).toBe(deck.draft.slides[0].videoUrl);
  expect(JSON.stringify(manifest)).not.toContain("teacherNotes");
  expect(isPublishedSlideManifest({ ...manifest, pages: manifest.pages.map((page, i) => i === 0 ? { ...page, videoUrl: "javascript:alert(1)" } : page) })).toBe(false);
});

it("targets grounded slide and image findings without treating arbitrary numbers as slide IDs", () => {
  const deck = deckFixture("cognitive conflict");
  expect(reviewTarget("Slide 2.task: Ask one question.", deck)).toEqual({ slideIndex: 1 });
  expect(reviewTarget("Image evidence.prompt: Keep the objects consistent.", deck)).toMatchObject({ visualId: "evidence" });
  expect(reviewTarget("Use 2 arrows.", deck)).toEqual({});
  expect(reviewTarget("Slide 99.task: Invalid reference.", deck)).toEqual({});
});

it("does not accept invented student experiences from an AI fit assessment", () => {
  const suggestions = [{ activity: "Trampoline", reason: "Compare contact and deformation." }];
  expect(parseExperienceSuggestions({ suggestions, fit: [{ activity: "Soccer", fit: "good", reason: "Shows contact." }] }, ["Soccer"]).suggestions).toEqual(suggestions);
  expect(() => parseExperienceSuggestions({ suggestions, fit: [{ activity: "Made up", fit: "good", reason: "Not reported." }] }, ["Soccer"])).toThrow();
});

it("keeps the actual video scene, evidence and prediction sequence when AI adapts stage text", () => {
  const original = { id: "video", type: "Video", title: "Contact", body: "Observe", strategy: "cognitive conflict", activity: conflictActivity, visualBrief: "The saved scene" };
  const input = { title: "Watch the ball", stages: conflictActivity.stages, image: { scene: "A different scene" }, observedOutcome: "Invented" };
  const adapted = applyVideoTextAdaptation(original, input);
  expect(adapted.activity?.image).toEqual(conflictActivity.image);
  expect(adapted.activity?.observedOutcome).toBe(conflictActivity.observedOutcome);
  expect(adapted.visualBrief).toBe(original.visualBrief);
  expect(() => applyVideoTextAdaptation(original, { ...input, stages: input.stages.slice(1) })).toThrow();
  const leak = input.stages.map((stage, i) => i === 0 ? { ...stage, text: "The ball squashes against the table during contact." } : stage);
  expect(() => applyVideoTextAdaptation(original, { ...input, stages: leak })).toThrow(/revealed evidence/);
});
