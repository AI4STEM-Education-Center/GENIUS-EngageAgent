import OpenAI from "openai";
import { NextResponse } from "next/server";

import {
  getLessonGenerationContext,
  resolveQuizEvidence,
  resolveSurveyEvidence,
  type LessonGenerationContext,
  type ResolvedQuizEvidence,
  type ResolvedSurveyEvidence,
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

export const runtime = "nodejs";
export const maxDuration = 60;

const STRATEGY_REQUEST_TIMEOUT_MS = 45_000;

const buildPrompt = (
  student: Student,
  lessonContext: LessonGenerationContext | null,
  quizEvidence: ResolvedQuizEvidence[],
  surveyEvidence: ResolvedSurveyEvidence[],
) => ({
  system: `You are an education engagement planner.
Return JSON only with keys: name, strategy, relevance, overallRecommendation, recommendationReason, summary, tldr, rationale, tactics, cadence, checks.
The strategy must be exactly one of: cognitive conflict, analogy, experience bridging, engaged critiquing.
The relevance field is an object with those four strategies as keys and integer scores from 0-100.
Base the recommendation primarily on the student's quiz evidence: question text, selected response, confidence, correctness, and any linked misconception.
Use the beginning-of-lesson survey responses as qualitative context about the student's familiarity and experiences. Do not treat survey responses as correct or incorrect, and do not select experience bridging merely because the survey asks about experience.
Use the lesson learning objective as supplemental context, not as a substitute for the student's quiz evidence.
Make the recommendationReason reference the student by name and the assignment/topic.
For recommendationReason and rationale, cite 2+ concrete details from the available quiz and survey evidence and connect them directly to the chosen strategy.`,
  user: `Student name: ${student.name}
Assignment: ${lessonContext?.lessonTitle ?? student.assignment ?? "Not provided"}

${lessonContext ? `Lesson objective:\n${lessonContext.learningObjective}\n\n` : ""}Structured quiz evidence:
${quizEvidence.length > 0 ? JSON.stringify(quizEvidence, null, 2) : JSON.stringify(student.answers, null, 2)}

Beginning-of-lesson survey evidence:
${surveyEvidence.length > 0 ? JSON.stringify(surveyEvidence, null, 2) : "No survey responses submitted."}

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
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: STRATEGY_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    const { student, classId, assignmentId, lessonNumber } = (await request.json()) as {
      student: Student;
      classId?: string;
      assignmentId?: string;
      lessonNumber?: number;
    };
    const classKey = classId?.trim();
    const assignmentKey = assignmentId?.trim();
    if (!classKey || !assignmentKey) {
      return NextResponse.json(
        { error: "classId and assignmentId are required." },
        { status: 400 },
      );
    }
    if (!student?.id) {
      return NextResponse.json(
        { error: "student.id is required." },
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
        return NextResponse.json({ plan });
      }
    }

    const model = process.env.OPENAI_MODEL ?? "gpt-5-nano";
    const prompt = buildPrompt(
      student,
      lessonContext,
      typeof lessonNumber === "number"
        ? resolveQuizEvidence(lessonNumber, student.answers)
        : [],
      typeof lessonNumber === "number"
        ? resolveSurveyEvidence(lessonNumber, student.answers)
        : [],
    );
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

    return NextResponse.json({ plan });
  } catch (error) {
    const isUpstreamTimeout =
      error instanceof Error && error.name === "APIConnectionTimeoutError";
    const message =
      isUpstreamTimeout
        ? "Strategy generation timed out before the model returned."
        : error instanceof Error
          ? error.message
          : "Failed to analyze student.";
    console.error("strategy-single error:", message, error);
    return NextResponse.json(
      { error: message },
      { status: isUpstreamTimeout ? 504 : 500 },
    );
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
