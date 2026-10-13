import { NextRequest, NextResponse } from "next/server";
import { getMedia, upsertMedia } from "@/lib/nosql";
import { guardWorkspaceRequest, workspaceRequestUser } from "@/lib/workspace-access";
import { matchesMaterialVideoJob, validVideoRequestId, validVideoScopeId } from "@/lib/material-video-jobs";

export const maxDuration = 60; // Poll + return URL (no download in request)

const XAI_VIDEO_BASE = "https://api.x.ai/v1/videos";
const XAI_TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

export async function GET(request: NextRequest) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const xaiKey = process.env.GROK_API_KEY;
  if (!xaiKey) {
    return NextResponse.json(
      { error: "GROK_API_KEY is not set." },
      { status: 500 },
    );
  }

  const requestId = request.nextUrl.searchParams.get("requestId");
  const contentItemId = request.nextUrl.searchParams.get("contentItemId");
  const classId = request.nextUrl.searchParams.get("classId");
  const assignmentId = request.nextUrl.searchParams.get("assignmentId");
  const studentId = request.nextUrl.searchParams.get("studentId");

  if (!validVideoRequestId(requestId) || ![classId, assignmentId, studentId, contentItemId].every(validVideoScopeId)) {
    return NextResponse.json(
      { error: "Open the video request in its assigned class and material." },
      { status: 400 },
    );
  }

  try {
    const user = await workspaceRequestUser(request);
    if (user?.role !== "teacher" || !validVideoScopeId(user.geniusId)) return NextResponse.json({ error: "Teacher access required." }, { status: 403 });
    if (!await matchesMaterialVideoJob(requestId, { classId: classId!, assignmentId: assignmentId!, studentId: studentId!, contentItemId: contentItemId!, ownerId: user.geniusId })) {
      return NextResponse.json({ error: "This video request does not belong to this material, or it has expired. Generate the video again." },
        { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    const res = await fetch(`${XAI_VIDEO_BASE}/${requestId}`, {
      headers: {
        Authorization: `Bearer ${xaiKey}`,
      },
    });

    const rawBody = await res.text();
    let data: {
      status?: string;
      video?: { url?: string };
      error?: { message?: string };
    } = {};
    try {
      data = rawBody
        ? (JSON.parse(rawBody) as {
            status?: string;
            video?: { url?: string };
            error?: { message?: string };
          })
        : {};
    } catch {
      // Non-JSON response from upstream should not crash polling.
      data = {};
    }

    if (!res.ok) {
      if (XAI_TRANSIENT_STATUSES.has(res.status)) {
        return NextResponse.json({
          done: false,
          transient: true,
          upstreamStatus: res.status,
          ...(data?.error?.message ? { error: data.error.message } : {}),
        });
      }
      throw new Error(data?.error?.message ?? `x.ai poll failed: ${res.status}`);
    }

    if (data.status === "expired") {
      return NextResponse.json(
        { done: false, error: "Video request expired. Try again." },
        { status: 410 },
      );
    }
    // x.ai may return either:
    // 1) { status: "done", video: { url: ... } }
    // 2) { video: { url: ... }, model: ... } (no status field)
    const isDone = data.status === "done" || Boolean(data.video?.url);
    if (!isDone) {
      return NextResponse.json({ done: false });
    }

    const videoUrl = data.video?.url;
    if (!videoUrl) {
      return NextResponse.json(
        { error: "Video generation completed but returned no URL." },
        { status: 500 },
      );
    }

    let savedToDb = false;
    let saveError: string | null = null;
    let responseUrl = videoUrl;

    // Persist video to S3/DB before responding — must be awaited because
    // serverless Lambdas freeze after the response is sent.
    if (contentItemId && classId && assignmentId && studentId) {
      try {
        const videoRes = await fetch(videoUrl);
        if (!videoRes.ok) {
          throw new Error(`Video download failed (${videoRes.status}).`);
        }
        const contentType = videoRes.headers.get("content-type") ?? "";
        if (!contentType.includes("video/")) {
          throw new Error(
            `Unexpected video content-type: ${contentType || "unknown"}.`,
          );
        }
        const buf = await videoRes.arrayBuffer();
        const base64 = Buffer.from(buf).toString("base64");
        const dataUrl = `data:video/mp4;base64,${base64}`;
        await upsertMedia({
          classId,
          assignmentId,
          studentId,
          contentItemId,
          mediaType: "video",
          mimeType: "video/mp4",
          dataUrl,
        });
        const persisted = await getMedia(
          classId,
          assignmentId,
          studentId,
          contentItemId,
          "video",
        );
        savedToDb = Boolean(persisted);
        if (persisted?.data_url) {
          responseUrl = persisted.data_url;
        }
        if (!savedToDb) {
          saveError = "Video save did not persist to the media store.";
          console.error("Video persist failed:", saveError);
        }
      } catch (err) {
        saveError = err instanceof Error ? err.message : "Video persist failed.";
        console.error("Video persist failed:", err);
      }
    } else {
      saveError =
        "Missing one or more identifiers (contentItemId/classId/assignmentId/studentId), so video was not saved.";
      console.warn("Video persist skipped:", saveError);
    }

    return NextResponse.json({
      done: true,
      url: responseUrl,
      contentItemId,
      savedToDb,
      ...(saveError ? { saveError } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to check video status.";
    console.error("engagement-video/status error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
