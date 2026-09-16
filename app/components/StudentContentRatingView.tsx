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

const RATING_LABELS = ["", "Not engaging", "Slightly engaging", "Moderately engaging", "Very engaging", "Extremely engaging"];

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

export default function StudentContentRatingView({ user, onProgress }: Props) {
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [media, setMedia] = useState<Record<string, SharedContentMedia>>({});
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [savedRatings, setSavedRatings] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const classId = user.classId;
  const assignmentId = user.assignmentId;

  const loadPublishedContent = useCallback(async (silent = false) => {
    if (!classId || !assignmentId) {
      if (!silent) {
        setLoading(false);
      }
      return;
    }

    if (!silent) {
      setLoading(true);
    }

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
      if (!silent) {
        setLoading(false);
      }
    }
  }, [assignmentId, classId]);

  const loadRatings = useCallback(async () => {
    if (!classId || !assignmentId) {
      return;
    }

    try {
      const ratingRes = await fetch(
        `/api/content-rating?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&studentId=${encodeURIComponent(user.userId)}`,
      );
      if (!ratingRes.ok) {
        return;
      }

      const ratingData = await ratingRes.json();
      const existing: Record<string, number> = {};
      for (const r of ratingData.ratings ?? []) {
        existing[r.content_item_id] = r.rating;
      }
      setRatings(existing);
      setSavedRatings(existing);
    } catch {
      // Rating history is best-effort and should not block content rendering.
    }
  }, [assignmentId, classId, user.userId]);

  useEffect(() => {
    void Promise.all([
      loadPublishedContent(),
      loadRatings(),
    ]);
  }, [loadPublishedContent, loadRatings]);

  useEffect(() => {
    if (loading) return;

    if (contentItems.length === 0) {
      onProgress?.({ kind: "not-available" });
      return;
    }

    const allRated = contentItems.every((item) => savedRatings[item.id] != null);
    onProgress?.(allRated ? { kind: "completed" } : { kind: "active" });
  }, [loading, contentItems, savedRatings, onProgress]);

  useEffect(() => {
    if (!classId || !assignmentId) {
      return;
    }

    const refreshContent = () => {
      void loadPublishedContent(true);
    };

    const intervalId = window.setInterval(refreshContent, 15000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshContent();
      }
    };

    window.addEventListener("focus", refreshContent);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshContent);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [assignmentId, classId, loadPublishedContent]);

  const submitRating = async (contentItemId: string, rating: number) => {
    if (!classId || !assignmentId) return;

    setRatings((prev) => ({ ...prev, [contentItemId]: rating }));
    setSavingId(contentItemId);

    try {
      const res = await fetch("/api/content-rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          assignmentId,
          studentId: user.userId,
          contentItemId,
          rating,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save rating.");
      }

      setSavedRatings((prev) => ({ ...prev, [contentItemId]: rating }));
    } catch {
      // Revert on failure
      setRatings((prev) => {
        const reverted = { ...prev };
        if (savedRatings[contentItemId] != null) {
          reverted[contentItemId] = savedRatings[contentItemId];
        } else {
          delete reverted[contentItemId];
        }
        return reverted;
      });
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      </div>
    );
  }

  if (contentItems.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-lg font-semibold text-slate-700">No content available yet</p>
        <p className="mt-2 text-sm text-slate-500">
          Your teacher hasn&apos;t shared any content for rating yet. Check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Content Rating
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">
          Rate how engaging each piece of content is
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          1 = Not engaging, 5 = Extremely engaging
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {contentItems.map((item) => {
        const itemMedia = media[item.id];
        const currentRating = ratings[item.id];
        const isSaved = savedRatings[item.id] === currentRating;
        const isSaving = savingId === item.id;

        return (
          <div
            key={item.id}
            className="rounded-2xl border border-slate-200 bg-white p-6"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {/* Media */}
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

              {/* Text */}
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
                <p className="mt-3 text-base font-semibold text-slate-900">
                  {item.title}
                </p>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{item.body}</p>
              </div>
            </div>

            {/* Rating */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500">
                How engaging is this content?
              </p>
              <div className="mt-2 flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => submitRating(item.id, value)}
                    disabled={isSaving}
                    className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition ${
                      currentRating === value
                        ? "bg-[#BA0C2F] text-white"
                        : "border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                    title={RATING_LABELS[value]}
                  >
                    {value}
                  </button>
                ))}
                {currentRating && (
                  <span className="ml-2 text-xs text-slate-400">
                    {RATING_LABELS[currentRating]}
                    {isSaved && !isSaving && " (saved)"}
                    {isSaving && " (saving...)"}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
