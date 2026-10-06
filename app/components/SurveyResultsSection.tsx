"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { pickTaskSurvey } from "@/lib/survey-schedule";
import {
  buildTeacherSurveySource,
  countAnswered,
  entryToCsv,
  type SurveyResultSource,
} from "@/lib/survey-results";
import type { Survey, SurveyResponse } from "@/lib/types";
import ClassInterestsPanel from "./ClassInterestsPanel";

type Props = {
  classId: string;
  assignmentId: string;
};

const formatWhen = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/**
 * Individual student survey results in the Assignment summary (#93).
 * One student at a time, with previous/next navigation, following the
 * layout in the issue's mockup.
 */
export default function SurveyResultsSection({ classId, assignmentId }: Props) {
  const [sources, setSources] = useState<SurveyResultSource[]>([]);
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sourceId, setSourceId] = useState<string>("");
  const [index, setIndex] = useState(0);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!classId || !assignmentId) return;
    setLoading(true);
    const q = `classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`;
    const json = async <T,>(url: string): Promise<T | null> => {
      try {
        const res = await fetch(url);
        return res.ok ? ((await res.json()) as T) : null;
      } catch {
        return null;
      }
    };
    try {
      const [surveysData, responsesData] = await Promise.all([
        json<{ surveys?: Survey[] }>(`/api/surveys?${q}`),
        json<{ responses?: SurveyResponse[] }>(`/api/survey-responses?${q}`),
      ]);
      const next: SurveyResultSource[] = [];
      // Each learning task has one survey (#111).
      const survey = pickTaskSurvey(surveysData?.surveys ?? []);
      if (survey) next.push(buildTeacherSurveySource(survey, responsesData?.responses ?? []));
      setSources(next);
      setSurveyId(survey?.survey_id ?? null);
      setSourceId((current) =>
        next.some((s) => s.id === current) ? current : (next.find((s) => s.entries.length > 0) ?? next[0])?.id ?? "",
      );
    } finally {
      setLoading(false);
    }
  }, [classId, assignmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const source = sources.find((s) => s.id === sourceId) ?? null;
  const entries = useMemo(() => source?.entries ?? [], [source]);
  const safeIndex = Math.min(index, Math.max(entries.length - 1, 0));
  const entry = entries[safeIndex];

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !term || e.name.toLowerCase().includes(term));
  }, [entries, search]);

  const go = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= entries.length) return;
    setIndex(nextIndex);
  };

  const download = () => {
    if (!source || !entry) return;
    const blob = new Blob([entryToCsv(source, entry)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${source.title} - ${entry.name}.csv`.replace(/[\\/:*?"<>|]/g, "");
    a.click();
    URL.revokeObjectURL(url);
  };

  const prevButton = (position: "top" | "bottom") => (
    <button
      type="button"
      onClick={() => go(safeIndex - 1)}
      disabled={safeIndex === 0}
      aria-label={`Previous student (${position})`}
      className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      ← Previous student
    </button>
  );

  const nextButton = (position: "top" | "bottom") => (
    <button
      type="button"
      onClick={() => go(safeIndex + 1)}
      disabled={safeIndex >= entries.length - 1}
      aria-label={`Next student (${position})`}
      className="rounded-xl bg-[#BA0C2F] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#8F0A25] disabled:cursor-not-allowed disabled:opacity-40"
    >
      Next student →
    </button>
  );

  const counts = entry && source ? countAnswered(source.questions, entry.answers) : null;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-400">Survey results</p>
          <h2 className="text-lg font-semibold text-slate-900">
            {source ? source.title : "Individual survey responses"}
          </h2>
          {source && (
            <p className="text-sm text-slate-500">
              {source.subtitle ? `${source.subtitle} · ` : ""}
              {source.entries.length} submitted
              {source.inProgress > 0 ? ` · ${source.inProgress} in progress` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sources.length > 1 && (
            <select
              aria-label="Survey"
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setIndex(0);
                setSearch("");
              }}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.subtitle ? ` (${s.subtitle})` : ""}
                </option>
              ))}
            </select>
          )}
          {entry && (
            <button
              type="button"
              onClick={download}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Download student response
            </button>
          )}
        </div>
      </div>

      {source && surveyId && (
        <ClassInterestsPanel classId={classId} assignmentId={assignmentId} surveyId={surveyId} />
      )}

      {loading && sources.length === 0 && <p className="mt-4 text-sm text-slate-500">Loading survey results…</p>}
      {!loading && sources.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">Survey results appear here after students answer a survey.</p>
      )}
      {source && entries.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No students have submitted this survey yet.</p>
      )}

      {source && entry && counts && (
        <div className="mt-5 flex flex-col gap-4">
          {/* Toolbar: jump to a student */}
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Student"
              value={safeIndex}
              onChange={(e) => go(Number(e.target.value))}
              className="min-w-48 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              {(matches.length > 0 ? matches : entries.map((e, i) => ({ e, i }))).map(({ e, i }) => (
                <option key={e.studentId} value={i}>
                  {e.name}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                const term = e.target.value.trim().toLowerCase();
                const first = entries.findIndex((x) => x.name.toLowerCase().includes(term));
                if (term && first >= 0) setIndex(first);
              }}
              placeholder="Search student…"
              aria-label="Search student"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          {/* Student navigation */}
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:flex-row sm:justify-between">
            <div className="order-2 sm:order-1">{prevButton("top")}</div>
            <div className="order-1 text-center sm:order-2">
              <p className="text-lg font-semibold text-slate-900">{entry.name}</p>
              <p className="text-xs text-slate-500">
                Submitted {formatWhen(entry.submittedAt)}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-[#BA0C2F]">
                Student {safeIndex + 1} of {entries.length}
              </p>
            </div>
            <div className="order-3">{nextButton("top")}</div>
          </div>

          {/* Summary strip */}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Submission status", "Submitted"],
              ["Submitted", formatWhen(entry.submittedAt)],
              ["Questions answered", `${counts.answered} / ${counts.total}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-100 p-3">
                <dt className="text-[11px] font-semibold uppercase text-slate-400">{label}</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-800">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {/* Answers */}
          {source.questions.map((q, qi) => (
            <article key={q.item_id} className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-100 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase text-[#BA0C2F]">Question {qi + 1}</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{q.stem}</p>
                {q.example && <p className="mt-0.5 text-xs text-slate-500">{q.example}</p>}
              </div>
              <div className="divide-y divide-slate-100">
                {q.response_fields.map((f) => {
                  const value = entry.answers[f.field_id]?.trim();
                  return (
                    <div key={f.field_id} className="grid gap-1 p-4 sm:grid-cols-[220px_1fr]">
                      <p className="text-xs font-semibold text-slate-500">{f.label}</p>
                      <p className="text-sm text-slate-800">
                        {!value ? (
                          <span className="italic text-slate-400">No answer</span>
                        ) : f.response_type === "choice" ? (
                          <span className="rounded-full bg-[#FBE9ED] px-3 py-1 text-xs font-semibold text-[#BA0C2F]">
                            {value}
                          </span>
                        ) : (
                          value
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}

          <div className="flex justify-between gap-2">
            {prevButton("bottom")}
            {nextButton("bottom")}
          </div>
        </div>
      )}
    </div>
  );
}
