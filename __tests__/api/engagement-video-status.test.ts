import { beforeEach, describe, expect, it, vi } from "vitest";

// Route behavior below assumes an authorized request. Signed native/GENIUS
// access and role isolation are exercised in workspace-access and embedded-workflow-access.
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null), workspaceRequestUser: vi.fn(async () => ({ role: "teacher", geniusId: "teacher" })) }));
vi.mock("@/lib/workspace-store", () => ({ workspaceGet: vi.fn(async () => ({ requestId: "req-1", classId: "c1", assignmentId: "a1", studentId: "cohort", contentItemId: "item-1", ownerId: "teacher", expiresAt: Math.floor(Date.now() / 1000) + 3600 })) }));
import { NextRequest } from "next/server";

const { upsertMedia, getMedia } = vi.hoisted(() => ({
  upsertMedia: vi.fn(),
  getMedia: vi.fn(),
}));

vi.mock("@/lib/nosql", () => ({
  upsertMedia,
  getMedia,
}));

import { GET } from "@/app/api/engagement-video/status/route";

describe("GET /api/engagement-video/status", () => {
  beforeEach(() => {
    process.env.GROK_API_KEY = "test-grok-key";
    upsertMedia.mockReset();
    getMedia.mockReset();
    vi.unstubAllGlobals();
  });

  it("should return the persisted video url when media is saved successfully", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "done",
            video: {
              url: "https://upstream.example.com/video.mp4",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from("video-bytes"), {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);
    getMedia.mockResolvedValue({
      data_url: "https://cdn.example.com/video.mp4",
    });

    const request = new NextRequest(
      "http://localhost:3000/api/engagement-video/status?requestId=req-1&contentItemId=item-1&classId=c1&assignmentId=a1&studentId=cohort",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      done: true,
      url: "https://cdn.example.com/video.mp4",
      contentItemId: "item-1",
      savedToDb: true,
    });
    expect(upsertMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: "c1",
        assignmentId: "a1",
        studentId: "cohort",
        contentItemId: "item-1",
        mediaType: "video",
        mimeType: "video/mp4",
      }),
    );
    expect(getMedia).toHaveBeenCalledWith(
      "c1",
      "a1",
      "cohort",
      "item-1",
      "video",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
