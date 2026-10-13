import { describe, it, expect, beforeEach, vi } from "vitest";

// Route behavior below assumes an authorized request. Signed native/GENIUS
// access and role isolation are exercised in workspace-access and embedded-workflow-access.
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null), workspaceRequestUser: vi.fn(async () => ({ role: "teacher" })) }));
import { GET, POST } from "@/app/api/student-answers/route";
import { getLesson } from "@/lib/quiz-data";
import { getQuizStatus } from "@/lib/nosql";

vi.mock("@/lib/nosql", () => {
  let answers: Array<Record<string, unknown>> = [];
  return {
    getQuizStatus: vi.fn(async () => null),
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
  vi.mocked(getQuizStatus).mockReset().mockResolvedValue(null);
});

const combinedAnswers = () => Object.fromEntries(getLesson(2)!.quiz_items.flatMap(item =>
  item.type === "experience"
    ? (item.response_fields ?? []).map(field => [field.field_id, "Playing soccer with a ball"])
    : [[item.item_id, Object.keys(item.options)[0]]],
));
const submitCombined = (answers: Record<string, string>, lessonNumber = 2) => POST(new Request("http://localhost:3000/api/student-answers", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s1", studentName: "Alice", lessonNumber, answers }),
}));

describe("combined lesson quiz submission", () => {
  beforeEach(() => {
    vi.mocked(getQuizStatus).mockResolvedValue({ class_id: "c1", assignment_id: "a1", lesson_number: 2, status: "published", quiz_version: 2, updated_at: "2026-10-13" });
  });

  it("stores written responses and confidence atomically and returns them to the teacher", async () => {
    const answers = combinedAnswers();
    const res = await submitCombined(answers);
    expect(res.status).toBe(201);
    expect((await res.json()).answer.answers).toEqual(answers);
    const saved = await GET(new Request("http://localhost:3000/api/student-answers?classId=c1&assignmentId=a1&lessonNumber=2"));
    expect((await saved.json()).answers[0].answers).toEqual(answers);
  });

  it.each(["missing text", "blank text", "missing confidence", "invalid confidence"])("rejects %s without saving a partial quiz", async scenario => {
    const answers = combinedAnswers();
    const experience = getLesson(2)!.quiz_items.find(item => item.type === "experience")!;
    const field = experience.response_fields![0].field_id;
    if (scenario === "missing text") delete answers[field];
    if (scenario === "blank text") answers[field] = "   ";
    if (scenario === "missing confidence") delete answers[`${experience.item_id}_confidence`];
    if (scenario === "invalid confidence") answers[`${experience.item_id}_confidence`] = "E";
    expect((await submitCombined(answers)).status).toBe(400);
    const saved = await GET(new Request("http://localhost:3000/api/student-answers?classId=c1&assignmentId=a1"));
    expect((await saved.json()).answers).toEqual([]);
  });

  it("rejects stale lesson and closed quiz submissions", async () => {
    expect((await submitCombined(combinedAnswers(), 3)).status).toBe(409);
    vi.mocked(getQuizStatus).mockResolvedValueOnce({ class_id: "c1", assignment_id: "a1", lesson_number: 2, status: "closed", quiz_version: 2, updated_at: "2026-10-13" });
    expect((await submitCombined(combinedAnswers())).status).toBe(409);
  });
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
