import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ published: vi.fn(), save: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/nosql", () => ({ listPublishedContent: mocks.published, upsertReviewQuestions: mocks.save, listReviewQuestions: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: mocks.guard }));
import { POST } from "@/app/api/review-questions/route";
const publishedAt = "2026-11-17T14:00:00.000Z";
const scope = { classId: "c1", assignmentId: "a1", studentId: "s1" };
const binding = { contentItemId: "material-a", publishedAt };
const call = (body: object) => POST(new Request("http://localhost/api/review-questions", { method: "POST", body: JSON.stringify({ ...scope, ...body }) }));
beforeEach(() => {
  vi.resetAllMocks(); mocks.guard.mockResolvedValue(null); mocks.save.mockImplementation(async value => value);
  mocks.published.mockResolvedValue([{ class_id: "CLASS#c1", assignment_id: "a1", published: true, content_item_id: binding.contentItemId, published_at: publishedAt }]);
});
it("preserves attribution while trimming questions and removing blank entries", async () => {
  const response = await call({ questions: [" Why? ", "", "How?"], questionMaterials: [binding, null, null] });
  expect(response.status).toBe(201);
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ questions: ["Why?", "How?"], questionMaterials: [binding, null] }));
});
it.each([
  { ...binding, publishedAt: "2026-11-16T14:00:00.000Z" },
  { ...binding, contentItemId: "another-material" },
])("rejects unavailable or replaced publication versions", async wrong => {
  expect((await call({ questions: ["Why?"], questionMaterials: [wrong] })).status).toBe(409);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("rejects a matching identifier belonging to another class", async () => {
  mocks.published.mockResolvedValue([{ class_id: "other", assignment_id: "a1", published: true, content_item_id: binding.contentItemId, published_at: publishedAt }]);
  expect((await call({ questions: ["Why?"], questionMaterials: [binding] })).status).toBe(409);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("retains the legacy whole-activity submission contract", async () => {
  expect((await call({ questions: ["Why?"] })).status).toBe(201);
  expect(mocks.published).not.toHaveBeenCalled();
  expect(mocks.save.mock.calls[0][0]).not.toHaveProperty("questionMaterials");
});
