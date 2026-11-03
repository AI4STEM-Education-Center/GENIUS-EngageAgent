import { describe, it, expect, beforeEach, vi } from "vitest";

// Route behavior below assumes an authorized request. Signed native/GENIUS
// access and role isolation are exercised in workspace-access and embedded-workflow-access.
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null), workspaceRequestUser: vi.fn(async () => ({ role: "teacher" })) }));
vi.mock("@/lib/material-gallery-server", () => ({ resolveGalleryContentMedia: vi.fn(async () => undefined) }));
import { resolveGalleryContentMedia } from "@/lib/material-gallery-server";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { GET, POST } from "@/app/api/content-publish/route";

vi.mock("@/lib/nosql", () => {
  let items: Array<Record<string, unknown>> = [];
  let media: Array<Record<string, unknown>> = [];
  return {
    upsertContentPublish: vi.fn(async (input: Record<string, unknown>) => {
      const idx = items.findIndex(
        (c) => c.class_id === input.class_id && c.assignment_id === input.assignment_id && c.content_item_id === input.content_item_id,
      );
      if (idx >= 0) items[idx] = input;
      else items.push(input);
      return input;
    }),
    listPublishedContent: vi.fn(async (classId: string, assignmentId: string) => {
      return items.filter((c) => c.class_id === classId && c.assignment_id === assignmentId && c.published);
    }),
    listMedia: vi.fn(async (classId: string, assignmentId: string, studentId: string) => {
      return media.filter(
        (entry) =>
          entry.class_id === classId &&
          entry.assignment_id === assignmentId &&
          entry.student_id === studentId,
      );
    }),
    __resetStore: () => {
      items = [];
      media = [];
    },
    __setMedia: (nextMedia: Array<Record<string, unknown>>) => {
      media = nextMedia;
    },
  };
});

const { __resetStore, __setMedia } = await import("@/lib/nosql") as unknown as {
  __resetStore: () => void;
  __setMedia: (nextMedia: Array<Record<string, unknown>>) => void;
};

beforeEach(() => {
  __resetStore();
  vi.mocked(resolveGalleryContentMedia).mockReset().mockResolvedValue(undefined);
  vi.mocked(guardWorkspaceRequest).mockClear();
});

