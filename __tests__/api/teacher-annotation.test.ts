import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null) }));
vi.mock("@/lib/nosql", () => ({ recordTeacherAnnotation: vi.fn(async (record: object) => ({ id: "annotation-1", ...record })) }));

import { POST } from "@/app/api/teacher-annotation/route";
import { recordTeacherAnnotation } from "@/lib/nosql";
import { getLesson } from "@/lib/quiz-data";

const post = (fields: Record<string, unknown>) => POST(new Request("http://localhost/api/teacher-annotation", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ classId: "ea-class-1", overallRecommendation: "Cognitive Conflict", ...fields }),
}));
const recorded = () => vi.mocked(recordTeacherAnnotation).mock.calls[0][0];

beforeEach(() => vi.clearAllMocks());

it("records a different strategy as a disagreement without requiring a reason (#178)", async () => {
  const response = await post({ decision: "disagree", reason: null, selectedStrategies: ["analogy"] });
  expect(response.status).toBe(200);
  expect(recorded()).toMatchObject({ decision: "disagree", reason: null, selected_strategies: ["analogy"], workspace_class_id: "ea-class-1" });
  expect(recorded()).not.toHaveProperty("strategy_focus");
});

it("keeps an optional reason, trimmed", async () => {
  await post({ decision: "disagree", reason: "  We did a demo last week.  ", selectedStrategies: ["analogy"] });
  expect(recorded().reason).toBe("We did a demo last week.");
});

it("stores the focus in the lesson's own wording", async () => {
  const response = await post({ decision: "agree", selectedStrategies: ["cognitive conflict"], lessonNumber: 8, focus: { misconceptions: ["3-a"] } });
  expect(response.status).toBe(200);
  expect(recorded().strategy_focus).toEqual({ kind: "misconceptions", items: [getLesson(8)!.misconceptions["3-a"]] });
});

it.each([
  ["an unknown misconception", { lessonNumber: 8, selectedStrategies: ["cognitive conflict"], focus: { misconceptions: ["nope"] } }],
  ["too many core ideas", { lessonNumber: 8, selectedStrategies: ["analogy"], focus: { coreIdeas: [0, 1, 2] } }],
  ["no lesson number", { selectedStrategies: ["analogy"], focus: { coreIdeas: [0] } }],
  ["no strategy", { lessonNumber: 8, focus: { coreIdeas: [0] } }],
])("rejects a focus with %s and records nothing", async (_, fields) => {
  const response = await post({ decision: "agree", ...fields });
  expect(response.status).toBe(400);
  expect(recordTeacherAnnotation).not.toHaveBeenCalled();
});

it("still requires a decision", async () => {
  expect((await post({ selectedStrategies: ["analogy"] })).status).toBe(400);
});
