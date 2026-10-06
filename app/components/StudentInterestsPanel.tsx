"use client";

import { useCallback, useEffect, useState } from "react";
import type { InterestActivity, TaskInterests } from "@/lib/task-interests";

type Props = {
  classId: string;
  assignmentId: string;
};

const RANK_LABELS = ["Most common", "Second most common"];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const formatWhen = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

function ActivityCard({ activity, rank }: { activity: InterestActivity; rank: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-slate-400">{RANK_LABELS[rank]}</p>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">
          {activity.category}
        </span>
      </div>
      <p className="text-lg font-semibold text-slate-900">{activity.activity}</p>
      <p className="text-sm text-slate-600">
        {plural(activity.studentCount, "student")} · {activity.doCount} do it · {activity.watchedCount} watched
      </p>
      {activity.objects.length > 0 && (
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-700">Objects: </span>
          {activity.objects.join(", ")}
        </p>
      )}
      {activity.incidents[0] && (
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-700">Example moment: </span>
          {activity.incidents[0]}
        </p>
      )}
    </div>
  );
}

/**
 * Most and second-most common daily experiences in this learning task's
 * survey responses (#114). The analysis updates automatically when new
 * responses arrive, so there's no button; loading may take a few seconds
 * while new responses are analyzed.
 */
export default function StudentInterestsPanel({ classId, assignmentId }: Props) {
  const [interests, setInterests] = useState<TaskInterests | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/survey-analysis?${new URLSearchParams({ classId, assignmentId })}`);
      const data = (await res.json().catch(() => ({}))) as { interests?: TaskInterests | null; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Student interests could not be analyzed right now.");
      setInterests(data.interests ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Student interests could not be analyzed right now.");
    } finally {
      setLoading(false);
    }
  }, [classId, assignmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const others = interests?.enoughResponses ? interests.activities.slice(2) : [];

  return (
    <section aria-label="Student interests" className="mt-5 rounded-2xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-900">Student interests</p>
      <p className="text-sm text-slate-500">
        The most common activities in students&apos; answers for this task, updated automatically as responses come in.
      </p>

      {loading && <p className="mt-3 text-sm text-slate-500">Checking for new responses…</p>}

      {!loading && error && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-rose-600">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && !interests && (
        <p className="mt-3 text-sm text-slate-500">Results appear here once students submit the survey.</p>
      )}

      {interests && !interests.enoughResponses && (
        <p className="mt-3 text-sm text-slate-500">
          Not enough responses yet. Results appear once at least 3 students have submitted.
        </p>
      )}

      {interests && interests.enoughResponses && interests.top.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">No clear activities were found in the responses.</p>
      )}

      {interests && interests.top.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {interests.top.map((activity, rank) => (
            <ActivityCard key={`${activity.category}-${activity.activity}`} activity={activity} rank={rank} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <p className="mt-3 text-sm text-slate-600">
          <span className="font-semibold text-slate-700">Also mentioned: </span>
          {others.map((a) => `${a.activity} (${a.studentCount})`).join(", ")}
        </p>
      )}

      {interests && (
        <p className="mt-3 text-xs text-slate-400">
          Updated {formatWhen(interests.analyzedAt)} from {plural(interests.responseCount, "response")}
          {interests.unclassifiedCount > 0 ? ` · ${interests.unclassifiedCount} with no clear activity` : ""}
          {interests.stale && (
            <span className="font-semibold text-amber-600">
              {" "}· newer responses couldn&apos;t be analyzed yet; showing the last result
            </span>
          )}
        </p>
      )}
    </section>
  );
}
