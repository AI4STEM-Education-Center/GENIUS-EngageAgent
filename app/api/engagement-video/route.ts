import { createHash } from "node:crypto";
import { recordGeneration } from "@/lib/generation-record-server";
import { NextResponse } from "next/server";
import type { ContentItem } from "@/lib/types";
import { buildMaterialVideoInstructions } from "@/lib/material-video";
import { MATERIAL_STRATEGIES } from "@/lib/material-activities";
import { saveMaterialVideoJob, validVideoRequestId, validVideoScopeId } from "@/lib/material-video-jobs";
import { workspaceRequestUser } from "@/lib/workspace-access";

const XAI_VIDEO_BASE = "https://api.x.ai/v1/videos";

function buildAnimationPrompt(): string {
  return `Animate this student-facing still image with natural motion only.
Keep the same scene, style, and subjects.

Focus on subtle movement (camera drift, object motion, gestures, lighting/parallax), cinematic and smooth.
Continue the scene as it would unfold in the real world, with physically plausible actions and timing.
If people are present, allow subtle expressions or turn-taking that fit the scene.
Show a complete micro-sequence with a clear beginning, middle, and natural ending within the clip.
Hard requirement: no text anywhere in the video.
Do not add words, letters, numbers, symbols, subtitles, captions, logos, signs, labels, or watermarks.
Do not add narration or lesson explanation.
`;
}

export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const xaiKey = process.env.GROK_API_KEY;
  if (!xaiKey) {
    return NextResponse.json(
      { error: "GROK_API_KEY is not set." },
      { status: 500 },
    );
  }

  try {
    const { item, imageUrl, classId, assignmentId, studentId } = (await request.json()) as {
      item: ContentItem;
      imageUrl: string;
      classId: string;
      assignmentId: string;
      studentId: string;
    };
    const user = await workspaceRequestUser(request);
    if (user?.role !== "teacher" || !validVideoScopeId(user.geniusId)) return NextResponse.json({ error: "Teacher access required." }, { status: 403 });
    if (![classId, assignmentId, studentId].every(validVideoScopeId)) return NextResponse.json({ error: "Open the material in its assigned class before generating a video." }, { status: 400 });

    if (typeof imageUrl !== "string" || !imageUrl.trim()) {
      return NextResponse.json(
        { error: "imageUrl is required. Generate the image first." },
        { status: 400 },
      );
    }
    if (!item || typeof item !== "object" || !validVideoScopeId(item.id)) {
      return NextResponse.json({ error: "A content item is required." }, { status: 400 });
    }
    const instructions = buildMaterialVideoInstructions(item);
    if (item.activity !== undefined && MATERIAL_STRATEGIES.includes(item.strategy) && !instructions) {
      return NextResponse.json({ error: "The activity does not meet its stage and media requirements." }, { status: 400 });
    }

    const animationPrompt = instructions || buildAnimationPrompt();
    // In image-to-video, xAI pins the source as frame zero and inherits its size.
    // A staged analogy needs both depicted subjects available without opening on both.
    const stagedAnalogy = item.strategy === "analogy" && item.activity !== undefined;
    const visualInput = stagedAnalogy
      ? { reference_images: [{ url: imageUrl }] }
      : { image: { url: imageUrl } };
    const output = { duration: 4, resolution: "480p", ...(stagedAnalogy ? { aspect_ratio: "16:9" } : {}) };

    const generation = typeof item.lessonNumber === "number" ? await recordGeneration({ userId: user.geniusId, classId, assignmentId }, { lessonNumber: item.lessonNumber, strategy: item.strategy, format: "video", operation: "video", model: "grok-imagine-video", prompt: { system: "", user: animationPrompt }, settings: item.teachingContext, parentId: item.generation?.id,
      parameters: { contentItemId: item.id, ...output, aspect_ratio: output.aspect_ratio ?? "From source image",
        inputMode: stagedAnalogy ? "reference-to-video" : "image-to-video", referenceSha256: createHash("sha256").update(imageUrl).digest("hex") } }) : undefined;

    const res = await fetch(`${XAI_VIDEO_BASE}/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${xaiKey}`,
      },
      body: JSON.stringify({
        model: "grok-imagine-video",
        prompt: animationPrompt,
        ...visualInput,
        ...output,
      }),
    });

    const data = (await res.json()) as {
      request_id?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(data?.error?.message ?? `x.ai API error: ${res.status}`);
    }
    if (!validVideoRequestId(data.request_id)) {
      throw new Error("x.ai did not return a request_id.");
    }
    await saveMaterialVideoJob(data.request_id, { classId, assignmentId, studentId, contentItemId: item.id, ownerId: user.geniusId }, generation);

    return NextResponse.json({
      requestId: data.request_id,
      done: false,
      contentItemId: item.id,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start video generation.";
    console.error("engagement-video error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
