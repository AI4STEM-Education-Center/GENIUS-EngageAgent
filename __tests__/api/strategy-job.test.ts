import { beforeEach, describe, expect, it, vi } from "vitest";

// Route behavior below assumes an authorized request. Signed native/GENIUS
// access and role isolation are exercised in workspace-access and embedded-workflow-access.
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null), workspaceRequestUser: vi.fn(async () => ({ role: "teacher" })) }));

const {
  createCohortJob,
  enqueueCohortJobStudents,
  getCohortAnalysisQueueConfigIssues,
  getCohortJob,
  isCohortAnalysisQueueConfigured,
  setCohortJobStatus,
  randomUUID,
} = vi.hoisted(() => ({
  createCohortJob: vi.fn(),
  enqueueCohortJobStudents: vi.fn(),
  getCohortAnalysisQueueConfigIssues: vi.fn(),
  getCohortJob: vi.fn(),
  isCohortAnalysisQueueConfigured: vi.fn(),
  setCohortJobStatus: vi.fn(),
  randomUUID: vi.fn(() => "job-123"),
}));

vi.mock("node:crypto", () => ({
  default: {
    randomUUID,
  },
}));

vi.mock("@/lib/cohort-analysis-queue", () => ({
  enqueueCohortJobStudents,
  getCohortAnalysisQueueConfigIssues,
  isCohortAnalysisQueueConfigured,
}));

vi.mock("@/lib/nosql", () => ({
  createCohortJob,
  getCohortJob,
  setCohortJobStatus,
}));

const { POST } = await import("@/app/api/strategy-job/route");
const { GET } = await import("@/app/api/strategy-job/[jobId]/route");

beforeEach(() => {
  createCohortJob.mockReset();
  enqueueCohortJobStudents.mockReset();
  getCohortAnalysisQueueConfigIssues.mockReset();
  getCohortJob.mockReset();
  isCohortAnalysisQueueConfigured.mockReset();
  setCohortJobStatus.mockReset();
  randomUUID.mockClear();
});

describe("POST /api/strategy-job", () => {
  it("creates a cohort job and enqueues uncached students", async () => {
    isCohortAnalysisQueueConfigured.mockReturnValue(true);
    createCohortJob.mockResolvedValue(undefined);
    enqueueCohortJobStudents.mockResolvedValue(undefined);

    const res = await POST(
      new Request("http://localhost:3000/api/strategy-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: "class-1",
          assignmentId: "assignment-1",
          lessonNumber: 2,
          students: [
            { id: "student-1", name: "Ava", assignment: "Lesson 1", answers: { q1: "A" } },
            { id: "student-2", name: "Jon", assignment: "Lesson 1", answers: { q1: "B" } },
          ],
        }),
      }),
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toEqual({
      jobId: "job-123",
      queuedStudents: 2,
      totalStudents: 2,
      status: "queued",
    });
    expect(createCohortJob).toHaveBeenCalledWith(
      "job-123",
      "class-1",
      "assignment-1",
      2,
    );
    expect(enqueueCohortJobStudents).toHaveBeenCalledWith({
      jobId: "job-123",
      classId: "class-1",
      assignmentId: "assignment-1",
      lessonNumber: 2,
      totalStudents: 2,
      forceRefresh: false,
      students: [
        { id: "student-1", name: "Ava", assignment: "Lesson 1", answers: { q1: "A" } },
        { id: "student-2", name: "Jon", assignment: "Lesson 1", answers: { q1: "B" } },
      ],
    });
  });

  it("passes forceRefresh through to the queue payload", async () => {
    isCohortAnalysisQueueConfigured.mockReturnValue(true);
    createCohortJob.mockResolvedValue(undefined);
    enqueueCohortJobStudents.mockResolvedValue(undefined);

    const res = await POST(
      new Request("http://localhost:3000/api/strategy-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: "class-1",
          assignmentId: "assignment-1",
          lessonNumber: 2,
          forceRefresh: true,
          students: [
            { id: "student-1", name: "Ava", assignment: "Lesson 1", answers: { q1: "A" } },
          ],
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(enqueueCohortJobStudents).toHaveBeenCalledWith({
      jobId: "job-123",
      classId: "class-1",
      assignmentId: "assignment-1",
      lessonNumber: 2,
      totalStudents: 1,
      forceRefresh: true,
      students: [
        { id: "student-1", name: "Ava", assignment: "Lesson 1", answers: { q1: "A" } },
      ],
    });
  });

  it("returns 501 when the queue is not configured", async () => {
    isCohortAnalysisQueueConfigured.mockReturnValue(false);
    getCohortAnalysisQueueConfigIssues.mockReturnValue([
      "COHORT_ANALYSIS_QUEUE_URL",
    ]);

    const res = await POST(
      new Request("http://localhost:3000/api/strategy-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: "class-1",
          assignmentId: "assignment-1",
          lessonNumber: 2,
          students: [{ id: "student-1", name: "Ava", answers: { q1: "A" } }],
        }),
      }),
    );

    expect(res.status).toBe(501);
    const data = await res.json();
    expect(data).toEqual({
      error: "Cohort analysis queue is not configured on this environment.",
      missingEnv: ["COHORT_ANALYSIS_QUEUE_URL"],
    });
  });

  it("returns 400 when lessonNumber is missing", async () => {
    isCohortAnalysisQueueConfigured.mockReturnValue(true);

    const res = await POST(
      new Request("http://localhost:3000/api/strategy-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: "class-1",
          assignmentId: "assignment-1",
          students: [{ id: "student-1", name: "Ava", answers: { q1: "A" } }],
        }),
      }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe(
      "classId, assignmentId, and lessonNumber are required.",
    );
  });
});

