import { describe, it, expect, beforeEach, vi } from "vitest";
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
