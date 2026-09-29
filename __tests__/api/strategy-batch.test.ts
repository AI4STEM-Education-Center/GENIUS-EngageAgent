import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCompletion, MockAPIConnectionTimeoutError } = vi.hoisted(() => {
  const createCompletion = vi.fn();

  class MockAPIConnectionTimeoutError extends Error {
    constructor(message = "Request timed out.") {
      super(message);
      this.name = "Error";
    }
  }

  return { createCompletion, MockAPIConnectionTimeoutError };
});

vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: createCompletion,
      },
    };
  }

  return {
    default: MockOpenAI,
    APIConnectionTimeoutError: MockAPIConnectionTimeoutError,
  };
});

vi.mock("@/lib/nosql", () => {
  const cache = new Map<string, string>();

  return {
    getCachedPlanJson: vi.fn(async (classId: string, assignmentId: string, studentId: string) => {
      return cache.get(`${classId}:${assignmentId}:${studentId}`) ?? null;
    }),
    upsertCachedPlanJson: vi.fn(async (classId: string, assignmentId: string, studentId: string, planJson: string) => {
      cache.set(`${classId}:${assignmentId}:${studentId}`, planJson);
    }),
    __resetCache: () => {
      cache.clear();
    },
  };
});

const { POST } = await import("@/app/api/strategy-batch/route");
const { __resetCache } = (await import("@/lib/nosql")) as unknown as {
  __resetCache: () => void;
};

const buildRequest = (
  students: Array<Record<string, unknown>>,
  options?: { forceRefresh?: boolean },
) =>
  new Request("http://localhost:3000/api/strategy-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      classId: "class-1",
      assignmentId: "assignment-1",
      lessonNumber: 1,
      forceRefresh: options?.forceRefresh,
      students,
    }),
  });

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  createCompletion.mockReset();
  __resetCache();
});

const buildCompletion = (strategy = "experience bridging") => ({
  choices: [
    {
      message: {
        content: JSON.stringify({
          name: "Bridge to prior knowledge",
          strategy,
          relevance: {
            "cognitive conflict": strategy === "cognitive conflict" ? 90 : 10,
            analogy: strategy === "analogy" ? 90 : 15,
            "experience bridging": strategy === "experience bridging" ? 90 : 20,
            "engaged critiquing": strategy === "engaged critiquing" ? 90 : 25,
          },
          overallRecommendation: "Connect the concept to the student's experience.",
          recommendationReason: "This fits the student because they referenced a concrete real-world example.",
          summary: "Use prior experience to ground the lesson.",
          tldr: "Anchor the lesson in familiar experiences.",
          rationale: "The student named a concrete example from daily life.",
          tactics: ["Start with a familiar example."],
          cadence: "At lesson launch",
          checks: ["Ask the student to compare the example to the new concept."],
        }),
      },
    },
  ],
});

