"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Plus, RefreshCw, Presentation } from "lucide-react";
import { scopedClientAuthHeaders } from "@/lib/client-auth";
import MaterialActivityView from "./MaterialActivityView";
import PublishedSlidesReader from "./PublishedSlidesReader";
import type { UserContext } from "@/lib/auth";
import type { ContentItem, TextMode } from "@/lib/types";
import type { StepProgress } from "@/lib/student-progress";
import { stableContentMedia } from "@/lib/stable-media-urls";
import {
  buildPublishedContentState,
  type MediaRecordResponse,
  type PublishedItemResponse,
  type SharedContentMedia,
} from "@/lib/published-content";

type Props = {
  user: UserContext;
  onProgress?: (progress: StepProgress) => void;
  // Material Rating renders as its own card below "Your questions" (#110).
  // It's always visible, but stays locked until the server has marked
  // content-review complete (content-rating depends on it).
  ratingUnlocked?: boolean;
  onRatingProgress?: (progress: StepProgress) => void;
};

const cardStyle = "rounded-xl border border-line bg-white p-5 sm:p-[22px]";
const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-[9px] border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-45";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-[9px] border border-brand bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-45";

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

function ContentReview({
  user,
  onProgress,
  ratingUnlocked = false,
  onRatingProgress,
}: Props) {
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [media, setMedia] = useState<Record<string, SharedContentMedia>>({});
  // Keep refreshed capabilities available without changing a playing src.
  // Both refs belong to the keyed learner/class/task instance below.
  const latestMedia = useRef<Record<string, SharedContentMedia>>({});
  const failedVideoUrls = useRef(new Map<string, Set<string>>());
  const [loading, setLoading] = useState(true);
  const contentRequest = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const [submittedQuestions, setSubmittedQuestions] = useState<string[] | null>(null);
  const [draftQuestions, setDraftQuestions] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const questionsCard = useRef<HTMLDivElement>(null);
  const firstQuestion = useRef<HTMLTextAreaElement>(null);
  const focusQuestions = () => {
    const target = firstQuestion.current ?? questionsCard.current;
    target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    target?.focus();
  };

  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [savedRatings, setSavedRatings] = useState<Record<string, number>>({});
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

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
    const requestNumber = ++contentRequest.current;

    try {
      const [pubRes, mediaRes] = await Promise.all([
        fetch(
          `/api/content-publish?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`,
          { headers: scopedClientAuthHeaders({ classId, assignmentId }), cache: "no-store" },
        ),
        fetch(
          `/api/media?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&studentId=cohort`,
          { headers: scopedClientAuthHeaders({ classId, assignmentId }), cache: "no-store" },
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

      if (requestNumber !== contentRequest.current) return;
      latestMedia.current = publishedState.mediaByItemId;
      for (const id of failedVideoUrls.current.keys()) {
        if (!publishedState.mediaByItemId[id]?.video) failedVideoUrls.current.delete(id);
      }
      setContentItems(publishedState.contentItems);
      setMedia(current => {
        const next = stableContentMedia(current, publishedState.mediaByItemId);
        for (const [id, incoming] of Object.entries(publishedState.mediaByItemId)) {
          const failed = failedVideoUrls.current.get(id);
          const previous = current[id]?.video;
          if (!previous || !incoming.video || !failed?.size) continue;
          if (failed.has(incoming.video)) next[id].video = previous;
          else if (failed.has(previous)) next[id].video = incoming.video;
        }
        return next;
      });
      setError(null);
    } catch (err) {
      if (requestNumber === contentRequest.current) setError(err instanceof Error ? err.message : "Failed to load content.");
    } finally {
      if (requestNumber === contentRequest.current) setLoading(false);
    }
  }, [assignmentId, classId]);

  function recoverVideo(itemId: string, failedUrl: string) {
    if (!failedUrl) return;
    const failed = failedVideoUrls.current.get(itemId) ?? new Set<string>();
    if (failed.has(failedUrl)) return;
    failed.add(failedUrl);
    failedVideoUrls.current.set(itemId, failed);
    const replacement = latestMedia.current[itemId]?.video;
    if (!replacement || failed.has(replacement)) return;
    setMedia(current => current[itemId]?.video === failedUrl
      ? { ...current, [itemId]: { ...current[itemId], video: replacement } }
      : current);
    // If no new URL is available, the next normal poll replaces this failed
    // capability. Error events never launch requests or reload the same src.
  }

  const loadOwnQuestions = useCallback(async () => {
    if (!classId || !assignmentId) return;

    try {
      const res = await fetch(
        `/api/review-questions?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&studentId=${encodeURIComponent(user.userId)}`,
        { headers: scopedClientAuthHeaders({ classId, assignmentId }), cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { reviewQuestions?: { questions?: string[] }[] };
      const existing = data.reviewQuestions?.[0]?.questions;
      if (existing && existing.length > 0) {
        setSubmittedQuestions(existing);
      }
    } catch {
      // Best-effort — the write field below still works even if this fails.
    }
  }, [assignmentId, classId, user.userId]);

  const loadRatings = useCallback(async () => {
    if (!classId || !assignmentId) return;

    try {
      const res = await fetch(
        `/api/content-rating?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&studentId=${encodeURIComponent(user.userId)}`,
        { headers: scopedClientAuthHeaders({ classId, assignmentId }), cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { ratings?: { content_item_id: string; rating: number }[] };
      const existing: Record<string, number> = {};
      for (const r of data.ratings ?? []) {
        existing[r.content_item_id] = r.rating;
      }
      setRatings((current) => ({ ...current, ...existing }));
      setSavedRatings((current) => ({ ...current, ...existing }));
    } catch {
      // Rating history is best-effort and should not block content rendering.
    }
  }, [assignmentId, classId, user.userId]);

  useEffect(() => {
    void loadPublishedContent();
    void loadOwnQuestions();
    void loadRatings();
  }, [loadPublishedContent, loadOwnQuestions, loadRatings]);

  // Keep published content fresh so newly shared material shows up without
  // a reload (carried over from the former standalone Material Rating view).
  useEffect(() => {
    if (!classId || !assignmentId) return;

    const refreshContent = () => {
      void loadPublishedContent(true);
      void loadOwnQuestions();
      void loadRatings();
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
  }, [assignmentId, classId, loadPublishedContent, loadOwnQuestions, loadRatings]);

  // Reviewing this step is complete once the student has submitted at
  // least one question about the material (per team decision, 2026-09-18 —
  // supersedes the earlier "published = reviewed" placeholder from #82).
  // It only becomes available once the teacher has published content (#87)
  // — not merely because the assessment step is done.
  useEffect(() => {
    if (loading) return;
    if (contentItems.length === 0) {
      onProgress?.({ kind: "not-available" });
      return;
    }
    onProgress?.(
      submittedQuestions && submittedQuestions.length > 0
        ? { kind: "completed" }
        : { kind: "active" },
    );
  }, [loading, contentItems, submittedQuestions, onProgress]);

  useEffect(() => {
    if (loading || !ratingUnlocked) return;
    if (contentItems.length === 0) {
      onRatingProgress?.({ kind: "not-available" });
      return;
    }
    const allRated = contentItems.every((item) => savedRatings[item.id] != null);
    onRatingProgress?.(allRated ? { kind: "completed" } : { kind: "active" });
  }, [loading, ratingUnlocked, contentItems, savedRatings, onRatingProgress]);

  const updateDraftQuestion = (index: number, value: string) => {
    setDraftQuestions((prev) => prev.map((q, i) => (i === index ? value : q)));
  };

  const addDraftQuestion = () => {
    setDraftQuestions((prev) => [...prev, ""]);
  };

  const removeDraftQuestion = (index: number) => {
    setDraftQuestions((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const submitQuestions = async () => {
    if (!classId || !assignmentId) return;

    const cleaned = draftQuestions.map((q) => q.trim()).filter((q) => q.length > 0);
    if (cleaned.length === 0) {
      setSubmitError("Write at least one question before submitting.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/review-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...scopedClientAuthHeaders({ classId, assignmentId }) },
        body: JSON.stringify({
          classId,
          assignmentId,
          studentId: user.userId,
          questions: cleaned,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? "Failed to submit questions.");
      }

      setSubmittedQuestions(cleaned);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setSubmitting(false);
    }
  };

  // Clicking 1-5 only selects; nothing is saved until the student presses
  // Submit (#110). A material with a saved rating is locked, so only newly
  // published, still-unrated materials can be picked after submitting.
  const selectRating = (contentItemId: string, rating: number) => {
    if (!ratingUnlocked || savedRatings[contentItemId] != null || ratingSubmitting) return;
    setRatings((prev) => ({ ...prev, [contentItemId]: rating }));
  };

  const submitRatings = async () => {
    if (!classId || !assignmentId || !ratingUnlocked || ratingSubmitting) return;

    const pending = contentItems.filter((item) => savedRatings[item.id] == null);
    if (pending.some((item) => ratings[item.id] == null)) {
      setRatingError("Rate every material before submitting.");
      return;
    }

    setRatingSubmitting(true);
    setRatingError(null);

    const results = await Promise.all(
      pending.map(async (item) => {
        try {
          const res = await fetch("/api/content-rating", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...scopedClientAuthHeaders({ classId, assignmentId }) },
            body: JSON.stringify({
              classId,
              assignmentId,
              studentId: user.userId,
              contentItemId: item.id,
              rating: ratings[item.id],
            }),
          });
          return { id: item.id, ok: res.ok };
        } catch {
          return { id: item.id, ok: false };
        }
      }),
    );

    // Keep whatever did save, so a retry only resends the failed ones.
    setSavedRatings((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (r.ok) next[r.id] = ratings[r.id];
      }
      return next;
    });
    if (results.some((r) => !r.ok)) {
      setRatingError("Some ratings didn't save. Please try submitting again.");
    }
    setRatingSubmitting(false);
  };

  if (!classId || !assignmentId) {
    return <div className={`${cardStyle} text-center`} role="status">
      <h2 className="text-lg font-semibold text-ink">Open your class task</h2>
      <p className="mt-2 text-sm text-mute">Reopen this activity from your class in GENIUS to see its materials.</p>
    </div>;
  }

  if (loading && contentItems.length === 0) {
    return <div className={`${cardStyle} flex items-center justify-center gap-3 py-12 text-sm text-mute`} role="status">
      <LoaderCircle className="animate-spin" size={20} aria-hidden="true" />Loading materials…
    </div>;
  }

  if (error && contentItems.length === 0) {
    return <div className={`${cardStyle} text-center`}>
      <h2 className="text-lg font-semibold text-ink">Unable to load materials</h2>
      <p className="mt-2 text-sm text-bad" role="alert">{error}</p>
      <button type="button" className={`${secondaryButton} mt-4`} onClick={() => void loadPublishedContent()}>
        <RefreshCw size={16} aria-hidden="true" />Try again
      </button>
    </div>;
  }

  if (contentItems.length === 0) {
    return <div className={`${cardStyle} py-11 text-center`} role="status">
      <Presentation className="mx-auto text-mute" size={24} aria-hidden="true" />
      <h2 className="mt-3 text-lg font-semibold text-ink">Waiting for your teacher</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-mute">
        Your teacher is preparing learning materials. They will appear here when they are ready.
      </p>
    </div>;
  }

  const allRatingsSubmitted = contentItems.every((item) => savedRatings[item.id] != null);
  const allRatingsSelected = contentItems.every((item) => ratings[item.id] != null);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className={cardStyle}>
        <p className="text-[11.5px] font-bold uppercase tracking-[0.07em] text-faint">Explore and ask</p>
        <h2 className="mt-1 text-[23px] font-bold leading-tight tracking-[-0.015em] text-ink sm:text-[26px]">
          What do you notice? What do you wonder?
        </h2>
      </div>

      {error && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-warn-light p-4">
        <p className="flex-1 text-sm text-warn" role="alert">Materials could not refresh. You can keep reading and try again.</p>
        <button type="button" className={secondaryButton} onClick={() => void loadPublishedContent(true)}>
          <RefreshCw size={16} aria-hidden="true" />Try again
        </button>
      </div>}

      {contentItems.map((item) => {
        const itemMedia = media[item.id];
        return <article key={item.id} aria-label={item.title} className={`${cardStyle} ${item.slides ? "!p-4" : ""}`}>
          {item.slides ? (
            <PublishedSlidesReader classId={classId} assignmentId={assignmentId} publicationId={item.slides.publicationId} audience="student" learnerId={user.geniusId} onQuestion={focusQuestions} />
          ) : <>
            <div className="flex flex-wrap gap-2">
              {getContentModeLabels(item).map((label) => <span key={`${item.id}-${label}`} className="rounded-full bg-line-2 px-2 py-0.5 text-xs font-semibold text-ink-2">{label}</span>)}
            </div>
            <h3 className="mt-2 text-lg font-semibold text-ink">{item.title}</h3>
            {item.activity ? <MaterialActivityView activity={item.activity} media={itemMedia} questionInput={false}
              onVideoError={url => recoverVideo(item.id, url)}
              predictionKey={`engage:material-prediction:${JSON.stringify([user.geniusId, classId, assignmentId, item.id])}`} /> : (
              <div className="mt-3 space-y-4">
                {itemMedia?.image && <img src={itemMedia.image} alt={item.title} className="max-h-96 w-full rounded-lg border border-line object-contain" />}
                {itemMedia?.video && <video src={itemMedia.video} aria-label={item.title} className="max-h-96 w-full rounded-lg border border-line" controls playsInline preload="metadata" onError={event => recoverVideo(item.id, event.currentTarget.getAttribute("src") ?? "")} />}
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{item.body}</p>
              </div>
            )}
          </>}
        </article>;
      })}

      <div ref={questionsCard} tabIndex={-1} className={`${cardStyle} focus:outline-none`} aria-label="Your questions">
        <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">Your questions</h2>
        {submittedQuestions && submittedQuestions.length > 0 ? (
          <>
            <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-ok" role="status"><Check size={16} aria-hidden="true" />Submitted</p>
            <ul className="mt-3 space-y-2">
              {submittedQuestions.map((q, i) => <li key={i} className="break-words rounded-lg bg-canvas px-3 py-2.5 text-sm leading-relaxed text-ink-2">{q}</li>)}
            </ul>
          </>
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-3">
              {draftQuestions.map((q, i) => <div key={i} className="flex items-start gap-2">
                <textarea
                  ref={i === 0 ? firstQuestion : undefined}
                  aria-label={`Question ${i + 1}`}
                  value={q}
                  onChange={(e) => updateDraftQuestion(i, e.target.value)}
                  placeholder="What are you wondering about?"
                  rows={2}
                  disabled={submitting}
                  className="min-h-[76px] min-w-0 flex-1 resize-y rounded-[9px] border border-slate-300 bg-white px-3 py-2.5 text-[14.5px] leading-normal text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/10 disabled:opacity-60"
                />
                {draftQuestions.length > 1 && <button type="button" onClick={() => removeDraftQuestion(i)} disabled={submitting}
                  aria-label={`Remove question ${i + 1}`} className="mt-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-mute hover:bg-canvas disabled:opacity-45">Remove</button>}
              </div>)}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={addDraftQuestion} disabled={submitting} className={secondaryButton}><Plus size={15} aria-hidden="true" />Add another question</button>
              <button type="button" onClick={submitQuestions} disabled={submitting} className={primaryButton}>
                {submitting && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
                {submitting ? "Submitting…" : "Submit questions"}
              </button>
            </div>
            {submitError && <p className="mt-3 text-sm text-bad" role="alert">{submitError}</p>}
          </>
        )}
      </div>

      <div className={`${cardStyle} ${ratingUnlocked ? "" : "opacity-55"}`}>
        <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">Rate the material</h2>
        <p className="mt-1 text-[13.5px] text-mute">
          {ratingUnlocked ? "1 = not engaging · 5 = extremely engaging" : "Submit your questions first"}
        </p>
        <div className="mt-3 space-y-4">
          {contentItems.map((item) => {
            const currentRating = ratings[item.id];
            const saved = savedRatings[item.id];
            const locked = !ratingUnlocked || saved != null || ratingSubmitting;
            return <div key={item.id}>
              {contentItems.length > 1 && <h3 className="mb-2 text-sm font-semibold text-ink-2">{item.title}</h3>}
              {saved != null ? <p className="flex items-center gap-1.5 text-sm text-ok" role="status"><Check size={16} aria-hidden="true" />Thanks — you rated it {saved} / 5.</p> : (
                <div role="radiogroup" aria-label={`Engagement rating for ${item.title}`} className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5].map((value) => <button
                    key={value} type="button" role="radio" aria-checked={currentRating === value}
                    aria-label={`${value} — ${RATING_LABELS[value]}`}
                    tabIndex={currentRating === value || (!currentRating && value === 1) ? 0 : -1}
                    onClick={() => selectRating(item.id, value)} disabled={locked}
                    onKeyDown={(event) => {
                      const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                      if (!direction && event.key !== "Home" && event.key !== "End") return;
                      event.preventDefault();
                      const next = event.key === "Home" ? 1 : event.key === "End" ? 5 : ((value - 1 + direction + 5) % 5) + 1;
                      selectRating(item.id, next);
                      const choices = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
                      choices?.[next - 1]?.focus();
                    }}
                    className={`flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed ${currentRating === value ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-ink-2 hover:border-brand hover:bg-brand-light disabled:hover:border-slate-300 disabled:hover:bg-white"}`}
                  >{value}</button>)}
                </div>
              )}
            </div>;
          })}
        </div>
        {!allRatingsSubmitted && <div className="mt-3 flex justify-end">
          <button type="button" onClick={submitRatings} disabled={!ratingUnlocked || ratingSubmitting || !allRatingsSelected} className={primaryButton}>
            {ratingSubmitting && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
            {ratingSubmitting ? "Submitting…" : "Submit rating"}
          </button>
        </div>}
        {ratingError && <p className="mt-3 text-sm text-bad" role="alert">{ratingError}</p>}
      </div>
    </div>
  );
}

export default function StudentContentReviewView(props: Props) {
  return <ContentReview key={JSON.stringify([props.user.geniusId, props.user.classId, props.user.assignmentId])} {...props} />;
}
