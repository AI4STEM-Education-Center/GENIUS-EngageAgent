import { describe, it, expect, beforeEach, vi } from "vitest";

// Route behavior below assumes an authorized request. Signed native/GENIUS
// access and role isolation are exercised in workspace-access and embedded-workflow-access.
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null), workspaceRequestUser: vi.fn(async () => ({ role: "teacher" })) }));
import { GET, POST } from "@/app/api/content-rating/route";

vi.mock("@/lib/nosql", () => {
  let ratings: Array<Record<string, unknown>> = [];
  return {
    listPublishedContent: vi.fn(async () => [{ content_item_id: "item-1" }, { content_item_id: "item-2" }]),
    upsertContentRating: vi.fn(async (input: Record<string, unknown>) => {
      const idx = ratings.findIndex(
        (r) => r.class_id === input.class_id && r.assignment_id === input.assignment_id && r.student_id === input.student_id && r.content_item_id === input.content_item_id,
      );
      if (idx >= 0) ratings[idx] = input;
      else ratings.push(input);
      return input;
    }),
    listContentRatings: vi.fn(async (classId: string, assignmentId: string, studentId?: string) => {
      return ratings.filter((r) => {
        if (r.class_id !== classId) return false;
        if (r.assignment_id !== assignmentId) return false;
        if (studentId && r.student_id !== studentId) return false;
        return true;
      });
    }),
    __resetStore: () => { ratings = []; },
  };
});

const { __resetStore } = await import("@/lib/nosql") as unknown as { __resetStore: () => void };

beforeEach(() => {
  __resetStore();
});

describe("POST /api/content-rating", () => {
  it("should save a valid rating", async () => {
    const req = new Request("http://localhost:3000/api/content-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "c1",
        assignmentId: "a1",
        studentId: "s1",
        contentItemId: "item-1",
        rating: 4,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.rating.rating).toBe(4);
  });

  it("should reject rating below 1", async () => {
    const req = new Request("http://localhost:3000/api/content-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "c1", assignmentId: "a1", studentId: "s1", contentItemId: "item-1", rating: 0,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should reject rating above 5", async () => {
    const req = new Request("http://localhost:3000/api/content-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "c1", assignmentId: "a1", studentId: "s1", contentItemId: "item-1", rating: 6,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should reject non-numeric rating", async () => {
    const req = new Request("http://localhost:3000/api/content-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "c1", assignmentId: "a1", studentId: "s1", contentItemId: "item-1", rating: "high",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should reject missing fields", async () => {
    const req = new Request("http://localhost:3000/api/content-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/content-rating", () => {
  it("should list ratings for a class", async () => {
    await POST(new Request("http://localhost:3000/api/content-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s1", contentItemId: "item-1", rating: 5 }),
    }));
    await POST(new Request("http://localhost:3000/api/content-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s1", contentItemId: "item-2", rating: 3 }),
    }));

    const req = new Request("http://localhost:3000/api/content-rating?classId=c1&assignmentId=a1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ratings).toHaveLength(2);
  });

  it("should filter ratings by studentId", async () => {
    await POST(new Request("http://localhost:3000/api/content-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s1", contentItemId: "item-1", rating: 5 }),
    }));
    await POST(new Request("http://localhost:3000/api/content-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s2", contentItemId: "item-1", rating: 2 }),
    }));

    const req = new Request("http://localhost:3000/api/content-rating?classId=c1&assignmentId=a1&studentId=s1");
    const res = await GET(req);
    const data = await res.json();
    expect(data.ratings).toHaveLength(1);
    expect(data.ratings[0].student_id).toBe("s1");
  });

  it("should allow updating a rating", async () => {
    await POST(new Request("http://localhost:3000/api/content-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s1", contentItemId: "item-1", rating: 3 }),
    }));
    // Update
    await POST(new Request("http://localhost:3000/api/content-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", studentId: "s1", contentItemId: "item-1", rating: 5 }),
    }));

    const req = new Request("http://localhost:3000/api/content-rating?classId=c1&assignmentId=a1&studentId=s1");
    const res = await GET(req);
    const data = await res.json();
    expect(data.ratings).toHaveLength(1);
    expect(data.ratings[0].rating).toBe(5);
  });
});