describe("GET /api/strategy-job/[jobId]", () => {
  it("returns job progress, parsed student results, and failures", async () => {
    getCohortJob.mockResolvedValue({
      job: {
        job_id: "job-123",
        class_id: "class-1",
        assignment_id: "assignment-1",
        total_students: 2,
        processed_students: 2,
        completed_students: 1,
        failed_students: 1,
        status: "completed_with_errors",
        error_message: undefined,
        created_at: "2026-03-25T00:00:00.000Z",
        updated_at: "2026-03-25T00:01:00.000Z",
      },
      students: [
        {
          job_id: "job-123",
          class_id: "class-1",
          assignment_id: "assignment-1",
          student_id: "student-1",
          student_name: "Ava",
          status: "completed",
          source: "model",
          plan_json: JSON.stringify({
            strategy: "Analogy",
            summary: "Use analogy.",
          }),
          updated_at: "2026-03-25T00:00:30.000Z",
        },
        {
          job_id: "job-123",
          class_id: "class-1",
          assignment_id: "assignment-1",
          student_id: "student-2",
          student_name: "Jon",
          status: "failed",
          error: "Request timed out.",
          updated_at: "2026-03-25T00:00:45.000Z",
        },
      ],
    });

    const res = await GET(
      new Request("http://localhost:3000/api/strategy-job/job-123"),
      { params: Promise.resolve({ jobId: "job-123" }) },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.job).toEqual({
      jobId: "job-123",
      classId: "class-1",
      assignmentId: "assignment-1",
      totalStudents: 2,
      processedStudents: 2,
      completedStudents: 1,
      failedStudents: 1,
      status: "completed_with_errors",
      errorMessage: null,
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:01:00.000Z",
    });
    expect(data.results).toEqual([
      {
        id: "student-1",
        name: "Ava",
        plan: {
          strategy: "analogy",
          summary: "Use analogy.",
        },
      },
    ]);
    expect(data.errors).toEqual([
      {
        id: "student-2",
        name: "Jon",
        error: "Request timed out.",
      },
    ]);
    expect(data.distribution).toEqual({ analogy: 1 });
  });
});
