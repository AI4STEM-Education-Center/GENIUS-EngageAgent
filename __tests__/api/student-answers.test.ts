import { describe, it, expect, beforeEach, vi } from "vitest";

// Route behavior below assumes an authorized request. Signed native/GENIUS
// access and role isolation are exercised in workspace-access and embedded-workflow-access.
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null), workspaceRequestUser: vi.fn(async () => ({ role: "teacher" })) }));
import { GET, POST } from "@/app/api/student-answers/route";

vi.mock("@/lib/nosql", () => {
  let answers: Array<Record<string, unknown>> = [];
  return {
    upsertStudentAnswer: vi.fn(async (input: Record<string, unknown>) => {
      const idx = answers.findIndex(
        (a) => a.class_id === input.class_id && a.assignment_id === input.assignment_id && a.student_id === input.student_id,
      );
      if (idx >= 0) answers[idx] = input;
      else answers.push(input);
      return input;
    }),
    listStudentAnswers: vi.fn(async (classId: string, assignmentId: string) => {
      return answers.filter((a) => a.class_id === classId && a.assignment_id === assignmentId);
    }),
    getStudentAnswer: vi.fn(async (classId: string, assignmentId: string, studentId: string) => {
      return answers.find((a) => a.class_id === classId && a.assignment_id === assignmentId && a.student_id === studentId) ?? null;
    }),
    __resetStore: () => { answers = []; },
  };
});

const { __resetStore } = await import("@/lib/nosql") as unknown as { __resetStore: () => void };

beforeEach(() => {
  __resetStore();
});

describe("POST /api/student-answers", () => {
  it("should store student answers", async () => {
    const req = new Request("http://localhost:3000/api/student-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "c1",
        assignmentId: "a1",
        studentId: "s1",
        studentName: "Alice",
        lessonNumber: 1,
        answers: { L1_Q1: "B", L1_Q1_confidence: "A", L1_Q2: "B" },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.answer.student_id).toBe("s1");
    expect(data.answer.answers.L1_Q1).toBe("B");
  });

  it("should reject empty answers", async () => {
    const req = new Request("http://localhost:3000/api/student-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "c1",
        assignmentId: "a1",
        studentId: "s1",
        lessonNumber: 1,
        answers: {},
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should reject missing fields", async () => {
    const req = new Request("http://localhost:3000/api/student-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/student-answers", () => {
  it("should list all answers for a class/assignment", async () => {
    // Submit two answers
    await POST(new Request("http://localhost:3000/api/student-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s1", studentName: "Alice", lessonNumber: 1, answers: { Q1: "A" } }),
    }));
    await POST(new Request("http://localhost:3000/api/student-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s2", studentName: "Bob", lessonNumber: 1, answers: { Q1: "B" } }),
    }));

    const req = new Request("http://localhost:3000/api/student-answers?classId=c1&assignmentId=a1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answers).toHaveLength(2);
  });

  it("should get a specific student answer", async () => {
    await POST(new Request("http://localhost:3000/api/student-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s1", studentName: "Alice", lessonNumber: 1, answers: { Q1: "A" } }),
    }));

    const req = new Request("http://localhost:3000/api/student-answers?classId=c1&assignmentId=a1&studentId=s1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answer.student_id).toBe("s1");
  });

  it("should filter answers by lesson number when provided", async () => {
    await POST(new Request("http://localhost:3000/api/student-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s1", studentName: "Alice", lessonNumber: 1, answers: { Q1: "A" } }),
    }));
    await POST(new Request("http://localhost:3000/api/student-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s2", studentName: "Bob", lessonNumber: 2, answers: { Q1: "B" } }),
    }));

    const req = new Request("http://localhost:3000/api/student-answers?classId=c1&assignmentId=a1&lessonNumber=1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answers).toHaveLength(1);
    expect(data.answers[0].student_id).toBe("s1");
  });
});
