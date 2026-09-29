import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/lessons/[lessonNumber]/route";

describe("GET /api/lessons/[lessonNumber]", () => {
  it("should return lesson 1", async () => {
    const req = new Request("http://localhost:3000/api/lessons/1");
    const res = await GET(req, { params: Promise.resolve({ lessonNumber: "1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.lesson_number).toBe(1);
    expect(data.learning_objective).toBeTruthy();
    expect(data.quiz_items.length).toBeGreaterThan(0);
  });

  it("should return lesson 8", async () => {
    const req = new Request("http://localhost:3000/api/lessons/8");
    const res = await GET(req, { params: Promise.resolve({ lessonNumber: "8" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.lesson_number).toBe(8);
  });

  it("should return 400 for lesson 0", async () => {
    const req = new Request("http://localhost:3000/api/lessons/0");
    const res = await GET(req, { params: Promise.resolve({ lessonNumber: "0" }) });
    expect(res.status).toBe(400);
  });

  it("should return 400 for lesson 9", async () => {
    const req = new Request("http://localhost:3000/api/lessons/9");
    const res = await GET(req, { params: Promise.resolve({ lessonNumber: "9" }) });
    expect(res.status).toBe(400);
  });

  it("should return 400 for non-numeric", async () => {
    const req = new Request("http://localhost:3000/api/lessons/abc");
    const res = await GET(req, { params: Promise.resolve({ lessonNumber: "abc" }) });
    expect(res.status).toBe(400);
  });
});
