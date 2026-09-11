import OpenAI, { APIConnectionTimeoutError } from "openai";
import { NextResponse } from "next/server";

import {
  getLessonGenerationContext,
  resolveQuizEvidence,
  type LessonGenerationContext,
  type ResolvedQuizEvidence,
} from "@/lib/lesson-context";
import { getCachedPlanJson, upsertCachedPlanJson } from "@/lib/nosql";
import {
  deserializeCachedPlan,
  serializeCachedPlan,
} from "@/lib/strategy-plan-cache";

type Answers = Record<string, string | undefined>;

type Student = {
  id: string;
  name: string;
  assignment?: string;
  answers: Answers;
};

type Plan = {
  name: string;
  strategy: string;
  relevance: Record<string, number>;
  overallRecommendation: string;
  recommendationReason: string;
  summary: string;
  tldr: string;
  rationale: string;
  tactics: string[];
  cadence: string;
  checks: string[];
};

type StudentStrategyResult = {
  id: string;
  name: string;
  plan: Plan;
};

type StudentStrategyError = {
  id: string;
  name: string;
  error: string;
};

export const runtime = "nodejs";
export const maxDuration = 60;

const STRATEGY_REQUEST_TIMEOUT_MS = 45_000;
const STRATEGY_BATCH_CONCURRENCY = 4;

const buildPrompt = (
  student: Student,
  lessonContext: LessonGenerationContext | null,
  quizEvidence: ResolvedQuizEvidence[],
) => ({
  system: `You are an education engagement planner.
Return JSON only with keys: name, strategy, relevance, overallRecommendation, recommendationReason, summary, tldr, rationale, tactics, cadence, checks.
The strategy must be exactly one of: cognitive conflict, analogy, experience bridging, engaged critiquing.
The relevance field is an object with those four strategies as keys and integer scores from 0-100.
Base the recommendation primarily on the student's quiz evidence: question text, selected response, confidence, correctness, and any linked misconception.
Use the lesson learning objective as supplemental context, not as a substitute for the student's quiz evidence.
Make the recommendationReason reference the student by name and the assignment/topic.
For recommendationReason and rationale, cite 2+ concrete details from the student's quiz evidence and connect them directly to the chosen strategy.`,
  user: `Student name: ${student.name}
Assignment: ${lessonContext?.lessonTitle ?? student.assignment ?? "Not provided"}

${lessonContext ? `Lesson objective:\n${lessonContext.learningObjective}\n\n` : ""}Structured quiz evidence:
${quizEvidence.length > 0 ? JSON.stringify(quizEvidence, null, 2) : JSON.stringify(student.answers, null, 2)}

Return a plan:
- name: short label
- strategy: one of [cognitive conflict, analogy, experience bridging, engaged critiquing]
- relevance: scores 0-100 for each strategy
- overallRecommendation: 1-2 sentences, teacher-facing
- recommendationReason: 2-3 sentences explaining why this strategy fits ${student.name}; reference the assignment/topic and cite 2+ specific quiz-evidence details
- summary: 1 sentence
- tldr: 8-14 words, teacher-facing
- rationale: 3-5 sentences; reference the assignment/topic and include at least one concrete in-class example of how the teacher would use the strategy with ${student.name}
- tactics: 3-5 bullets
- cadence: short phrase
- checks: 1-3 quick checks`,
});

const parseJson = (value: string | null | undefined) => {
  if (!value) {
    throw new Error("LLM returned empty response.");
  }
  return JSON.parse(value) as Plan;
};

const normalizeStrategy = (strategy: string) => strategy.trim().toLowerCase();

const ensurePlanFields = (plan: Plan) => {
  if (!plan.relevance || typeof plan.relevance !== "object") {
    plan.relevance = {};
  }
  const keys = [
    "cognitive conflict",
    "analogy",
    "experience bridging",
    "engaged critiquing",
  ];
  keys.forEach((key) => {
    if (typeof plan.relevance[key] !== "number") {
      plan.relevance[key] = key === plan.strategy ? 100 : 0;
    }
  });
  if (!plan.overallRecommendation) {
    plan.overallRecommendation = plan.summary || "Provide a focused strategy.";
  }
  if (!plan.recommendationReason) {
    plan.recommendationReason =
      plan.rationale || "Aligned to student responses.";
  }
  if (!plan.tldr) {
    plan.tldr = plan.summary || "Use the recommended strategy.";
  }
  return plan;
};

const chunkItems = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const isTimeoutError = (error: unknown) =>
  error instanceof APIConnectionTimeoutError ||
  (error instanceof Error &&
    (error.constructor.name === "APIConnectionTimeoutError" ||
      error.message === "Request timed out."));

const buildStudentError = (
  student: Student,
  error: unknown,
): StudentStrategyError => ({
  id: student.id,
  name: student.name,
  error: isTimeoutError(error)
    ? "Strategy generation timed out before the model returned."
    : error instanceof Error
      ? error.message
      : `Failed to analyze ${student.name}.`,
});

