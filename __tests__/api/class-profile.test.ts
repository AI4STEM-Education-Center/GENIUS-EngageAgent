import { beforeEach, describe, expect, it, vi } from "vitest";

// Route behavior below assumes an authorized teacher. Student and guest
// denial is covered in workspace-access.test.ts.
vi.mock("@/lib/workspace-access", () => ({
  guardWorkspaceRequest: vi.fn(async () => null),
  guardWorkspaceClassRequest: vi.fn(async () => null),
  workspaceRequestUser: vi.fn(async () => ({ role: "teacher", geniusId: "t1" })),
}));

vi.mock("@/lib/nosql", () => {
  let store: Record<string, unknown> = {};
  return {
    getClassProfile: vi.fn(async (classId: string) => store[classId] ?? null),
    upsertClassProfile: vi.fn(async (record: { class_id: string }) => {
      store[record.class_id] = record;
      return record;
    }),
    __resetStore: () => {
      store = {};
    },
  };
});

import { GET, POST } from "@/app/api/class-profile/route";
import { guardWorkspaceClassRequest, guardWorkspaceRequest } from "@/lib/workspace-access";
import { getClassProfile } from "@/lib/nosql";

const { __resetStore } = (await import("@/lib/nosql")) as unknown as { __resetStore: () => void };

const profile = {
  locale: "rural",
  groups: ["white", "hispanic_latino"],
  groupAlternative: null,
  classType: "general",
  englishLearners: true,
  iepOr504: true,
};

const get = (query = "classId=c1&assignmentId=a1") =>
  GET(new Request(`http://localhost:3000/api/class-profile?${query}`));
const post = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost:3000/api/class-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "c1", assignmentId: "a1", ...body }),
    }),
  );

beforeEach(() => {
  __resetStore();
  vi.clearAllMocks();
});

describe("GET /api/class-profile", () => {
  it("returns null before the teacher has been asked", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).classProfile).toBeNull();
  });

  it("requires a classId", async () => {
    expect((await get("assignmentId=a1")).status).toBe(400);
  });

  it("stops when the access check denies the request", async () => {
    vi.mocked(guardWorkspaceRequest).mockResolvedValueOnce(new Response(null, { status: 403 }) as never);
    expect((await get()).status).toBe(403);
    expect(getClassProfile).not.toHaveBeenCalled();
  });

  it("explains a missing database table", async () => {
    vi.mocked(getClassProfile).mockRejectedValueOnce(new Error("Requested resource not found"));
    const res = await get();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Database resource not found. Check DYNAMODB_TABLE and ENGAGE_AWS_REGION.");
  });
});

describe("POST /api/class-profile", () => {
  it("saves the profile for the class with who saved it", async () => {
    const res = await post({ profile });
    expect(res.status).toBe(200);
    const saved = (await res.json()).classProfile;
    expect(saved).toMatchObject({ ...profile, class_id: "c1", status: "saved", updated_by: "t1" });
    expect(saved.updated_at).toBeTruthy();
    expect((await (await get()).json()).classProfile).toEqual(saved);
  });

  it("shares one profile across every task in the class", async () => {
    await post({ profile });
    const other = await get("classId=c1&assignmentId=another-task");
    expect((await other.json()).classProfile).toMatchObject(profile);
  });

  it("rejects answers that are not listed options", async () => {
    const res = await post({ profile: { ...profile, groups: ["white", "asian", "hispanic_latino", "black_african_american"] } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Choose up to 3 groups.");
    expect((await post({})).status).toBe(400);
  });

  it("no longer takes a skip, so it can't touch a saved profile", async () => {
    await post({ profile });
    expect((await post({ skip: true })).status).toBe(400);
    expect((await (await get()).json()).classProfile).toMatchObject({ ...profile, status: "saved" });
  });

  it("requires a classId", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/class-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: "a1", profile }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("which access check runs (#173)", () => {
  const raw = (body: string) => POST(new Request("http://localhost:3000/api/class-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body }));

  it("checks the task when opened from inside one, and the class on the class page", async () => {
    await get("classId=c1&assignmentId=a1");
    expect(guardWorkspaceRequest).toHaveBeenCalledTimes(1);
    expect(guardWorkspaceClassRequest).not.toHaveBeenCalled();

    vi.mocked(guardWorkspaceRequest).mockClear();
    await get("classId=c1");
    await raw(JSON.stringify({ classId: "c1", profile }));
    expect(guardWorkspaceClassRequest).toHaveBeenCalledTimes(2);
    expect(guardWorkspaceRequest).not.toHaveBeenCalled();
  });

  it("sends any request that names a task, even an empty one, to the task check", async () => {
    await raw(JSON.stringify({ classId: "c1", assignmentId: "", profile }));
    await get("classId=c1&assignmentId=");
    expect(guardWorkspaceRequest).toHaveBeenCalledTimes(2);
    expect(guardWorkspaceClassRequest).not.toHaveBeenCalled();
  });

  it("stops at the class check without reading or saving anything", async () => {
    vi.mocked(guardWorkspaceClassRequest).mockResolvedValue(new Response(null, { status: 403 }) as never);
    expect((await raw(JSON.stringify({ classId: "c1", profile }))).status).toBe(403);
    expect((await get("classId=c1")).status).toBe(403);
    expect((await raw("not json")).status).toBe(403);
    expect(getClassProfile).not.toHaveBeenCalled();
    vi.mocked(guardWorkspaceClassRequest).mockResolvedValue(null);
  });
});
