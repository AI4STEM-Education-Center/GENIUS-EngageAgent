import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ published: vi.fn(), ratings: vi.fn(), questions: vi.fn(), analysis: vi.fn() }));
vi.mock("@/lib/nosql", () => ({ listPublishedContent: mocks.published, listContentRatings: mocks.ratings, listReviewQuestions: mocks.questions, getTaskDoc: mocks.analysis }));
import { galleryFeedback, indexGalleryUse, indexPublishedGalleryUse } from "@/lib/material-gallery-feedback";
import { workspacePut } from "@/lib/workspace-store";
import { collectQuestions, questionsSourceKey, QUESTION_ANALYSIS_VERSION } from "@/lib/class-questions";
let directory: string;
const scope = { classId: "class-feedback", assignmentId: "task-feedback" };
const row = { class_id: scope.classId, assignment_id: scope.assignmentId };
const since = "2026-11-16T15:00:00.000Z";
const at = "2026-11-16T15:10:00.000Z";
const publication = (id = "slides-copy") => ({ ...row, content_item_id: id, published: true, published_at: since });
const rating = (student: string, value: number, id = "slides-copy") => ({ ...row, student_id: student, content_item_id: id, rating: value, rated_at: at });
beforeEach(async () => {
  vi.resetAllMocks(); directory = await fs.mkdtemp(path.join(os.tmpdir(), "gallery-feedback-"));
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DYNAMODB_TABLE", ""); vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", directory);
  mocks.published.mockResolvedValue([publication()]); mocks.ratings.mockResolvedValue([]); mocks.questions.mockResolvedValue([]); mocks.analysis.mockResolvedValue(null);
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

it("counts real published-material feedback, not pending copies, other classes or obsolete ratings", async () => {
  await indexGalleryUse("template", scope, "slides-copy");
  mocks.published.mockResolvedValue([]); mocks.ratings.mockResolvedValue([rating("s1", 5)]);
  expect(await galleryFeedback("template")).toMatchObject({ ratingCount: 0, activityCount: 0, averageRating: null });
  mocks.published.mockResolvedValue([publication()]);
  mocks.ratings.mockResolvedValue([rating("s1", 5), rating("s2", 3), rating("s3", 4),
    { ...rating("old", 1), rated_at: "2026-11-15T00:00:00.000Z" },
    { ...rating("other", 1), assignment_id: "other-task" }, { ...rating("other-class", 1), class_id: "other-class" }, rating("invalid", 6), rating("other-item", 1, "not-this-material")]);
  const result = await galleryFeedback("template");
  expect(result).toMatchObject({ status: "available", ratingCount: 3, averageRating: 4, highRatingPercent: 67, activityCount: 1 });
  expect(JSON.stringify(result)).not.toMatch(/student_id|class-feedback|task-feedback|slides-copy/);
});

it("deduplicates repeat learners across copies and never attributes a multi-material activity's questions", async () => {
  await indexGalleryUse("template", scope, "slides-copy"); await indexGalleryUse("template", scope, "slides-another-copy");
  mocks.published.mockResolvedValue([publication(), publication("slides-another-copy")]);
  mocks.ratings.mockResolvedValue([rating("same-student", 1), { ...rating("same-student", 5, "slides-another-copy"), rated_at: "2026-11-16T15:20:00.000Z" }]);
  mocks.questions.mockResolvedValue([{ ...row, student_id: "same-student", questions: ["PRIVATE_QUESTION"], submitted_at: at }]);
  expect(await galleryFeedback("template")).toMatchObject({ ratingCount: 1, averageRating: 5, questionCount: 0, attributableActivities: 0 });
});

it("uses existing current question analysis without invoking AI or disclosing student text", async () => {
  await indexGalleryUse("template", scope, "slides-copy");
  const records = [{ ...row, student_id: "PRIVATE_STUDENT", questions: ["PRIVATE_QUESTION_ONE", "PRIVATE_QUESTION_TWO"], submitted_at: at }];
  mocks.questions.mockResolvedValue(records);
  const questions = collectQuestions(records, new Map());
  const analysis = { version: QUESTION_ANALYSIS_VERSION, sourceKey: questionsSourceKey(questions), items: {
    [questions[0].id]: { tag: "Investigable" }, [questions[1].id]: { tag: "Clarifying" },
  } };
  mocks.analysis.mockResolvedValue(analysis);
  const result = await galleryFeedback("template");
  expect(result).toMatchObject({ questionCount: 2, questionAuthorCount: 1, analyzedQuestionCount: 2, scienceQuestionPercent: 50 });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  mocks.analysis.mockResolvedValue({ ...analysis, sourceKey: "outdated" });
  expect(await galleryFeedback("template")).toMatchObject({ questionCount: 2, analyzedQuestionCount: 0, scienceQuestionPercent: null });
});

it("resolves ownership from saved receipts and treats read failures as unavailable, not zero", async () => {
  const copyId = "cda6e16b-b41a-4c9c-b214-6f3fc1797591";
  const partition = `GALLERY_LIBRARY#${createHash("sha256").update("owner").digest("hex")}`;
  await workspacePut([{ partition, key: `COPY#${copyId}`, value: { ownerId: "owner", templateId: "template" } }]);
  await indexPublishedGalleryUse(scope, "intruder", `slides-${copyId}`);
  expect(await galleryFeedback("template")).toMatchObject({ activityCount: 0 });
  await indexPublishedGalleryUse(scope, "owner", `slides-${copyId}`);
  mocks.published.mockResolvedValue([publication(`slides-${copyId}`)]);
  expect(await galleryFeedback("template")).toMatchObject({ activityCount: 1 });
  mocks.ratings.mockRejectedValue(new Error("PRIVATE_STORAGE_ERROR"));
  expect(await galleryFeedback("template")).toEqual({ status: "unavailable" });
});

it("attributes multi-material questions only to their selected publication version", async () => {
  await indexGalleryUse("template", scope, "slides-copy");
  mocks.published.mockResolvedValue([publication(), publication("another")]);
  mocks.questions.mockResolvedValue([{ ...row, student_id: "s1", submitted_at: at,
    questions: ["Current question?", "Other material?", "Old version?", "Whole activity?"],
    questionMaterials: [{ contentItemId: "slides-copy", publishedAt: since }, { contentItemId: "another", publishedAt: since }, { contentItemId: "slides-copy", publishedAt: "2026-11-15T00:00:00.000Z" }, null] }]);
  expect(await galleryFeedback("template")).toMatchObject({ questionCount: 1, questionAuthorCount: 1, attributableActivities: 1, firstPublicationAt: since, lastFeedbackAt: at });
});

it("counts distinct verified publishers of active copies separately from private saves", async () => {
  for (const id of ["one", "two", "three", "withdrawn", "unknown"]) await indexGalleryUse("template", scope, id);
  mocks.published.mockResolvedValue([
    { ...publication("one"), published_by: "teacher-a" }, { ...publication("two"), published_by: "teacher-a" },
    { ...publication("three"), published_by: "teacher-b" }, { ...publication("withdrawn"), published_by: "teacher-c", published: false }, publication("unknown"),
  ]);
  mocks.ratings.mockResolvedValue([{ ...rating("stale-version", 1, "one"), published_at: "2026-11-15T00:00:00.000Z" }, { ...rating("current", 5, "one"), published_at: since }]);
  const result = await galleryFeedback("template");
  expect(result).toMatchObject({ publishedTeacherCount: 2, ratingCount: 1, averageRating: 5 });
  expect(JSON.stringify(result)).not.toMatch(/teacher-a|teacher-b|teacher-c/);
});
