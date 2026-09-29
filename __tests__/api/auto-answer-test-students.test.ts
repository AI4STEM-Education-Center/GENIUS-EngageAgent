import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/auto-answer-test-students/route";
import type { Lesson } from "@/lib/types";

vi.mock("@/lib/auth", () => ({
  extractSSOToken: vi.fn(),
  verifySSOToken: vi.fn(),
}));

vi.mock("@/lib/quiz-data", () => ({
  getLesson: vi.fn(),
}));

vi.mock("@/lib/nosql", () => {
  let answers: Record<string, Record<string, unknown>> = {};

  return {
    getQuizStatus: vi.fn(),
    upsertStudentAnswer: vi.fn(async (input: Record<string, unknown>) => {
      const key = [
        input.class_id,
        input.assignment_id,
        input.student_id,
      ].join(":");
      answers[key] = input;
      return input;
    }),
    __resetStore: () => {
      answers = {};
    },
    __getAnswers: () => Object.values(answers),
  };
});

const { extractSSOToken, verifySSOToken } = await import("@/lib/auth");
const { getLesson } = await import("@/lib/quiz-data");
const { getQuizStatus, __getAnswers, __resetStore } = await import(
  "@/lib/nosql"
) as unknown as {
  getQuizStatus: ReturnType<typeof vi.fn>;
  __getAnswers: () => Array<Record<string, unknown>>;
  __resetStore: () => void;
};

const lesson: Lesson = {
  lesson_number: 1,
  lesson_title: "Lesson 1",
  learning_objective: "Test objective",
  core_ideas: [],
  misconceptions: {},
  survey_items: [],
  quiz_items: [
    {
      item_id: "L1_Q1",
      type: "multiple_choice",
      question_number: 1,
      stem: "Question 1",
      options: {
        A: "Option A",
        B: "Option B",
        C: "Option C",
      },
      correct_answer: "A",
    },
    {
      item_id: "L1_Q1_confidence",
      type: "confidence_check",
      stem: "Confidence",
      options: {
        A: "Very confident",
        B: "Somewhat confident",
        C: "Not very confident",
        D: "Just guessing",
      },
    },
  ],
};

beforeEach(() => {
  __resetStore();
  vi.clearAllMocks();

  vi.mocked(extractSSOToken).mockReturnValue("valid-token");
  vi.mocked(verifySSOToken).mockResolvedValue({
    geniusId: "teacher-1",
    userId: "teacher-1",
    email: "teacher@example.com",
    name: "Teacher",
    role: "teacher",
    classId: "class-1",
    assignmentId: "assignment-1",
  });
  vi.mocked(getQuizStatus).mockImplementation(
    async (classId: string, assignmentId: string) => ({
      class_id: classId,
      assignment_id: assignmentId,
      lesson_number: 1,
      status: "published",
      updated_at: new Date().toISOString(),
    }),
  );
  vi.mocked(getLesson).mockReturnValue(lesson);
});

describe("POST /api/auto-answer-test-students", () => {
  it("requires teacher authentication", async () => {
    vi.mocked(extractSSOToken).mockReturnValue(null);

    const res = await POST(
      new Request("http://localhost:3000/api/auto-answer-test-students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: "class-1", assignmentId: "assignment-1" }),
      }),
    );

    expect(res.status).toBe(401);
  });

  it("rejects non-teacher users", async () => {
    vi.mocked(verifySSOToken).mockResolvedValue({
      geniusId: "student-1",
      userId: "student-1",
      email: "student@example.com",
      name: "Student",
      role: "student",
      classId: "class-1",
      assignmentId: "assignment-1",
    });

    const res = await POST(
      new Request("http://localhost:3000/api/auto-answer-test-students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: "class-1", assignmentId: "assignment-1" }),
      }),
    );

    expect(res.status).toBe(403);
  });

  it("creates answers for all configured test students", async () => {
    const request = new Request(
      "http://localhost:3000/api/auto-answer-test-students",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: "class-1", assignmentId: "assignment-1" }),
      },
    );

    const firstRes = await POST(request);
    expect(firstRes.status).toBe(201);

    const firstData = await firstRes.json();
    expect(firstData.generatedCount).toBe(5);
    expect(firstData.students).toHaveLength(5);

    const savedAnswers = __getAnswers();
    expect(savedAnswers).toHaveLength(5);
    expect(savedAnswers[0]?.answers).toMatchObject({
      L1_Q1: expect.stringMatching(/^[ABC]$/),
      L1_Q1_confidence: expect.stringMatching(/^[ABCD]$/),
    });

    const secondRes = await POST(
      new Request("http://localhost:3000/api/auto-answer-test-students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: "class-1", assignmentId: "assignment-1" }),
      }),
    );
    const secondData = await secondRes.json();

    expect(secondData.students[0].answers).toEqual(firstData.students[0].answers);
    expect(__getAnswers()).toHaveLength(5);
  });

  it("supports mock teacher mode for local testing", async () => {
    vi.mocked(extractSSOToken).mockReturnValue(null);

    const res = await POST(
      new Request("http://localhost:3000/api/auto-answer-test-students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-engage-mock-user": "teacher",
        },
        body: JSON.stringify({ classId: "demo-class", assignmentId: "demo-assignment" }),
      }),
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.classId).toBe("demo-class");
    expect(data.assignmentId).toBe("demo-assignment");
    expect(data.generatedCount).toBe(5);
  });
});
