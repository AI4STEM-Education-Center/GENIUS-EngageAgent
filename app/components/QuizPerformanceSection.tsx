"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildPerformanceReport,
  EMPTY_FILTERS,
  filterRows,
  hasActiveFilters,
  type PerformanceFilters,
} from "@/lib/quiz-performance";
import type { QuizStatus, StudentAnswer } from "@/lib/types";

type Props = {
  classId: string;
  assignmentId: string;
  className?: string;
  lessonNumber: number | null;
  quizStatus: QuizStatus;
  quizUpdatedAt?: string | null;
  answers: StudentAnswer[];
};

type SavedView = { open: boolean; filters: PerformanceFilters };

const CONFIDENCE_LABEL: Record<number, string> = {
  4: "Very confident – 4",
  3: "Somewhat confident – 3",
  2: "Not very confident – 2",
  1: "Just guessing – 1",
};

const shorten = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const formatWhen = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** Session storage can be blocked inside embedded frames; the report works without it. */
const readSaved = (key: string): SavedView | null => {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? ({ ...{ open: false }, ...JSON.parse(raw) } as SavedView) : null;
  } catch {
    return null;
  }
};
const writeSaved = (key: string, value: SavedView) => {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not available — filters just won't persist */
  }
};

const selectClass = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700";

/**
 * Quiz performance in the Assignment summary (UC-Q-06, #34): assessment header,
 * participation, a summary per question, and a filterable per-student report.
 * Uses the answers the dashboard already loads and refreshes.
 */
