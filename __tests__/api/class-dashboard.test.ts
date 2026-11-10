import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ denied: null as Response | null }));
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceClassRequest: vi.fn(async () => state.denied) }));
vi.mock("@/lib/session", () => ({ sessionUser: vi.fn(async () => ({ geniusId: "t1", userId: "t1", name: "T", email: null, role: "teacher" })) }));
vi.mock("@/lib/class-dashboard", async () => {
  const { BoardError } = await import("@/lib/class-questions");
  return {
    BoardError,
    getClassDashboard: vi.fn(async () => ({ tasks: [], misconceptions: [], questions: [] })),
    addQuestionToBoard: vi.fn(async () => { throw new BoardError("The board holds at most 20 questions."); }),
  };
});

import { GET, POST } from "@/app/api/class-dashboard/route";
import { getClassDashboard } from "@/lib/class-dashboard";

beforeEach(() => { state.denied = null; vi.mocked(getClassDashboard).mockClear(); });
const origin = "http://localhost";

it("returns the class dashboard for the class's teacher (#207)", async () => {
  const res = await GET(new Request(`${origin}/api/class-dashboard?classId=ea-class-1`));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ tasks: [], misconceptions: [], questions: [] });
  expect(vi.mocked(getClassDashboard).mock.calls[0][1]).toBe("ea-class-1");
});

it("stops at the class guard", async () => {
  state.denied = new Response(null, { status: 403 });
  expect((await GET(new Request(`${origin}/api/class-dashboard?classId=ea-class-1`))).status).toBe(403);
  expect(getClassDashboard).not.toHaveBeenCalled();
});

it("explains a full board", async () => {
  const res = await POST(new Request(`${origin}/api/class-dashboard`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ classId: "ea-class-1", questionId: "1".repeat(16), fromAssignmentId: "a", toAssignmentId: "b" }) }));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("The board holds at most 20 questions.");
});
