import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/data-export/route";
import { sessionUser } from "@/lib/session";
vi.mock("@/lib/session", () => ({ sessionUser: vi.fn() }));
vi.mock("@/lib/workspace", async original => ({ ...await original<typeof import("@/lib/workspace")>(), listWorkspaceClasses: async () => [{ id: "ea-class-owned" }] }));
vi.mock("@/lib/nosql", () => ({
  listAllTeacherAnnotations: async () => [],
  listAllStudentAnswers: async () => ["legacy", "ea-class-owned", "CLASS#ea-class-other"].map(class_id => ({ class_id, submitted_at: "2026-09-11T00:00:00.000Z" })),
  listAllCachedPlans: async () => ["CLASS#ea-class-owned", "CLASS#ea-class-other"].map(class_id => ({ class_id, updated_at: "2026-09-11T00:00:00.000Z" })),
  listAllPublishedContent: async () => [], listAllContentRatings: async () => [],
}));
beforeEach(() => vi.mocked(sessionUser).mockResolvedValue(null));
it("excludes native records from anonymous legacy exports, including DynamoDB key prefixes", async () => {
  const data = await (await GET(new NextRequest("https://engageagent.ai4genius.org/api/data-export"))).json();
  expect(data.months[0]).toMatchObject({ studentAnswers: 1, strategyPlans: 0 });
});
it("includes only the teacher's own native classes", async () => {
  vi.mocked(sessionUser).mockResolvedValue({ geniusId: "teacher", userId: "teacher", name: "Teacher", role: "teacher", email: null });
  const data = await (await GET(new NextRequest("https://engageagent.ai4genius.org/api/data-export"))).json();
  expect(data.months[0]).toMatchObject({ studentAnswers: 2, strategyPlans: 1 });
});
