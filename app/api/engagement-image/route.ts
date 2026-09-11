import OpenAI, { toFile } from "openai";
import { NextResponse } from "next/server";

import {
  getLessonGenerationContext,
  getStrategyContext,
} from "@/lib/lesson-context";
import { getMedia, upsertMedia } from "@/lib/nosql";

type ContentItem = {
  id?: string;
  type: string;
  strategy: string;
  title: string;
  body: string;
  textModes?: string[];
  visualBrief?: string;
};

const buildPrompt = (item: ContentItem, lessonNumber: number) => {
  const lessonContext = getLessonGenerationContext(lessonNumber);
  if (!lessonContext) {
    throw new Error(`Lesson ${lessonNumber} not found.`);
  }

  const strategyContext = getStrategyContext(item.strategy);
  const gradeLevel = "8th grade";
  const textModes = item.textModes?.length ? item.textModes.join(", ") : item.type;
  const visualBrief = item.visualBrief?.trim();

  return `Create a simple, student-friendly illustration for a ${gradeLevel} lesson.
This image will be shown directly to students next to the material below.
Lesson: ${lessonContext.lessonTitle}
Learning objective: ${lessonContext.learningObjective}
Strategy: ${strategyContext.label} - ${strategyContext.description}
Text style: ${textModes}
Title: ${item.title}
Student-facing text:
${item.body}
${visualBrief ? `Visual brief: ${visualBrief}` : "Visual brief: Show the main scene, phenomenon, or conversation implied by the text."}

Ensure the image supports the lesson objective through the scene students will analyze.
If the material includes dialogue, clearly show the speakers and what they are reacting to.
If the material includes questions, show the scene students should reason about.
If the material describes a phenomenon, make that phenomenon visually central.
Style: clean, minimal, classroom-friendly.
Hard requirement: the image must contain zero text of any kind.
Do not render words, letters, numbers, equations, symbols, speech bubbles with text, captions, labels, posters, signs, UI text, or watermarks.`;
};

const MAX_REFINEMENT_PROMPT_LENGTH = 500;

const isSafetyRejection = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("safety") || msg.includes("content_policy") || msg.includes("policy") || msg.includes("moderation");
};

const prepareImageInput = async (imageUrl: string) => {
  if (imageUrl.startsWith("data:")) {
    const base64Part = imageUrl.split(",")[1];
    const buffer = Buffer.from(base64Part, "base64");
    return toFile(buffer, "image.webp", { type: "image/webp" });
  }
  const imgRes = await fetch(imageUrl);
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  return toFile(imgBuffer, "image.webp", { type: "image/webp" });
};

const VLM_SYSTEM_PROMPT = `You are an image-editing assistant. You receive an image with a RED RECTANGLE drawn on it, plus a short user instruction.

Your job:
1. Identify what is inside the red rectangle.
2. Combine your understanding of the selected region with the user's instruction.
3. Output a single, detailed image-editing prompt (1-3 sentences) that tells an image generation model EXACTLY what to change and where, using natural language spatial descriptions (e.g., "in the upper-left corner", "the figure on the right side").
4. The prompt must describe the edit for the clean image (no red rectangle). Do NOT mention the red rectangle or annotations.
5. Emphasize that the rest of the image must remain unchanged.
6. The resulting prompt must maintain the instruction: the image must contain zero text of any kind.

Respond with ONLY the editing prompt, nothing else.`;

const generateVlmEditPrompt = async (
  client: OpenAI,
  annotatedImageUrl: string,
  userPrompt: string,
): Promise<string> => {
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_VLM_MODEL ?? "gpt-4o",
    max_tokens: 300,
    messages: [
      { role: "system", content: VLM_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `User instruction: ${userPrompt}` },
          { type: "image_url", image_url: { url: annotatedImageUrl, detail: "high" } },
        ],
      },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? userPrompt;
};

export const maxDuration = 120;

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
      item,
      lessonNumber,
      classId,
      assignmentId,
      studentId,
      refinementPrompt,
      previousImageUrl,
      annotatedImageUrl,
    } = (await request.json()) as {
      item: ContentItem;
      lessonNumber?: number;
      classId?: string;
      assignmentId?: string;
      studentId?: string;
      refinementPrompt?: string;
      previousImageUrl?: string;
      annotatedImageUrl?: string;
    };

    const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
    const trimmedRefine = refinementPrompt?.trim().slice(0, MAX_REFINEMENT_PROMPT_LENGTH);
    const isRefine = !!(trimmedRefine && previousImageUrl);

    if (!isRefine && typeof lessonNumber !== "number") {
      return NextResponse.json(
        { error: "lessonNumber is required." },
        { status: 400 },
      );
    }

    let result;
    if (isRefine) {
      const [editPrompt, imageInput] = await Promise.all([
        annotatedImageUrl
          ? generateVlmEditPrompt(client, annotatedImageUrl, trimmedRefine)
          : Promise.resolve(trimmedRefine),
        prepareImageInput(previousImageUrl),
      ]);

      result = await client.images.edit({
        model,
        image: imageInput,
        prompt: editPrompt,
        size: "1024x1024",
        quality: "low",
        output_format: "webp",
      });
    } else {
      const prompt = buildPrompt(item, lessonNumber as number);
      result = await client.images.generate({
        model,
        prompt,
        size: "1024x1024",
        quality: "low",
        output_format: "webp",
      });
    }

    const data = result.data?.[0];
    const base64 = data?.b64_json;
    const url = data?.url;
    if (!base64 && !url) {
      throw new Error("Image generation returned empty data.");
    }

    let dataUrl = base64 ? `data:image/webp;base64,${base64}` : (url ?? "");

    // Persist to DB if we have enough context
    if (item.id && classId && assignmentId && studentId) {
      try {
        await upsertMedia({
          classId,
          assignmentId,
          studentId,
          contentItemId: item.id,
          mediaType: "image",
          mimeType: "image/webp",
          dataUrl,
          refinementPrompt: trimmedRefine,
        });
        // Prefer a shareable URL (e.g., presigned S3) for downstream video APIs.
        const persisted = await getMedia(
          classId,
          assignmentId,
          studentId,
          item.id,
          "image",
        );
        if (persisted?.data_url) {
          dataUrl = persisted.data_url;
        }
      } catch (err) {
        console.error("Failed to persist image to DB:", err);
        // Don't fail the response — return the image anyway
      }
    }

    return NextResponse.json({ url: dataUrl });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate image.";
    const isSafety = isSafetyRejection(error);
    console.error("engagement-image error:", message);
    return NextResponse.json({
      error: isSafety
        ? "Your refinement instruction was flagged by content policy. Please rephrase and try again."
        : message,
    }, { status: isSafety ? 422 : 500 });
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
