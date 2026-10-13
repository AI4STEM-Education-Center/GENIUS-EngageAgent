import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null) }));
vi.mock("@/lib/task-interests", () => ({ getTaskInterests: vi.fn() }));

import { GET } from "@/app/api/survey-analysis/route";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { getTaskInterests, type TaskInterests } from "@/lib/task-interests";

const get = (params: Record<string, string>) =>
  GET(new Request(`http://localhost/api/survey-analysis?${new URLSearchParams(params)}`));
const ids = { classId: "class", assignmentId: "assignment" };

const interests = { surveyId: "survey-daily", top: [{ activity: "Soccer" }], stale: false } as unknown as TaskInterests;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(guardWorkspaceRequest).mockResolvedValue(null);
  vi.mocked(getTaskInterests).mockResolvedValue(interests);
});

describe("GET /api/survey-analysis", () => {
  it("requires class and assignment ids", async () => {
    expect((await get({ classId: "class" })).status).toBe(400);
    expect(getTaskInterests).not.toHaveBeenCalled();
  });

  it("returns the task's interests, uncached", async () => {
    const res = await get(ids);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ interests });
    expect(getTaskInterests).toHaveBeenCalledWith("class", "assignment");
  });

  it("returns null when there's nothing to show yet", async () => {
    vi.mocked(getTaskInterests).mockResolvedValue(null);
    expect(await (await get(ids)).json()).toEqual({ interests: null });
  });

  it("returns a friendly error when the first analysis fails", async () => {
    vi.mocked(getTaskInterests).mockRejectedValue(new Error("upstream timeout"));
    const res = await get(ids);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Student interests could not be analyzed right now. Please try again." });
  });

  it("stops at the workspace guard (e.g. a student in a live class)", async () => {
    vi.mocked(guardWorkspaceRequest).mockResolvedValue(NextResponse.json({ error: "Teacher access required." }, { status: 403 }));
    expect((await get(ids)).status).toBe(403);
    expect(getTaskInterests).not.toHaveBeenCalled();
  });
});
