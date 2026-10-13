import { describe, it, expect, beforeEach, vi } from "vitest";

// Route behavior below assumes an authorized request. Signed native/GENIUS
// access and role isolation are exercised in workspace-access and embedded-workflow-access.
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null), workspaceRequestUser: vi.fn(async () => ({ role: "teacher" })) }));
import { GET, POST } from "@/app/api/quiz-status/route";

// Mock nosql module
vi.mock("@/lib/nosql", () => {
  let store: Record<string, unknown> = {};
  return {
    getQuizStatus: vi.fn(async (classId: string, assignmentId: string) => {
      return store[`${classId}:${assignmentId}`] ?? null;
    }),
    upsertQuizStatus: vi.fn(async (classId: string, assignmentId: string, lessonNumber: number, status: string, publishedBy?: string, quizVersion?: number) => {
      const record = { class_id: classId, assignment_id: assignmentId, lesson_number: lessonNumber, status, published_by: publishedBy, quiz_version: quizVersion, updated_at: new Date().toISOString() };
      store[`${classId}:${assignmentId}`] = record;
      return record;
    }),
    __resetStore: () => { store = {}; },
  };
});

const { __resetStore } = await import("@/lib/nosql") as unknown as { __resetStore: () => void };

beforeEach(() => {
  __resetStore();
});

describe("GET /api/quiz-status", () => {
  it("should return 400 if classId is missing", async () => {
    const req = new Request("http://localhost:3000/api/quiz-status?assignmentId=a1");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("should return 400 if assignmentId is missing", async () => {
    const req = new Request("http://localhost:3000/api/quiz-status?classId=c1");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("should return null when no quiz status exists", async () => {
    const req = new Request("http://localhost:3000/api/quiz-status?classId=c1&assignmentId=a1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.quizStatus).toBeNull();
  });

  it("should return 500 with a helpful error when storage fails", async () => {
    const { getQuizStatus } = await import("@/lib/nosql");
    vi.mocked(getQuizStatus).mockRejectedValueOnce(new Error("Requested resource not found"));

    const req = new Request("http://localhost:3000/api/quiz-status?classId=c1&assignmentId=a1");
    const res = await GET(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Database resource not found. Check DYNAMODB_TABLE and ENGAGE_AWS_REGION.");
  });

});

describe("POST /api/quiz-status", () => {
  it("should create a quiz status record", async () => {
    const req = new Request("http://localhost:3000/api/quiz-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", lessonNumber: 3, status: "draft" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.quizStatus.lesson_number).toBe(3);
    expect(data.quizStatus.status).toBe("draft");
  });

  it("should publish a quiz", async () => {
    // Create draft first
    await POST(new Request("http://localhost:3000/api/quiz-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", lessonNumber: 3, status: "draft" }),
    }));

    // Publish
    const req = new Request("http://localhost:3000/api/quiz-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", lessonNumber: 3, status: "published", publishedBy: "teacher-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.quizStatus.status).toBe("published");
    expect(data.quizStatus.quiz_version).toBe(2);
  });

  it("preserves the question version when closing an existing quiz", async () => {
    const { getQuizStatus } = await import("@/lib/nosql");
    vi.mocked(getQuizStatus).mockResolvedValueOnce({ class_id: "c1", assignment_id: "a1", lesson_number: 3, status: "published", updated_at: "2026-10-01" });
    const res = await POST(new Request("http://localhost:3000/api/quiz-status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", lessonNumber: 3, status: "closed" }),
    }));
    expect((await res.json()).quizStatus.quiz_version).toBe(1);
  });

  it.each([0, 9, 1.5, "2"])("rejects an unavailable lesson %s", async lessonNumber => {
    const res = await POST(new Request("http://localhost:3000/api/quiz-status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", lessonNumber, status: "published" }),
    }));
    expect(res.status).toBe(400);
  });

  it("should reject invalid status", async () => {
    const req = new Request("http://localhost:3000/api/quiz-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", lessonNumber: 3, status: "invalid" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should reject missing fields", async () => {
    const req = new Request("http://localhost:3000/api/quiz-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