const generatePlanForStudent = async ({
  client,
  model,
  classKey,
  assignmentKey,
  forceRefresh,
  student,
  lessonContext,
  quizEvidence,
}: {
  client: OpenAI;
  model: string;
  classKey: string;
  assignmentKey: string;
  forceRefresh: boolean;
  student: Student;
  lessonContext: LessonGenerationContext | null;
  quizEvidence: ResolvedQuizEvidence[];
}): Promise<StudentStrategyResult> => {
  if (!forceRefresh) {
    const cachedPlanJson = await getCachedPlanJson(
      classKey,
      assignmentKey,
      student.id,
    );
    if (cachedPlanJson) {
      const cachedPlan = deserializeCachedPlan<Plan>(cachedPlanJson, {
        lessonNumber: lessonContext?.lessonNumber,
        requireVersionMatch: lessonContext !== null,
      });
      if (cachedPlan) {
        cachedPlan.strategy = normalizeStrategy(cachedPlan.strategy);
        const plan = ensurePlanFields(cachedPlan);
        return { id: student.id, name: student.name, plan };
      }
    }
  }

  const prompt = buildPrompt(student, lessonContext, quizEvidence);
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });

  const parsedPlan = parseJson(completion.choices[0]?.message?.content);
  parsedPlan.strategy = normalizeStrategy(parsedPlan.strategy);
  const plan = ensurePlanFields(parsedPlan);

  await upsertCachedPlanJson(
    classKey,
    assignmentKey,
    student.id,
    serializeCachedPlan(plan, lessonContext?.lessonNumber),
  );

  return { id: student.id, name: student.name, plan };
};

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set." },
      { status: 500 },
    );
  }

  try {
    const startedAt = Date.now();
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: STRATEGY_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    const {
      students = [],
      classId,
      assignmentId,
      lessonNumber,
      forceRefresh,
    } = (await request.json()) as {
      students?: Student[];
      classId?: string;
      assignmentId?: string;
      lessonNumber?: number;
      forceRefresh?: boolean;
    };
    const classKey = classId?.trim();
    const assignmentKey = assignmentId?.trim();
    if (!classKey || !assignmentKey) {
      return NextResponse.json(
        { error: "classId and assignmentId are required." },
        { status: 400 },
      );
    }

    const lessonContext =
      typeof lessonNumber === "number"
        ? getLessonGenerationContext(lessonNumber)
        : null;
    if (typeof lessonNumber === "number" && !lessonContext) {
      return NextResponse.json(
        { error: `Lesson ${lessonNumber} not found.` },
        { status: 400 },
      );
    }

    const model = process.env.OPENAI_MODEL ?? "gpt-5-nano";
    const shouldForceRefresh = forceRefresh === true;
    const results: StudentStrategyResult[] = [];
    const errors: StudentStrategyError[] = [];

    const studentChunks = chunkItems(students, STRATEGY_BATCH_CONCURRENCY);
    for (const studentChunk of studentChunks) {
      const settledResults = await Promise.allSettled(
        studentChunk.map((student) =>
          generatePlanForStudent({
            client,
            model,
            classKey,
            assignmentKey,
            forceRefresh: shouldForceRefresh,
            student,
            lessonContext,
            quizEvidence:
              typeof lessonNumber === "number"
                ? resolveQuizEvidence(lessonNumber, student.answers)
                : [],
          }),
        ),
      );

      for (let index = 0; index < settledResults.length; index += 1) {
        const settled = settledResults[index];
        const student = studentChunk[index];
        if (settled.status === "fulfilled") {
          results.push(settled.value);
          continue;
        }

        errors.push(buildStudentError(student, settled.reason));
      }
    }

    const distribution: Record<string, number> = {};
    results.forEach((result) => {
      const key = normalizeStrategy(result.plan.strategy);
      distribution[key] = (distribution[key] ?? 0) + 1;
    });

    if (results.length > 0) {
      console.info(
        `strategy-batch complete: classId=${classKey} assignmentId=${assignmentKey} students=${students.length} results=${results.length} errors=${errors.length} durationMs=${Date.now() - startedAt}`,
      );
      return NextResponse.json({ results, distribution, errors });
    }

    const firstError = errors[0]?.error ?? "Failed to analyze students.";
    const timedOut = errors.every((error) =>
      error.error === "Strategy generation timed out before the model returned.",
    );

    console.info(
      `strategy-batch failed: classId=${classKey} assignmentId=${assignmentKey} students=${students.length} results=0 errors=${errors.length} durationMs=${Date.now() - startedAt}`,
    );
    return NextResponse.json(
      { error: firstError, errors, distribution },
      { status: timedOut ? 504 : 500 },
    );
  } catch (error) {
    const isUpstreamTimeout = isTimeoutError(error);
    const message =
      isUpstreamTimeout
        ? "Strategy generation timed out before the model returned."
        : error instanceof Error
          ? error.message
          : "Failed to analyze students.";
    console.error("strategy-batch error:", message, error);
    return NextResponse.json(
      { error: message },
      { status: isUpstreamTimeout ? 504 : 500 },
    );
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
