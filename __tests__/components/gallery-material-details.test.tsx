// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import GalleryMaterialDetails from "@/app/components/GalleryMaterialDetails";
afterEach(cleanup);
it("shows all seven prototype dimensions and keeps outcomes separate from generation inputs", () => {
  render(<GalleryMaterialDetails lessonNumber={3} strategy="cognitive conflict" format="slides" focus={{ misconceptions: ["a", "b"], coreIdeas: [] }}
    gradeBand="Middle school" quizPattern="Under 55% correct" experienceContext="Soccer" creatorName="Teacher" teacherCount={6}
    promptTags={{ SUBJECT: "Physics", TARGET_CONCEPT: "Temporary deformation", KEYWORDS: "collisions, visual learning" }}
    feedback={{ status: "available", ratingCount: 12, averageRating: 4.5, highRatingPercent: 83, activityCount: 2, questionCount: 18, questionAuthorCount: 9,
      attributableActivities: 2, analyzedQuestionCount: 10, questionTypes: { Investigable: 5, "Explanation-seeking": 3, Clarifying: 2, "Off-topic": 0 }, scienceQuestionPercent: 80 }} />);
  const tags = within(screen.getByRole("list", { name: "Material tags" }));
  for (const title of ["Lesson: 3", "Strategy: Cognitive Conflict", "Focus: MC08 · MC09", "Grade: Middle school", "Prior quiz: Under 55% correct", "Experience: Soccer", "Format: Slide deck"]) expect(tags.getByTitle(title)).toBeTruthy();
  expect(screen.getByText("Student engagement in linked classroom copies")).toBeTruthy();
  expect(screen.getByText("★ 4.5/5 · 12 ratings")).toBeTruthy();
  expect(screen.getByText("Questions: 18 · 9 learners")).toBeTruthy();
  expect(screen.getByText(/Learning gain: not measured/)).toBeTruthy();
  expect(screen.getByText(/Questions are attributed to the material version selected by the learner/)).toBeTruthy();
});
it.each([undefined, { status: "unavailable" } as const])("handles missing or unavailable feedback without reporting a zero rating", feedback => {
  render(<GalleryMaterialDetails feedback={feedback} />);
  expect(screen.getByText("Student feedback unavailable")).toBeTruthy();
  expect(screen.queryByText(/0\/5|No student ratings yet/)).toBeNull();
});


it("distinguishes original authors, version sharers and undocumented ancestry", () => {
  const derivedFrom = { templateId: "public-parent", revision: 1, title: "Source" };
  const { rerender } = render(<GalleryMaterialDetails derivedFrom={derivedFrom} originalCreatorName="Avery" creatorName="Blair" />);
  expect(screen.getByText("Original author: Avery")).toBeTruthy();
  expect(screen.getByText("This version shared by Blair")).toBeTruthy();
  expect(screen.getByText("Based on Source · Source version 1")).toBeTruthy();
  rerender(<GalleryMaterialDetails derivedFrom={derivedFrom} creatorName="Blair" />);
  expect(screen.getByText("Original author not recorded")).toBeTruthy();
  rerender(<GalleryMaterialDetails creatorName="Avery" />);
  expect(screen.getByText("By Avery")).toBeTruthy();
  expect(screen.queryByText(/This version shared by/)).toBeNull();
});

it("keeps live copy tags independent of the text generation receipt, including cleared settings", () => {
  const generation = { id: "test-receipt", format: "slides" as const, lessonNumber: 3, operation: "generate", strategy: "analogy", model: "test",
    capturedAt: "2026-11-24T00:00:00Z", promptHash: "h", focus: { kind: "coreIdeas" as const, origin: "operation" as const, items: [{ id: "L3-C1", label: "Original deformation concept" }] },
    tags: { FOCUS_ITEMS: "Original deformation concept", GRADE_LEVEL: "Original grade", EXPERIENCE_CONTEXT: "Original experience" } };
  const { rerender } = render(<GalleryMaterialDetails privateMaterial lessonNumber={3} strategy="analogy" focus={{ misconceptions: [], coreIdeas: [1] }} gradeBand="Current grade" generation={generation} promptTags={generation.tags} />);
  const current = within(screen.getByRole("list", { name: "Material tags" }));
  expect(current.getByTitle("Focus: Core idea 2")).toBeTruthy();
  expect(current.getByTitle("Grade: Current grade")).toBeTruthy();
  expect(current.getByTitle("Experience: Not provided")).toBeTruthy();
  const receipt = within(screen.getByText("Recorded generation inputs").closest("details")!);
  expect(receipt.getByText("Teaching focus at generation")).toBeTruthy();
  expect(receipt.getByText(/Original deformation concept/)).toBeTruthy();
  expect(receipt.getByText("Original grade")).toBeTruthy();
  rerender(<GalleryMaterialDetails privateMaterial lessonNumber={3} generation={generation} promptTags={generation.tags} />);
  expect(current.getByTitle("Focus: Not recorded")).toBeTruthy();
  expect(current.getByTitle("Grade: Not provided")).toBeTruthy();
});

it.each([[0, "bg-line-2"], [3, "bg-line-2"], [4, "bg-info-light"], [5, "bg-info-light"], [6, "bg-ok-light"], [7, "bg-ok-light"]] as const)(
  "retains the numeric match score and prototype badge tier at %i", (count, tone) => {
    const labels = ["Lesson", "Strategy", "Focus", "Grade", "Prior quiz", "Experience", "Format"];
    render(<GalleryMaterialDetails matchTags={labels.map((label, i) => ({ label, value: label, matched: i < count }))} />);
    expect(screen.getByText(`${count} of 7 match`).classList.contains(tone)).toBe(true);
  }
);
