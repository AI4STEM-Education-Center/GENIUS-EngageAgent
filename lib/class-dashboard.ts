import { getQuizStatus, getTaskDoc, listReviewQuestions, listStudentAnswers, putTaskDoc } from "./nosql";
import { getTaskLesson } from "./lessons-store";
import { countClassResponses } from "./strategy-recommendation";
import { BoardError, collectQuestions, groupQuestions, parseBoard, questionId, type QuestionAnalysis, type QuestionBoard, type QuestionTag } from "./class-questions";
import { workspaceClassDetail, WorkspaceError } from "./workspace";
import type { UserContext } from "./auth";

/**
 * The class dashboard (#207): across every task in a class, how often each
 * misconception was chosen in the quiz, and every student question with a way
 * to add it to another lesson's Class Question Board. The top of the page
 * isn't decided yet, so there's nothing for it here.
 */

/** A task in the class and the lesson its quiz uses, if one is chosen. */
export type DashboardTask = { assignmentId: string; title: string; lessonNumber: number | null; boardPublished: boolean };

export type MisconceptionPattern = {
  assignmentId: string;
  lessonNumber: number;
  /** When students took the quiz: the latest submission. */
  takenAt: string;
  code: string;
  text: string;
  /** Wrong answers linked to this misconception… */
  count: number;
  /** …out of all wrong answers in the quiz. */
  incorrect: number;
};

export type DashboardQuestion = {
  id: string;
  text: string;
  studentName: string;
  assignmentId: string;
  lessonNumber: number | null;
  askedAt: string;
  tag: QuestionTag | null;
  /** IDs of the tasks whose board shows this question. */
  onBoards: string[];
};

export type ClassDashboard = { tasks: DashboardTask[]; misconceptions: MisconceptionPattern[]; questions: DashboardQuestion[] };

const latest = (dates: string[]) => dates.reduce((a, b) => (b > a ? b : a), "");

async function readTask(classId: string, assignmentId: string) {
  const [quiz, answers, reviews, analysis, board] = await Promise.all([
    getQuizStatus(classId, assignmentId),
    listStudentAnswers(classId, assignmentId),
    listReviewQuestions(classId, assignmentId),
    getTaskDoc<QuestionAnalysis>(classId, assignmentId, "question_analysis"),
    getTaskDoc<QuestionBoard>(classId, assignmentId, "question_board"),
  ]);
  const lessonNumber = quiz?.lesson_number ?? null;
  // The lesson as this task reads it (its pinned version or published quiz).
  const lesson = lessonNumber ? (await getTaskLesson(classId, assignmentId, lessonNumber))?.lesson ?? null : null;
  return { quiz, answers, reviews, analysis, board, lessonNumber, lesson };
}

/** Teacher-only; the caller has checked the teacher owns the class. */
export async function getClassDashboard(user: UserContext, classId: string): Promise<ClassDashboard> {
  const { assignments } = await workspaceClassDetail(user, classId);
  const tasks = await Promise.all(assignments.map(async item => ({ item, data: await readTask(classId, item.id) })));

  const misconceptions: MisconceptionPattern[] = [];
  const questions: DashboardQuestion[] = [];
  const boards = new Map<string, Set<string>>();
  for (const { item, data } of tasks) boards.set(item.id, new Set(data.board?.questions.map(q => q.id) ?? []));

  for (const { item, data } of tasks) {
    // Misconceptions: only answers to the quiz the task uses now.
    if (data.lesson && data.quiz && data.quiz.status !== "draft") {
      const answers = data.answers.filter(answer => answer.lesson_number === data.lessonNumber);
      let counts = null;
      try { counts = answers.length ? countClassResponses(data.lesson, answers.map(answer => answer.answers)) : null; } catch { counts = null; }
      if (counts) {
        const takenAt = latest(answers.map(answer => answer.submitted_at));
        for (const m of counts.misconceptions) {
          if (m.count > 0) misconceptions.push({ assignmentId: item.id, lessonNumber: data.lessonNumber!, takenAt, code: m.id, text: m.statement, count: m.count, incorrect: counts.incorrect });
        }
      }
    }

    // Questions, with the tags from the task's saved sorting (no new AI call here).
    const names = new Map(data.answers.map(answer => [answer.student_id, answer.student_name]));
    const asked = new Map<string, string>();
    for (const record of data.reviews) for (const text of record.questions) {
      if (!text.trim()) continue;
      const id = questionId(record.student_id, text);
      if (!asked.has(id) || record.submitted_at < asked.get(id)!) asked.set(id, record.submitted_at);
    }
    const collected = collectQuestions(data.reviews, names);
    const tags = new Map(groupQuestions(collected, data.analysis).flatMap(group => group.questions.map(q => [q.id, q.tag ?? null] as const)));
    for (const q of collected) {
      questions.push({
        id: q.id, text: q.text, studentName: q.studentName, assignmentId: item.id, lessonNumber: data.lessonNumber,
        askedAt: asked.get(q.id) ?? "", tag: tags.get(q.id) ?? null,
        onBoards: [...boards].filter(([, ids]) => ids.has(q.id)).map(([id]) => id),
      });
    }
  }

  misconceptions.sort((a, b) => b.takenAt.localeCompare(a.takenAt) || b.count - a.count);
  questions.sort((a, b) => b.askedAt.localeCompare(a.askedAt));
  return {
    tasks: tasks.map(({ item, data }) => ({ assignmentId: item.id, title: item.title, lessonNumber: data.lessonNumber, boardPublished: Boolean(data.board) })),
    misconceptions,
    questions,
  };
}

/**
 * Adds one student question, from any task in the class, to another task's
 * Class Question Board. That board must already be published: adding to it
 * shouldn't be what puts a board in front of students.
 */
export async function addQuestionToBoard(user: UserContext, classId: string, input: { questionId?: unknown; fromAssignmentId?: unknown; toAssignmentId?: unknown }) {
  const { assignments } = await workspaceClassDetail(user, classId);
  const from = assignments.find(item => item.id === input.fromAssignmentId);
  const to = assignments.find(item => item.id === input.toAssignmentId);
  if (!from || !to) throw new WorkspaceError("Task not found in this class.", 404);
  const [reviews, answers, board] = await Promise.all([
    listReviewQuestions(classId, from.id),
    listStudentAnswers(classId, from.id),
    getTaskDoc<QuestionBoard>(classId, to.id, "question_board"),
  ]);
  const question = collectQuestions(reviews, new Map(answers.map(answer => [answer.student_id, answer.student_name]))).find(q => q.id === input.questionId);
  if (!question) throw new WorkspaceError("Question not found.", 404);
  if (!board) throw new WorkspaceError("Publish that lesson's Class Question Board in Step 4 first.", 409);
  if (board.questions.some(q => q.id === question.id)) return { board, added: false };
  // Names never go on the board.
  const next = parseBoard([...board.questions, { id: question.id, text: question.text, theme: "" }]);
  await putTaskDoc(classId, to.id, "question_board", next);
  return { board: next, added: true };
}

export { BoardError };