describe("POST /api/content-publish", () => {
  it.each([
    { type: "Slides" }, { slides: { publicationId: "fake" } }, { id: "slides-existing-deck" },
  ])("rejects reserved Slides writes before publishing any batch items: %j", async (reserved) => {
    const response = await POST(new Request("http://localhost:3000/api/content-publish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", contentItems: [
        { id: "regular", type: "material", title: "Normal" }, { id: "b", type: "material", ...reserved },
      ] }),
    }));
    expect(response.status).toBe(400);
    const listed = await GET(new Request("http://localhost:3000/api/content-publish?classId=c1&assignmentId=a1"));
    expect((await listed.json()).items).toHaveLength(0);
  });

  it("should publish content items", async () => {
    const req = new Request("http://localhost:3000/api/content-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "c1",
        assignmentId: "a1",
        publishedBy: "teacher-1",
        contentItems: [
          { id: "item-1", type: "warm-up", title: "Test", body: "Body", strategy: "analogy" },
          { id: "item-2", type: "mini-lesson", title: "Test 2", body: "Body 2", strategy: "analogy" },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.published).toHaveLength(2);
  });


  it("should strip inline data media before persisting published content", async () => {
    const res = await POST(new Request("http://localhost:3000/api/content-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "c1",
        assignmentId: "a1",
        publishedBy: "teacher-1",
        contentItems: [{
          id: "item-1",
          type: "material",
          title: "Test",
          body: "Body",
          strategy: "analogy",
          media: {
            image: "data:image/webp;base64,AAAA",
            video: "https://example.com/video.mp4",
          },
        }],
      }),
    }));

    expect(res.status).toBe(201);
    const getRes = await GET(new Request("http://localhost:3000/api/content-publish?classId=c1&assignmentId=a1"));
    expect(getRes.status).toBe(200);
    const data = await getRes.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].content_json).not.toContain("data:image/webp");
    expect(data.items[0].media).toEqual({
      video: "https://example.com/video.mp4",
    });
  });

  it("should reject empty content items", async () => {
    const req = new Request("http://localhost:3000/api/content-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", contentItems: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should reject missing fields", async () => {
    const req = new Request("http://localhost:3000/api/content-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/content-publish", () => {
  it("authorizes the task before resolving any copied Gallery media", async () => {
    vi.mocked(guardWorkspaceRequest).mockResolvedValueOnce(Response.json({ error: "No access" }, { status: 403 }) as never);
    expect((await GET(new Request("http://localhost:3000/api/content-publish?classId=c1&assignmentId=a1"))).status).toBe(403);
    expect(resolveGalleryContentMedia).not.toHaveBeenCalled();
  });
  it("renews Gallery fallback links while preferring regenerated task media and preserving material provenance", async () => {
    const id = "gallery-copy-97fc4703-f7ab-4395-a223-2f1c634ec99b";
    const gallerySource = { templateId: "original-template", revision: 1, title: "Contact", mode: "adapt" };
    await POST(new Request("http://localhost:3000/api/content-publish", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", contentItems: [{ id, type: "Video", title: "Adapted contact", body: "Observe", strategy: "cognitive conflict",
        lessonNumber: 3, focus: { misconceptions: ["a"] }, gallerySource, media: { video: "https://saved.example/expired" } }] }) }));
    vi.mocked(resolveGalleryContentMedia).mockResolvedValue({ video: "https://gallery.example/renewed", image: "https://gallery.example/image" });
    __setMedia([{ class_id: "c1", assignment_id: "a1", student_id: "cohort", content_item_id: id, media_type: "video", data_url: "https://generated.example/new-video" }]);
    const response = await GET(new Request("http://localhost:3000/api/content-publish?classId=c1&assignmentId=a1"));
    const row = (await response.json()).items[0];
    expect(row.media).toEqual({ video: "https://generated.example/new-video", image: "https://gallery.example/image" });
    expect(JSON.parse(row.content_json)).toMatchObject({ lessonNumber: 3, focus: { misconceptions: ["a"] }, gallerySource });
    expect(resolveGalleryContentMedia).toHaveBeenCalledWith("c1", "a1", id);
  });
  it("should list published content", async () => {
    await POST(new Request("http://localhost:3000/api/content-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "c1",
        assignmentId: "a1",
        publishedBy: "teacher-1",
        contentItems: [{ id: "item-1", type: "warm-up", title: "Test", body: "Body", strategy: "analogy" }],
      }),
    }));

    const req = new Request("http://localhost:3000/api/content-publish?classId=c1&assignmentId=a1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items).toHaveLength(1);
  });

  it("should include any available image and video with published items", async () => {
    await POST(new Request("http://localhost:3000/api/content-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "c1",
        assignmentId: "a1",
        publishedBy: "teacher-1",
        contentItems: [{ id: "item-1", type: "material", title: "Test", body: "Body", strategy: "analogy" }],
      }),
    }));

    __setMedia([
      {
        class_id: "c1",
        assignment_id: "a1",
        student_id: "cohort",
        content_item_id: "item-1",
        media_type: "image",
        data_url: "https://example.com/image.webp",
      },
      {
        class_id: "c1",
        assignment_id: "a1",
        student_id: "cohort",
        content_item_id: "item-1",
        media_type: "video",
        data_url: "https://example.com/video.mp4",
      },
    ]);

    const req = new Request("http://localhost:3000/api/content-publish?classId=c1&assignmentId=a1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items[0].media).toEqual({
      image: "https://example.com/image.webp",
      video: "https://example.com/video.mp4",
    });
  });

  it("should fall back to embedded media stored with published content", async () => {
    await POST(new Request("http://localhost:3000/api/content-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "c1",
        assignmentId: "a1",
        publishedBy: "teacher-1",
        contentItems: [{
          id: "item-1",
          type: "material",
          title: "Test",
          body: "Body",
          strategy: "analogy",
          media: {
            image: "https://example.com/fallback-image.webp",
            video: "https://example.com/fallback-video.mp4",
          },
        }],
      }),
    }));

    const req = new Request("http://localhost:3000/api/content-publish?classId=c1&assignmentId=a1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items[0].media).toEqual({
      image: "https://example.com/fallback-image.webp",
      video: "https://example.com/fallback-video.mp4",
    });
  });

  it("should return empty when nothing published", async () => {
    const req = new Request("http://localhost:3000/api/content-publish?classId=c1&assignmentId=a1");
    const res = await GET(req);
    const data = await res.json();
    expect(data.items).toHaveLength(0);
  });
});
