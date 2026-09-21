import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/surveys/route";

vi.mock("@/lib/nosql", () => {
  let surveys: Array<Record<string, unknown>> = [];
  return {
    upsertSurvey: vi.fn(async (survey: Record<string, unknown>) => {
      const idx = surveys.findIndex((s) => s.survey_id === survey.survey_id);
      if (idx >= 0) surveys[idx] = survey;
      else surveys.push(survey);
      return survey;
    }),
    getSurvey: vi.fn(
      async (classId: string, assignmentId: string, surveyId: string) =>
        surveys.find(
          (s) =>
            s.class_id === classId &&
            s.assignment_id === assignmentId &&
            s.survey_id === surveyId,
        ) ?? null,
    ),
    listSurveys: vi.fn(async (classId: string, assignmentId: string) =>
      surveys.filter(
        (s) => s.class_id === classId && s.assignment_id === assignmentId,
      ),
    ),
    __resetStore: () => {
      surveys = [];
    },
  };
});

const { __resetStore } = (await import("@/lib/nosql")) as unknown as {
  __resetStore: () => void;
};

const post = (payload: Record<string, unknown>) =>
  POST(
    new Request("http://localhost:3000/api/surveys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );

beforeEach(() => {
  __resetStore();
});

describe("POST /api/surveys", () => {
  it("creates a valid survey with a generated id and defaults to draft", async () => {
    const res = await post({
      classId: "c1",
      assignmentId: "a1",
      title: "Prior experience survey",
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.survey.survey_id).toBeTruthy();
    expect(data.survey.title).toBe("Prior experience survey");
    expect(data.survey.status).toBe("draft");
    expect(data.survey.questions).toEqual([]);
  });

  it("rejects an empty title", async () => {
    const res = await post({ classId: "c1", assignmentId: "a1", title: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects missing classId/assignmentId", async () => {
    const res = await post({ title: "No context" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid status", async () => {
    const res = await post({
      classId: "c1",
      assignmentId: "a1",
      title: "T",
      status: "published",
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-array questions", async () => {
    const res = await post({
      classId: "c1",
      assignmentId: "a1",
      title: "T",
      questions: "nope",
    });
    expect(res.status).toBe(400);
  });

  it("updates an existing survey and preserves its id and created_at", async () => {
    const created = await (await post({
      classId: "c1",
      assignmentId: "a1",
      title: "Draft title",
    })).json();
    const { survey_id, created_at } = created.survey;

    const res = await post({
      classId: "c1",
      assignmentId: "a1",
      surveyId: survey_id,
      title: "Updated title",
      status: "active",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.survey.survey_id).toBe(survey_id);
    expect(data.survey.title).toBe("Updated title");
    expect(data.survey.status).toBe("active");
    expect(data.survey.created_at).toBe(created_at);
  });
});

describe("GET /api/surveys", () => {
  it("lists surveys for a class assignment", async () => {
    await post({ classId: "c1", assignmentId: "a1", title: "One" });
    await post({ classId: "c1", assignmentId: "a1", title: "Two" });
    await post({ classId: "c1", assignmentId: "a2", title: "Other assignment" });

    const res = await GET(
      new Request("http://localhost:3000/api/surveys?classId=c1&assignmentId=a1"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.surveys).toHaveLength(2);
  });

  it("gets a single survey by id", async () => {
    const created = await (await post({
      classId: "c1",
      assignmentId: "a1",
      title: "Findable",
    })).json();

    const res = await GET(
      new Request(
        `http://localhost:3000/api/surveys?classId=c1&assignmentId=a1&surveyId=${created.survey.survey_id}`,
      ),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.survey.title).toBe("Findable");
  });

  it("returns 404 for a missing survey", async () => {
    const res = await GET(
      new Request(
        "http://localhost:3000/api/surveys?classId=c1&assignmentId=a1&surveyId=missing",
      ),
    );
    expect(res.status).toBe(404);
  });

  it("requires classId and assignmentId", async () => {
    const res = await GET(
      new Request("http://localhost:3000/api/surveys?classId=c1"),
    );
    expect(res.status).toBe(400);
  });
});
