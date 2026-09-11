import OpenAI from "openai";
import { NextResponse } from "next/server";

import {
  getLessonGenerationContext,
  getStrategyContext,
  type LessonGenerationContext,
  type StrategyContext,
} from "@/lib/lesson-context";
import type { ContentItem, TextMode } from "@/lib/types";

type GeneratedContentItem = Pick<
  ContentItem,
  "type" | "title" | "body" | "textModes" | "visualBrief"
>;

type GeneratedResponseItem = Omit<ContentItem, "id">;

const ALLOWED_TEXT_MODES = [
  "questions",
  "phenomenon",
  "dialogue",
] as const satisfies readonly TextMode[];

const isTextMode = (value: string): value is TextMode =>
  (ALLOWED_TEXT_MODES as readonly string[]).includes(value);

const normalizeTextModes = (value: unknown): TextMode[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((mode): mode is string => typeof mode === "string")
    .map((mode) => mode.trim().toLowerCase())
    .filter(isTextMode);
};

const buildPrompt = (
  lessonContext: LessonGenerationContext,
  strategyContext: StrategyContext,
) => ({
  system: `You are an education content designer creating short, student-facing science materials.
Return JSON only with key: items (array).
Return exactly 1 item in the array.
Each item must include:
- type: a short label such as "Questions", "Phenomenon", "Dialogue", or a short combination label
- title: a concise, student-facing title
- body: the exact text students will read directly
- textModes: an array using only "questions", "phenomenon", and/or "dialogue"
- visualBrief: one short sentence describing what the illustration should show
Do not include teacher directions, facilitation notes, or implementation instructions.`,
  user: `Lesson:
- Title: ${lessonContext.lessonTitle}
- Learning objective: ${lessonContext.learningObjective}

Engagement strategy:
- Name: ${strategyContext.label}
- Description: ${strategyContext.description}

Create exactly 1 student-facing content item aligned to the lesson objective and strategy.
The text can use one or a combination of:
(a) questions,
(b) a short description of a phenomenon, or
(c) a dialogue between two virtual students or between a teacher and a student.

Requirements:
- This will be shared directly with students, so write to students instead of to teachers.
- Make the objective visible in the thinking students are asked to do; do not drift into a generic physics scene.
- Avoid phrases such as "ask students", "have students", "teacher note", or lesson-delivery instructions.
- Keep it concrete, vivid, and age-appropriate for middle-school physics learners.
- The image must clearly reflect the scene or interaction described in the text.
- Keep the body concise, around 70-140 words, with line breaks if helpful.
- Do not mention the engagement strategy by name to students.

Return exactly 1 item in items.`,
});

const parseJson = (value: string | null | undefined) => {
  if (!value) {
    throw new Error("LLM returned empty response.");
  }
  return JSON.parse(value) as {
    items: GeneratedContentItem[];
  };
};

export const maxDuration = 60;

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
      lessonNumber,
      selectedStrategies = [],
      fallback = false,
    } = (await request.json()) as {
      lessonNumber?: number;
      selectedStrategies?: string[];
      fallback?: boolean;
    };
    if (typeof lessonNumber !== "number") {
      return NextResponse.json(
        { error: "lessonNumber is required." },
        { status: 400 },
      );
    }

    const lessonContext = getLessonGenerationContext(lessonNumber);
    if (!lessonContext) {
      return NextResponse.json(
        { error: `Lesson ${lessonNumber} not found.` },
        { status: 400 },
      );
    }

    // Two-tier model: primary (gpt-5-mini, higher quality but slower) runs by
    // default. If the frontend's first attempt fails or times out on the
    // Amplify 29s cap, it retries the same request with `fallback: true`,
    // which swaps to gpt-4o-mini (p95 ~3s). Keeps the retry client-driven
    // so the two attempts live in two separate HTTP requests — a single
    // attempt that exceeds 29s has no way to deliver the fallback result
    // back to the browser.
    const primaryModel = process.env.OPENAI_MODEL ?? "gpt-5-mini";
    const fallbackModel = process.env.OPENAI_FALLBACK_MODEL ?? "gpt-4o-mini";
    const model = fallback ? fallbackModel : primaryModel;
    if (fallback) {
      console.log(`[engagement-content] fallback=true; using ${fallbackModel}`);
    }
    const strategies = selectedStrategies.filter(Boolean);
    if (strategies.length === 0) {
      return NextResponse.json(
        { error: "selectedStrategies must contain at least one strategy." },
        { status: 400 },
      );
    }
    const items: GeneratedResponseItem[] = [];

    const strategyResults = await Promise.all(
      strategies.map(async (strategy) => {
        const prompt = buildPrompt(lessonContext, getStrategyContext(strategy));
        const completion = await client.chat.completions.create({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        });

        const data = parseJson(completion.choices[0]?.message?.content);
        return (data.items ?? []).slice(0, 1).map((item) => {
          const textModes = normalizeTextModes(item.textModes);
          const title = item.title?.trim() || `${strategy} activity`;
          const body = item.body?.trim();

          if (!body) {
            throw new Error("Generated content body was empty.");
          }

          return {
            type: item.type?.trim() || (textModes.length > 0 ? textModes.join(" + ") : "Student material"),
            title,
            body,
            strategy,
            ...(textModes.length > 0 ? { textModes } : {}),
            ...(item.visualBrief?.trim() ? { visualBrief: item.visualBrief.trim() } : {}),
          } satisfies GeneratedResponseItem;
        });
      }),
    );

    for (const taggedItems of strategyResults) {
      items.push(...taggedItems);
    }

    return NextResponse.json({ items });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate content.";
    console.error("engagement-content error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