export default function QuizPerformanceSection({
  classId,
  assignmentId,
  className,
  lessonNumber,
  quizStatus,
  quizUpdatedAt,
  answers,
}: Props) {
  const report = useMemo(() => buildPerformanceReport(lessonNumber, answers), [lessonNumber, answers]);
  const storageKey = `quiz-performance:${classId}:${assignmentId}`;

  // Keep the teacher's filters for the session (spec step 15). Read once when
  // the section is created, then save on every change.
  const [open, setOpen] = useState(() => readSaved(storageKey)?.open ?? false);
  const [filters, setFilters] = useState<PerformanceFilters>(() => ({
    ...EMPTY_FILTERS,
    ...readSaved(storageKey)?.filters,
  }));
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    writeSaved(storageKey, { open, filters });
  }, [storageKey, open, filters]);

  const rows = useMemo(() => (report ? filterRows(report.rows, filters) : []), [report, filters]);

  const openReport = (question: string) => {
    setFilters({ ...EMPTY_FILTERS, question });
    setOpen(true);
    requestAnimationFrame(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const setFilter = (key: keyof PerformanceFilters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  if (!report) return null;

  const isFinal = quizStatus === "closed";
  const resultLabel = quizStatus === "draft" ? "Not published" : isFinal ? "Final" : "Provisional";
  const resultStyle =
    quizStatus === "draft"
      ? "bg-slate-100 text-slate-600"
      : isFinal
        ? "bg-emerald-100 text-emerald-700"
        : "bg-amber-100 text-amber-700";
  const statusWhen = formatWhen(quizUpdatedAt);
  const singleQuestion = filters.question !== "all";

  return (
    <section aria-labelledby="quiz-performance-heading" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-400">Quiz performance</p>
          <h2 id="quiz-performance-heading" className="text-lg font-semibold text-slate-900">
            Lesson {report.lessonNumber} quiz
          </h2>
          <p className="text-sm text-slate-500">
            {[
              report.lessonTitle !== `Lesson ${report.lessonNumber}` ? report.lessonTitle : null,
              className,
              statusWhen ? `${isFinal ? "Closed" : "Published"} ${statusWhen}` : null,
              "No due date",
              `${report.questionCount} questions`,
              "One attempt",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${resultStyle}`}>{resultLabel}</span>
          <button
            type="button"
            onClick={() => openReport("all")}
            className="rounded-xl bg-[#BA0C2F] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#9a0a27]"
          >
            Full report
          </button>
        </div>
      </div>

      {/* Participation */}
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-100 p-3">
          <dt className="text-[11px] font-semibold uppercase text-slate-400">Submitted</dt>
          <dd className="mt-1 text-xl font-semibold text-slate-900">{report.submitted}</dd>
        </div>
        {["In progress", "Not started", "Completion"].map((label) => (
          <div key={label} className="rounded-2xl border border-slate-100 p-3">
            <dt className="text-[11px] font-semibold uppercase text-slate-400">{label}</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-400">Not available</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-slate-400">
        {quizStatus === "closed"
          ? "Results are final."
          : "Results are provisional and update as students submit."}{" "}
        In-progress and not-started counts need the class roster from GENIUS, which isn’t available here yet.
      </p>

      {/* Per-question summary */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] uppercase text-slate-400">
              <th className="py-2 pr-3 font-semibold">#</th>
              <th className="py-2 pr-3 font-semibold">Question</th>
              <th className="py-2 pr-3 font-semibold">Responses</th>
              <th className="py-2 pr-3 font-semibold">No response</th>
              <th className="py-2 pr-3 font-semibold">Correct</th>
              <th className="py-2 pr-3 font-semibold">Avg. confidence</th>
              <th className="py-2 pr-3 font-semibold">Answers chosen</th>
              <th className="py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {report.questions.map((q) => (
              <tr key={q.itemId} className="border-b border-slate-100 align-top">
                <td className="py-3 pr-3 font-semibold text-slate-700">{q.questionNumber}</td>
                <td className="py-3 pr-3 text-slate-700" title={q.stem}>{shorten(q.stem)}</td>
                <td className="py-3 pr-3 text-slate-700">{q.responses}</td>
                <td className="py-3 pr-3 text-slate-700">{q.noResponse}</td>
                <td className="py-3 pr-3 text-slate-700">
                  {q.correctPercent === null ? (
                    <span className="text-slate-400">Not available</span>
                  ) : (
                    <>
                      {q.correct} <span className="text-slate-400">({q.correctPercent}%)</span>
                    </>
                  )}
                </td>
                <td className="py-3 pr-3 text-slate-700">
                  {q.averageConfidence === null ? <span className="text-slate-400">Not available</span> : `${q.averageConfidence} / 4`}
                </td>
                <td className="py-3 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(q.optionCounts).map(([opt, count]) => (
                      <span
                        key={opt}
                        title={q.options[opt]}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          opt === q.correctOption ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {opt}: {count}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-3 text-right">
                  <button
                    type="button"
                    onClick={() => openReport(q.itemId)}
                    className="whitespace-nowrap rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    View details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detailed report */}
      {open && (
        <div ref={reportRef} className="mt-6 rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">
              Detailed report{" "}
              <span className="font-normal text-slate-500">
                · showing {rows.length} of {report.rows.length} answers
              </span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                disabled={!hasActiveFilters(filters)}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear all filters
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <select aria-label="Question" value={filters.question} onChange={(e) => setFilter("question", e.target.value)} className={selectClass}>
              <option value="all">All questions</option>
              {report.questions.map((q) => (
                <option key={q.itemId} value={q.itemId}>Question {q.questionNumber}</option>
              ))}
            </select>
            <input
              aria-label="Search student"
              placeholder="Search student name or ID…"
              value={filters.student}
              onChange={(e) => setFilter("student", e.target.value)}
              className={selectClass}
            />
            <select aria-label="Answer option" value={filters.option} onChange={(e) => setFilter("option", e.target.value)} className={selectClass}>
              <option value="all">Any answer option</option>
              {["A", "B", "C", "D"].map((o) => (
                <option key={o} value={o}>Option {o}</option>
              ))}
            </select>
            <select aria-label="Confidence" value={filters.confidence} onChange={(e) => setFilter("confidence", e.target.value)} className={selectClass}>
              <option value="all">Any confidence</option>
              {[4, 3, 2, 1].map((n) => (
                <option key={n} value={String(n)}>{CONFIDENCE_LABEL[n]}</option>
              ))}
            </select>
            <select aria-label="Diagnostic type" value={filters.diagnostic} onChange={(e) => setFilter("diagnostic", e.target.value)} className={selectClass}>
              <option value="all">Any diagnostic type</option>
              {report.diagnosticOptions.map((d) => (
                <option key={d.key} value={d.key}>{shorten(d.label, 70)}</option>
              ))}
            </select>
            <select aria-label="Correct" value={filters.correct} onChange={(e) => setFilter("correct", e.target.value)} className={selectClass}>
              <option value="all">Correct or incorrect</option>
              <option value="true">Correct only</option>
              <option value="false">Incorrect only</option>
            </select>
          </div>

          {/* Rows */}
          {report.submitted === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No students have submitted yet.</p>
          ) : rows.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No answers match these filters.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] uppercase text-slate-400">
                    {!singleQuestion && <th className="py-2 pr-3 font-semibold">Question</th>}
                    <th className="py-2 pr-3 font-semibold">Student</th>
                    <th className="py-2 pr-3 font-semibold">Answer</th>
                    <th className="py-2 pr-3 font-semibold">Confidence</th>
                    <th className="py-2 pr-3 font-semibold">Correct</th>
                    <th className="py-2 font-semibold">Diagnostic type</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.studentId}:${r.itemId}`} className="border-b border-slate-100 align-top">
                      {!singleQuestion && <td className="py-2.5 pr-3 font-semibold text-slate-700">Q{r.questionNumber}</td>}
                      <td className="py-2.5 pr-3">
                        <p className="text-slate-800">{r.studentName}</p>
                        <p className="text-[11px] text-slate-400">{r.studentId}</p>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700">
                        {r.selectedOption ? (
                          <>
                            <span className="font-semibold">{r.selectedOption}:</span> {r.selectedText}
                          </>
                        ) : (
                          <span className="italic text-slate-400">No answer</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700">
                        {r.confidenceLevel ? CONFIDENCE_LABEL[r.confidenceLevel] : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="py-2.5 pr-3">
                        {r.isCorrect === null ? (
                          <span className="text-slate-400">—</span>
                        ) : r.isCorrect ? (
                          <span className="font-semibold text-emerald-700">True</span>
                        ) : (
                          <span className="font-semibold text-rose-700">False</span>
                        )}
                      </td>
                      <td className="py-2.5 text-slate-700">{r.diagnosticLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
