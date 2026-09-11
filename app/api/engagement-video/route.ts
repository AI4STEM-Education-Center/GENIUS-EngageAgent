import { NextResponse } from "next/server";

type ContentItem = {
  id: string;
  type: string;
  subject?: string;
  title: string;
  body: string;
  textModes?: string[];
  visualBrief?: string;
};

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
    const { item, imageUrl } = (await request.json()) as {
      item: ContentItem;
      imageUrl: string;
    };

    if (!imageUrl) {
      return NextResponse.json(
        { error: "imageUrl is required. Generate the image first." },
        { status: 400 },
      );
    }

    const animationPrompt = buildAnimationPrompt();

    const res = await fetch(`${XAI_VIDEO_BASE}/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${xaiKey}`,
      },
      body: JSON.stringify({
        model: "grok-imagine-video",
        prompt: animationPrompt,
        image: { url: imageUrl },
        duration: 4,
        aspect_ratio: "1:1",
        resolution: "480p",
      }),
    });

    const data = (await res.json()) as {
      request_id?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(data?.error?.message ?? `x.ai API error: ${res.status}`);
    }
    if (!data.request_id) {
      throw new Error("x.ai did not return a request_id.");
    }

    return NextResponse.json({
      requestId: data.request_id,
      done: false,
      contentItemId: item.id,
    });
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
