import { afterEach, expect, it } from "vitest";
import { clearVerifiedClientAuth, scopedClientAuthHeaders, setVerifiedClientAuth } from "@/lib/client-auth";
import type { UserContext } from "@/lib/auth";

const user: UserContext = { geniusId: "teacher", userId: "teacher", email: null, name: "Teacher", role: "teacher", classId: "host-class", assignmentId: "host-task" };
afterEach(clearVerifiedClientAuth);

it("uses only an active verified identity matching both task coordinates", () => {
  expect(scopedClientAuthHeaders(user)).toEqual({});
  setVerifiedClientAuth("verified-credential", user);
  expect(scopedClientAuthHeaders(user)).toEqual({ Authorization: "Bearer verified-credential" });
  for (const scope of [{}, { classId: user.classId }, { classId: user.classId, assignmentId: "other-task" }, { classId: "other-class", assignmentId: user.assignmentId }]) {
    expect(scopedClientAuthHeaders(scope)).toEqual({});
  }
  clearVerifiedClientAuth();
  expect(scopedClientAuthHeaders(user)).toEqual({});
});

it("never sends embedded credentials for native classes, or carries old credentials into an unscoped identity", () => {
  setVerifiedClientAuth("host-token", user);
  const native = { ...user, classId: "ea-class-a", assignmentId: "ea-task-a" };
  expect(scopedClientAuthHeaders(native)).toEqual({});
  setVerifiedClientAuth("native-token", native);
  expect(scopedClientAuthHeaders(native)).toEqual({});
  expect(scopedClientAuthHeaders(user)).toEqual({});
  setVerifiedClientAuth("host-token", user);
  setVerifiedClientAuth("unscoped-token", { ...user, classId: undefined });
  expect(scopedClientAuthHeaders(user)).toEqual({});
});