describe("POST /api/strategy-batch", () => {
  it("returns 504 and normalized timeout errors when every student times out", async () => {
    createCompletion
      .mockRejectedValueOnce(new MockAPIConnectionTimeoutError())
      .mockRejectedValueOnce(new MockAPIConnectionTimeoutError());

    const res = await POST(buildRequest([
      { id: "student-1", name: "Jon", answers: { L1_Q1: "A", L1_Q1_confidence: "B" } },
      { id: "student-2", name: "David", answers: { L1_Q1: "C", L1_Q1_confidence: "D" } },
    ]));

    expect(res.status).toBe(504);
    const data = await res.json();
    expect(data.error).toBe("Strategy generation timed out before the model returned.");
    expect(data.errors).toEqual([
      {
        id: "student-1",
        name: "Jon",
        error: "Strategy generation timed out before the model returned.",
      },
      {
        id: "student-2",
        name: "David",
        error: "Strategy generation timed out before the model returned.",
      },
    ]);
  });

  it("returns partial results when one student succeeds and another times out", async () => {
    createCompletion
      .mockResolvedValueOnce(buildCompletion("experience bridging"))
      .mockRejectedValueOnce(new MockAPIConnectionTimeoutError());

    const res = await POST(buildRequest([
      { id: "student-1", name: "Ava", answers: { L1_Q1: "A", L1_Q1_confidence: "B" } },
      { id: "student-2", name: "Jon", answers: { L1_Q1: "C", L1_Q1_confidence: "D" } },
    ]));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      id: "student-1",
      name: "Ava",
      plan: {
        strategy: "experience bridging",
      },
    });
    expect(data.distribution).toEqual({ "experience bridging": 1 });
    expect(data.errors).toEqual([
      {
        id: "student-2",
        name: "Jon",
        error: "Strategy generation timed out before the model returned.",
      },
    ]);
  });

  it("starts multiple student generations in parallel within a batch", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    createCompletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const requestPromise = POST(buildRequest([
      { id: "student-1", name: "Ava", answers: { L1_Q1: "A", L1_Q1_confidence: "B" } },
      { id: "student-2", name: "Jon", answers: { L1_Q1: "C", L1_Q1_confidence: "D" } },
      { id: "student-3", name: "David", answers: { L1_Q1: "A", L1_Q1_confidence: "C" } },
      { id: "student-4", name: "Mia", answers: { L1_Q1: "B", L1_Q1_confidence: "A" } },
    ]));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createCompletion).toHaveBeenCalledTimes(4);

    resolvers.forEach((resolve, index) => {
      resolve(buildCompletion(index % 2 === 0 ? "experience bridging" : "analogy"));
    });

    const res = await requestPromise;
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(4);
    expect(data.errors).toEqual([]);
  });

  it("includes the lesson objective and resolved quiz evidence in the prompt", async () => {
    createCompletion.mockResolvedValueOnce(buildCompletion("cognitive conflict"));

    const res = await POST(buildRequest([
      {
        id: "student-1",
        name: "Ava",
        answers: {
          L1_Q1: "D",
          L1_Q1_confidence: "B",
        },
      },
    ]));

    expect(res.status).toBe(200);
    expect(createCompletion).toHaveBeenCalledTimes(1);
    const firstCall = createCompletion.mock.calls[0]?.[0];
    const userPrompt = firstCall?.messages?.[1]?.content as string;

    expect(userPrompt).toContain("Lesson objective:");
    expect(userPrompt).toContain(
      "Students will construct temporal visual models and causal explanations",
    );
    expect(userPrompt).toContain(
      "A phone drops onto a soft pillow. The phone looks the same afterward.",
    );
    expect(userPrompt).toContain(
      "The force was weak because nothing was damaged.",
    );
    expect(userPrompt).toContain(
      "If nothing looks damaged after the collision, the force must have been weak.",
    );
  });

  it("bypasses cached plans when forceRefresh is true", async () => {
    createCompletion.mockResolvedValueOnce(buildCompletion("analogy"));

    const firstRes = await POST(buildRequest([
      {
        id: "student-1",
        name: "Ava",
        answers: {
          L1_Q1: "D",
          L1_Q1_confidence: "B",
        },
      },
    ]));

    expect(firstRes.status).toBe(200);
    expect(createCompletion).toHaveBeenCalledTimes(1);

    createCompletion.mockReset();
    createCompletion.mockResolvedValueOnce(buildCompletion("cognitive conflict"));

    const secondRes = await POST(buildRequest([
      {
        id: "student-1",
        name: "Ava",
        answers: {
          L1_Q1: "D",
          L1_Q1_confidence: "B",
        },
      },
    ], { forceRefresh: true }));

    expect(secondRes.status).toBe(200);
    expect(createCompletion).toHaveBeenCalledTimes(1);

    const data = await secondRes.json();
    expect(data.results).toMatchObject([
      {
        id: "student-1",
        plan: {
          strategy: "cognitive conflict",
        },
      },
    ]);
  });
});
