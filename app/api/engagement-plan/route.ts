import OpenAI from "openai";
import { NextResponse } from "next/server";

import { getCachedPlanJson, upsertCachedPlanJson } from "@/lib/nosql";
import {
  deserializeCachedPlan,
  serializeCachedPlan,
} from "@/lib/strategy-plan-cache";

type Answers = Record<string, string | undefined>;

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

const buildPrompt = (
  answers: Answers,
  studentName?: string,
  assignment?: string,
  cohortDistribution?: Record<string, number>,
  cohortStudents?: Array<{
    id: string;
    name: string;
    assignment?: string;
    answers: Answers;
  }>,
) => ({
  system: `You are an education engagement planner.
The plan will be used by teachers to engage students at the beginning of class.
Return JSON only with keys: name, strategy, relevance, overallRecommendation, recommendationReason, summary, tldr, rationale, tactics, cadence, checks.
The strategy must be exactly one of: cognitive conflict, analogy, experience bridging, engaged critiquing.
The relevance field is an object with those four strategies as keys and integer scores from 0-100.
Keep it concise and aligned to the student profile.
For recommendationReason and rationale, be specific: mention the student by name, mention the assignment/topic, and cite 2+ concrete details from the student's answers that justify the strategy.`,
  user: `Questionnaire answers:
${JSON.stringify(answers, null, 2)}

Student name: ${studentName ?? "Unknown"}
Assignment: ${assignment ?? "Not provided"}

${cohortDistribution ? `Cohort strategy distribution:\n${JSON.stringify(cohortDistribution, null, 2)}\n\n` : ""}${cohortStudents ? `Cohort student answers:\n${JSON.stringify(cohortStudents, null, 2)}\n\n` : ""}Return a plan:
- name: short label
- strategy: one of [cognitive conflict, analogy, experience bridging, engaged critiquing]
- relevance: scores 0-100 for each strategy
- overallRecommendation: 1-2 sentences, teacher-facing
- recommendationReason: 2-3 sentences; include the student's name, assignment/topic, and 2+ specific details from their answers that justify the strategy
- summary: 1 sentence
- tldr: 8-14 words, teacher-facing
- rationale: 3-5 sentences; name the student, reference the assignment/topic, and give at least one concrete in-class example of how the recommendation would look (what the teacher says/does)
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
    plan.recommendationReason = plan.rationale || "Aligned to student needs.";
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
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const {
      answers = {},
      studentName,
      studentId,
      assignment,
      classId,
      assignmentId,
      cohortDistribution,
      cohortStudents,
    } = (await request.json()) as {
      answers?: Answers;
      studentName?: string;
      studentId?: string;
      assignment?: string;
      classId?: string;
      assignmentId?: string;
      cohortDistribution?: Record<string, number>;
      cohortStudents?: Array<{
        id: string;
        name: string;
        assignment?: string;
        answers: Answers;
      }>;
    };

    const classKey = classId?.trim();
    const assignmentKey = assignmentId?.trim();
    const studentKey = studentId?.trim();

    /* ---- cache check ---- */
    if (classKey && assignmentKey && studentKey) {
      const cachedPlanJson = await getCachedPlanJson(
        classKey,
        assignmentKey,
        studentKey,
      );
      if (cachedPlanJson) {
        console.info(
          `engagement-plan cache HIT for ${classKey}/${assignmentKey}/${studentKey}`,
        );
        const cachedPlan = deserializeCachedPlan<Plan>(cachedPlanJson);
        if (cachedPlan) {
          cachedPlan.strategy = normalizeStrategy(cachedPlan.strategy);
          const plan = ensurePlanFields(cachedPlan);
          return NextResponse.json({ plan, cached: true });
        }
      }
    }

    /* ---- generate via LLM ---- */
    const model = process.env.OPENAI_MODEL ?? "gpt-5-nano";
    const prompt = buildPrompt(
      answers,
      studentName,
      assignment,
      cohortDistribution,
      cohortStudents,
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

    /* ---- persist to cache ---- */
    if (classKey && assignmentKey && studentKey) {
      await upsertCachedPlanJson(
        classKey,
        assignmentKey,
        studentKey,
        serializeCachedPlan(plan),
      );
      console.info(
        `engagement-plan cached for ${classKey}/${assignmentKey}/${studentKey}`,
      );
    }

    return NextResponse.json({ plan, cached: false });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create plan.";
    console.error("engagement-plan error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
