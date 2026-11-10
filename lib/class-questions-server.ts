import OpenAI from "openai";
import type { ChatClient } from "./daily-experience-llm";
import { getQuizStatus, getTaskDoc, listReviewQuestions, listStudentAnswers, putTaskDoc } from "./nosql";
import { getTaskLesson } from "./lessons-store";
import {
  analyzeQuestions,
  collectQuestions,
  DEFAULT_QUESTION_MODEL,
  groupQuestions,
  QUESTION_ANALYSIS_VERSION,
  questionsSourceKey,
  type QuestionAnalysis,
  type QuestionGroup,
} from "./class-questions";

export type TaskQuestions = {
  lessonNumber: number | null;
  total: number;
  students: number;
  groups: QuestionGroup[];
  /** Set when the questions couldn't be sorted; they are still listed in one group. */
  analysisError: string | null;
};

const defaultClient = (): ChatClient | null =>
  process.env.OPENAI_API_KEY ? (new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as ChatClient) : null;

// Concurrent reads of the same task on this server share one analysis.
const inFlight = new Map<string, Promise<QuestionAnalysis>>();

/** The task's student questions, sorted by a saved analysis that is redone only when the questions change. */
export async function getTaskQuestions(classId: string, assignmentId: string, client: ChatClient | null = defaultClient()): Promise<TaskQuestions> {
  const [records, answers, quiz] = await Promise.all([
    listReviewQuestions(classId, assignmentId),
    listStudentAnswers(classId, assignmentId),
    getQuizStatus(classId, assignmentId),
  ]);
  const names = new Map(answers.map(answer => [answer.student_id, answer.student_name]));
  const questions = collectQuestions(records, names);
  const lesson = quiz?.lesson_number ? (await getTaskLesson(classId, assignmentId, quiz.lesson_number))?.lesson : undefined;
  const base = { lessonNumber: lesson?.lesson_number ?? null, total: questions.length, students: new Set(questions.map(q => q.studentId)).size };
  if (questions.length === 0) return { ...base, groups: [], analysisError: null };

  let analysis = await getTaskDoc<QuestionAnalysis>(classId, assignmentId, "question_analysis");
  let analysisError: string | null = null;
  if (analysis?.sourceKey !== questionsSourceKey(questions)) {
    // An older analysis still sorts the questions it covered; new ones go under "Other questions".
    const previous = analysis?.version === QUESTION_ANALYSIS_VERSION ? analysis : null;
    if (!client || !lesson) {
      analysis = previous;
      analysisError = !client ? "AI sorting is not set up on this server." : "Choose the task's lesson in Step 1 to sort the questions.";
    } else {
      const key = `${classId}\n${assignmentId}`;
      let job = inFlight.get(key);
      if (!job) {
        job = analyzeQuestions(client, lesson, questions, process.env.OPENAI_QUESTION_ANALYSIS_MODEL ?? DEFAULT_QUESTION_MODEL)
          .then(async (result) => { await putTaskDoc(classId, assignmentId, "question_analysis", result); return result; })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, job);
      }
      try {
        analysis = await job;
      } catch {
        analysis = previous;
        analysisError = "The questions couldn't be sorted right now.";
      }
    }
  }
  return { ...base, groups: groupQuestions(questions, analysis), analysisError };
}
