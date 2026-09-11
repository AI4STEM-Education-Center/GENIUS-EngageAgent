import { NextResponse } from "next/server";
import { upsertContentPublish, listMedia, listPublishedContent } from "@/lib/nosql";

type SharedContentMedia = {
  image?: string;
  video?: string;
};

const MAX_EMBEDDED_MEDIA_URL_LENGTH = 16_384;

const normalizeEmbeddableMediaUrl = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  if (!value || value.startsWith("data:")) return undefined;
  if (value.length > MAX_EMBEDDED_MEDIA_URL_LENGTH) return undefined;
  return value;
};

const sanitizePublishedItem = (item: Record<string, unknown>) => {
  const sanitizedMedia = {
    ...(normalizeEmbeddableMediaUrl((item.media as { image?: unknown } | undefined)?.image)
      ? { image: normalizeEmbeddableMediaUrl((item.media as { image?: unknown } | undefined)?.image) }
      : {}),
    ...(normalizeEmbeddableMediaUrl((item.media as { video?: unknown } | undefined)?.video)
      ? { video: normalizeEmbeddableMediaUrl((item.media as { video?: unknown } | undefined)?.video) }
      : {}),
  };

  const { media: _media, ...rest } = item;
  return {
    ...rest,
    ...(Object.keys(sanitizedMedia).length > 0 ? { media: sanitizedMedia } : {}),
  };
};

const extractEmbeddedMedia = (contentJson: string): SharedContentMedia | undefined => {
  try {
    const parsed = JSON.parse(contentJson) as { media?: { image?: unknown; video?: unknown } };
    const embeddedMedia = parsed?.media;
    if (!embeddedMedia || typeof embeddedMedia !== "object") {
      return undefined;
    }

    const normalized = {
      ...(typeof embeddedMedia.image === "string" && embeddedMedia.image
        ? { image: embeddedMedia.image }
        : {}),
      ...(typeof embeddedMedia.video === "string" && embeddedMedia.video
        ? { video: embeddedMedia.video }
        : {}),
    };

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  } catch {
    return undefined;
  }
};

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("classId");
  const assignmentId = searchParams.get("assignmentId");

  if (!classId || !assignmentId) {
    return NextResponse.json(
      { error: "classId and assignmentId are required." },
      { status: 400 },
    );
  }

  const [items, mediaRecords] = await Promise.all([
    listPublishedContent(classId, assignmentId),
    listMedia(classId, assignmentId, "cohort"),
  ]);

  const mediaByItem = mediaRecords.reduce<Record<string, { image?: string; video?: string }>>((accumulator, record) => {
    if (!record.content_item_id || !record.data_url) {
      return accumulator;
    }

    if (!accumulator[record.content_item_id]) {
      accumulator[record.content_item_id] = {};
    }

    if (record.media_type === "image") {
      accumulator[record.content_item_id].image = record.data_url;
    }

    if (record.media_type === "video") {
      accumulator[record.content_item_id].video = record.data_url;
    }

    return accumulator;
  }, {});

  return NextResponse.json({
    items: items.map((item) => {
      const embeddedMedia = extractEmbeddedMedia(item.content_json);
      const mergedMedia = {
        ...(embeddedMedia ?? {}),
        ...(mediaByItem[item.content_item_id] ?? {}),
      };

      return {
        ...item,
        ...(Object.keys(mergedMedia).length > 0 ? { media: mergedMedia } : {}),
      };
    }),
  });
}

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const body = await request.json();
  const { classId, assignmentId, contentItems, publishedBy } = body;

  if (!classId || !assignmentId || !Array.isArray(contentItems) || contentItems.length === 0) {
    return NextResponse.json(
      { error: "classId, assignmentId, and contentItems array are required." },
      { status: 400 },
    );
  }

  const publishedAt = new Date().toISOString();
  const results = [];

  for (const item of contentItems) {
    if (!item || typeof item !== "object" || !("id" in item) || !item.id) continue;
    const sanitizedItem = sanitizePublishedItem(item as Record<string, unknown>);
    const record = await upsertContentPublish({
      class_id: classId,
      assignment_id: assignmentId,
      content_item_id: String(item.id),
      content_json: JSON.stringify(sanitizedItem),
      published: true,
      published_at: publishedAt,
      published_by: publishedBy ?? "unknown",
    });
    results.push(record);
  }

  return NextResponse.json({ published: results }, { status: 201 });
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
