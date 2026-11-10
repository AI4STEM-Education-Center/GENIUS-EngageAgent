import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";

// The class dashboard (#207) must read the quiz published for each task (#177),
// including its confirmed matches, through the real local stores.
let directory: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("counts both matches from a published uploaded quiz against its own wrong answers", async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "engage-class-dashboard-task-quiz-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", directory);
  vi.stubEnv("DYNAMODB_TABLE", "");
  vi.stubEnv("ENGAGE_S3_BUCKET", "");
  vi.resetModules();
  const workspace = await import("@/lib/workspace");
  const quizStore = await import("@/lib/task-quiz-store");
  const { importedItem } = await import("@/lib/task-quiz");
  const { MisconceptionId } = await import("@/lib/misconceptions");
  const { upsertQuizStatus, upsertStudentAnswer } = await import("@/lib/nosql");
  const { getClassDashboard } = await import("@/lib/class-dashboard");
  const teacher: UserContext = { geniusId: "teacher", userId: "teacher", name: "Ana", email: null, role: "teacher" };
  const classroom = await workspace.createWorkspaceClass(teacher, "Physics");
  const assignment = await workspace.createWorkspaceAssignment(teacher, classroom.id, "Uploaded warm-up");
  const task = { classId: classroom.id, assignmentId: assignment.id };
  const matches = [MisconceptionId.NoVisibleDamageMeansWeakForce, MisconceptionId.HeavierAlwaysCausesMoreDamage];
  const ids = ["dashboard-upload-one", "dashboard-upload-two"];

  await quizStore.pickQuizLesson(teacher, task, 1, false);
  await upsertQuizStatus(task.classId, task.assignmentId, 1, "draft", teacher.geniusId);
  await quizStore.replaceQuizItems(teacher, task, {
    source: "uploaded", sourceDetail: null, confirmReplace: true,
    items: ids.map(id => importedItem(id, `Question ${id}?`, ["Correct", "Incorrect", "Other", "Another"], "A")),
  });
  for (const id of ids) {
    for (const letter of ["B", "C", "D"]) {
      const linked = id === ids[0] && letter === "B";
      await quizStore.changeQuizItem(teacher, task, id, {
        action: "setMatch", letter, ids: linked ? matches : [], noMisconception: !linked,
      });
    }
    await quizStore.changeQuizItem(teacher, task, id, { action: "confirm" });
  }

  for (const answer of [
    { student_id: "s1", student_name: "Sam", lesson_number: 1, answers: { [ids[0]]: "B", [ids[1]]: "A" } },
    { student_id: "s2", student_name: "Ava", lesson_number: 1, answers: { [ids[0]]: "A", [ids[1]]: "B" } },
    { student_id: "earlier", student_name: "Earlier lesson", lesson_number: 2, answers: { [ids[0]]: "B", [ids[1]]: "B" } },
  ]) await upsertStudentAnswer({ ...answer, class_id: task.classId, assignment_id: task.assignmentId, submitted_at: "2026-11-10T12:00:00Z" });

  // Saved answers do not make a draft quiz appear in the class patterns.
  expect((await getClassDashboard(teacher, task.classId)).misconceptions).toEqual([]);
  const published = await quizStore.publishTaskQuiz(teacher, task);
  expect(published.quiz.source).toBe("uploaded");
  expect(published.quiz.items.map(item => item.id)).toEqual(ids);

  const dashboard = await getClassDashboard(teacher, task.classId);
  expect(dashboard.misconceptions).toHaveLength(2);
  for (const code of matches) {
    expect(dashboard.misconceptions.find(row => row.code === code)).toMatchObject({
      assignmentId: task.assignmentId, lessonNumber: 1, count: 1, incorrect: 2,
    });
  }
});
