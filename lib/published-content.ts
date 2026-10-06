import type { ContentItem, TextMode } from "@/lib/types";
import { parseMaterialActivity } from "@/lib/material-activities";

export type SharedContentMedia = {
  image?: string;
  video?: string;
};

export type PublishedItemResponse = {
  content_item_id: string;
  content_json: string;
  media?: SharedContentMedia;
};

export type MediaRecordResponse = {
  content_item_id?: string;
  media_type?: "image" | "video";
  data_url?: string;
};

const TEXT_MODES: readonly TextMode[] = [
  "questions",
  "phenomenon",
  "dialogue",
];

const isTextMode = (value: unknown): value is TextMode =>
  typeof value === "string" &&
  (TEXT_MODES as readonly string[]).includes(value);

const normalizeMediaUrl = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeSharedMedia = (value: unknown): SharedContentMedia | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const media = value as {
    image?: unknown;
    video?: unknown;
  };
  const image = normalizeMediaUrl(media.image);
  const video = normalizeMediaUrl(media.video);

  if (!image && !video) {
    return undefined;
  }

  return {
    ...(image ? { image } : {}),
    ...(video ? { video } : {}),
  };
};

const fallbackContentItem = (id: string): ContentItem => ({
  id,
  type: "unknown",
  title: "Content",
  body: "",
  strategy: "",
});

type ParsedContentItem = Partial<ContentItem> & {
  media?: SharedContentMedia;
};

const parsePublishedContentItem = (item: PublishedItemResponse) => {
  const fallback = fallbackContentItem(item.content_item_id);

  try {
    const parsed = JSON.parse(item.content_json) as ParsedContentItem;
    const type =
      typeof parsed.type === "string" && parsed.type.trim()
        ? parsed.type
        : fallback.type;
    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title
        : fallback.title;
    const body =
      typeof parsed.body === "string" ? parsed.body : fallback.body;
    const strategy =
      typeof parsed.strategy === "string"
        ? parsed.strategy
        : fallback.strategy;
    const textModes = Array.isArray(parsed.textModes)
      ? parsed.textModes.filter(isTextMode)
      : [];
    const visualBrief =
      typeof parsed.visualBrief === "string" && parsed.visualBrief.trim()
        ? parsed.visualBrief
        : undefined;
    const activity = parseMaterialActivity(parsed.activity, strategy);

    return {
      contentItem: {
        id: item.content_item_id,
        type,
        title,
        body,
        strategy,
        ...(textModes.length > 0 ? { textModes } : {}),
        ...(visualBrief ? { visualBrief } : {}),
        ...(activity ? { activity } : {}),
      } satisfies ContentItem,
      embeddedMedia: normalizeSharedMedia(parsed.media),
    };
  } catch {
    return { contentItem: fallback, embeddedMedia: undefined };
  }
};

const buildDirectMediaMap = (
  mediaRecords: MediaRecordResponse[],
): Record<string, SharedContentMedia> =>
  mediaRecords.reduce<Record<string, SharedContentMedia>>((accumulator, record) => {
    const contentItemId = record.content_item_id;
    const mediaUrl = normalizeMediaUrl(record.data_url);

    if (!contentItemId || !mediaUrl) {
      return accumulator;
    }

    if (!accumulator[contentItemId]) {
      accumulator[contentItemId] = {};
    }

    if (record.media_type === "image") {
      accumulator[contentItemId].image = mediaUrl;
    }

    if (record.media_type === "video") {
      accumulator[contentItemId].video = mediaUrl;
    }

    return accumulator;
  }, {});

export const buildPublishedContentState = (
  items: PublishedItemResponse[],
  mediaRecords: MediaRecordResponse[],
) => {
  const directMediaByItemId = buildDirectMediaMap(mediaRecords);

  const entries = items.map((item) => {
    const { contentItem, embeddedMedia } = parsePublishedContentItem(item);
    const mergedMedia = {
      ...(embeddedMedia ?? {}),
      ...(normalizeSharedMedia(item.media) ?? {}),
      ...(directMediaByItemId[item.content_item_id] ?? {}),
    };

    return {
      contentItem,
      media:
        Object.keys(mergedMedia).length > 0 ? mergedMedia : undefined,
    };
  });

  return {
    contentItems: entries.map((entry) => entry.contentItem),
    mediaByItemId: entries.reduce<Record<string, SharedContentMedia>>(
      (accumulator, entry) => {
        if (entry.media) {
          accumulator[entry.contentItem.id] = entry.media;
        }
        return accumulator;
      },
      {},
    ),
  };
};
