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
  expect(screen.getByText("★ 4.5/5 · 12 ratings")).toBeTruthy();
  expect(screen.getByText("Questions: 18 · 9 learners")).toBeTruthy();
  expect(screen.getByText(/Learning gain: not measured/)).toBeTruthy();
  expect(screen.getByText(/Questions are attributed to the material version selected by the learner/)).toBeTruthy();
});
it("does not present a data failure as a zero rating or invented learning result", () => {
  render(<GalleryMaterialDetails feedback={{ status: "unavailable" }} />);
  expect(screen.getByText("Student feedback unavailable")).toBeTruthy();
  expect(screen.queryByText(/0\/5|No student ratings yet/)).toBeNull();
});

it("distinguishes original authors, version sharers and undocumented ancestry", () => {
  const derivedFrom = { templateId: "public-parent", revision: 1, title: "Source" };
  const { rerender } = render(<GalleryMaterialDetails derivedFrom={derivedFrom} originalCreatorName="Avery" creatorName="Blair" />);
  expect(screen.getByText("Original author: Avery")).toBeTruthy();
  expect(screen.getByText("This version shared by Blair")).toBeTruthy();
  rerender(<GalleryMaterialDetails derivedFrom={derivedFrom} creatorName="Blair" />);
  expect(screen.getByText("Original author not recorded")).toBeTruthy();
  rerender(<GalleryMaterialDetails creatorName="Avery" />);
  expect(screen.getByText("By Avery")).toBeTruthy();
  expect(screen.queryByText(/This version shared by/)).toBeNull();
});
