"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserContext } from "@/lib/auth";
import type { ContentItem, TextMode } from "@/lib/types";
import type { StepProgress } from "@/lib/student-progress";
import {
  buildPublishedContentState,
  type MediaRecordResponse,
  type PublishedItemResponse,
  type SharedContentMedia,
} from "@/lib/published-content";

type Props = {
  user: UserContext;
  onProgress?: (progress: StepProgress) => void;
};

const TEXT_MODE_LABELS: Record<TextMode, string> = {
  questions: "Questions",
  phenomenon: "Phenomenon",
  dialogue: "Dialogue",
};

const getContentModeLabels = (item: ContentItem) => {
  if (item.textModes && item.textModes.length > 0) {
    return item.textModes.map((mode) => TEXT_MODE_LABELS[mode] ?? mode);
  }

  return item.type ? [item.type] : [];
};

export default function StudentContentReviewView({ user, onProgress }: Props) {
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [media, setMedia] = useState<Record<string, SharedContentMedia>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const classId = user.classId;
  const assignmentId = user.assignmentId;

  const loadPublishedContent = useCallback(async () => {
    if (!classId || !assignmentId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [pubRes, mediaRes] = await Promise.all([
        fetch(
          `/api/content-publish?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`,
        ),
        fetch(
          `/api/media?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&studentId=cohort`,
        ),
      ]);

      if (!pubRes.ok) {
        throw new Error("Failed to load content.");
      }

      const pubData = (await pubRes.json()) as { items?: PublishedItemResponse[] };
      const mediaData = mediaRes.ok
        ? ((await mediaRes.json()) as { results?: MediaRecordResponse[] })
        : { results: [] };
      const publishedState = buildPublishedContentState(
        pubData.items ?? [],
        mediaData.results ?? [],
      );

      setContentItems(publishedState.contentItems);
      setMedia(publishedState.mediaByItemId);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load content.");
    } finally {
      setLoading(false);
    }
  }, [assignmentId, classId]);

  useEffect(() => {
    void loadPublishedContent();
  }, [loadPublishedContent]);

  // Content is considered "reviewed" as soon as it's published. This is a
  // placeholder rule pending a team decision on real review tracking — see
  // issue #82.
  useEffect(() => {
    if (loading) return;
    onProgress?.(contentItems.length > 0 ? { kind: "completed" } : { kind: "active" });
  }, [loading, contentItems.length, onProgress]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
        <p className="text-lg font-semibold text-rose-700">Unable to load content</p>
        <p className="mt-2 text-sm text-rose-600">{error}</p>
      </div>
    );
  }

  if (contentItems.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#BA0C2F]/10 text-[#BA0C2F]">
          ⏳
        </div>
        <p className="mt-3 text-lg font-semibold text-slate-700">Waiting for your teacher</p>
        <p className="mt-2 text-sm text-slate-500">
          Your teacher is reviewing the assessment and preparing learning material for you.
          This step will update automatically once it&apos;s ready — you don&apos;t need to do
          anything right now.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Content Review
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">
          Review the learning material below
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Take a look before moving on to Content Rating.
        </p>
      </div>

      {contentItems.map((item) => {
        const itemMedia = media[item.id];

        return (
          <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {(itemMedia?.image || itemMedia?.video) && (
                <div className="flex shrink-0 gap-3">
                  {itemMedia.image && (
                    <img
                      src={itemMedia.image}
                      alt={item.title}
                      className="h-32 w-32 rounded-xl border border-slate-200 object-cover"
                    />
                  )}
                  {itemMedia.video && (
                    <video
                      src={itemMedia.video}
                      className="h-32 w-32 rounded-xl border border-slate-200 object-cover"
                      muted
                      playsInline
                      loop
                      autoPlay
                    />
                  )}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  {getContentModeLabels(item).map((label) => (
                    <span
                      key={`${item.id}-${label}`}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-base font-semibold text-slate-900">{item.title}</p>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{item.body}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
