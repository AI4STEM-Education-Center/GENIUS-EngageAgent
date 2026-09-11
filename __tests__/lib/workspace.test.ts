import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceClass, createWorkspaceAssignment, joinWorkspaceClass, listWorkspaceClasses, workspaceClassDetail, workspaceContext } from "@/lib/workspace";
import type { UserContext } from "@/lib/auth";

const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Teacher", email: null, role: "teacher" };
const student: UserContext = { geniusId: "student-1", userId: "student-1", name: "Student", email: null, role: "student" };
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-workspace-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir); vi.stubEnv("DYNAMODB_TABLE", "");
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("independent workspace", () => {
  it("persists teacher classes and tasks independently of GENIUS assignments", async () => {
    const classroom = await createWorkspaceClass(teacher, "Physics");
    const task = await createWorkspaceAssignment(teacher, classroom.id, "Lesson 1");
    expect(await listWorkspaceClasses(teacher)).toEqual([{ id: classroom.id, name: "Physics" }]);
    expect(await workspaceContext(teacher, classroom.id, task.id)).toMatchObject({ geniusId: teacher.geniusId, classId: classroom.id, assignmentId: task.id, role: "teacher" });
    expect((await workspaceClassDetail(teacher, classroom.id)).assignments).toEqual([task]);
  });
  it("requires enrollment and preserves GENIUS ID for student responses", async () => {
    const classroom = await createWorkspaceClass(teacher, "Physics");
    const task = await createWorkspaceAssignment(teacher, classroom.id, "Quiz");
    await expect(workspaceContext(student, classroom.id, task.id)).rejects.toMatchObject({ status: 403 });
    await joinWorkspaceClass(student, classroom.joinCode.toLowerCase());
    await joinWorkspaceClass(student, classroom.joinCode);
    expect((await workspaceClassDetail(teacher, classroom.id)).members).toEqual([{ geniusId: student.geniusId, name: student.name }]);
    expect((await workspaceClassDetail(student, classroom.id)).classroom).not.toHaveProperty("joinCode");
    expect((await workspaceClassDetail(student, classroom.id)).members).toEqual([]);
    expect((await workspaceContext(student, classroom.id, task.id)).geniusId).toBe(student.geniusId);
  });
  it("does not share private classes with another teacher", async () => {
    const classroom = await createWorkspaceClass(teacher, "Physics");
    const other = { ...teacher, geniusId: "teacher-2" };
    expect(await listWorkspaceClasses(other)).toEqual([]);
    await expect(workspaceClassDetail(other, classroom.id)).rejects.toMatchObject({ status: 403 });
    await expect(createWorkspaceAssignment(other, classroom.id, "Intrusion")).rejects.toMatchObject({ status: 403 });
  });
  it("prevents student creation and wrong-class task selection", async () => {
    await expect(createWorkspaceClass(student, "No")).rejects.toMatchObject({ status: 403 });
    const a = await createWorkspaceClass(teacher, "A"), b = await createWorkspaceClass(teacher, "B");
    const task = await createWorkspaceAssignment(teacher, a.id, "Quiz");
    await expect(workspaceContext(teacher, b.id, task.id)).rejects.toMatchObject({ status: 404 });
    await joinWorkspaceClass(student, a.joinCode);
    await expect(createWorkspaceAssignment(student, a.id, "No")).rejects.toMatchObject({ status: 403 });
  });
  it("validates names and join codes without creating records", async () => {
    for (const name of ["", " ", "x".repeat(121), null]) await expect(createWorkspaceClass(teacher, name)).rejects.toThrow();
    await expect(joinWorkspaceClass(student, "bad")).rejects.toThrow("valid class code");
    expect(await listWorkspaceClasses(teacher)).toEqual([]);
  });
  it("does not lose concurrent class creations", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => createWorkspaceClass(teacher, `Class ${i}`)));
    expect(await listWorkspaceClasses(teacher)).toHaveLength(10);
  });
  it("never falls back to ephemeral files in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(createWorkspaceClass(teacher, "No ephemeral data")).rejects.toThrow("DYNAMODB_TABLE");
  });
});
