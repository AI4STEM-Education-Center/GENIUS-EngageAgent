"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type MonthSummary = {
  month: string;
  annotations: number;
  studentAnswers: number;
  strategyPlans: number;
  publishedContent: number;
  contentRatings: number;
  total: number;
};

const formatMonth = (monthKey: string) => {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

export default function DataExportPage() {
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/data-export");
      if (!res.ok) {
        throw new Error(`Failed to load data summary (${res.status})`);
      }
      const data = await res.json();
      setMonths(data.months ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const handleDownload = async (month: string) => {
    setDownloading(month);
    try {
      const res = await fetch(`/api/data-export?month=${month}&format=xlsx`);
      if (!res.ok) {
        throw new Error("Download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `engage-data-${month}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(null);
    }
  };

  const toggleMonth = (month: string) => {
    setExpandedMonth((prev) => (prev === month ? null : month));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-4">
          <nav className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Engage Agent
            </p>
            <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-indigo-700">
              Data Export
            </span>
            <div className="ml-auto">
              <Link
                href="/"
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              >
                Back to app
              </Link>
            </div>
          </nav>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Monthly data export
              </p>
              <h1 className="text-3xl font-semibold text-slate-900">
                Teacher Data Archive
              </h1>
              <p className="max-w-3xl text-sm text-slate-600">
                Browse all data produced across classes and assignments, organized
                by month. Click a month to view breakdowns, or download the full
                dataset as an Excel file.
              </p>
            </div>
          </div>
        </header>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-4">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              <p className="text-sm text-slate-500">Loading data summary...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!loading && !error && months.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            No data found yet. Data will appear here once teachers and students
            interact with the Engage Agent.
          </div>
        )}

        {!loading && months.length > 0 && (
          <div className="grid gap-3">
            {months.map((m) => {
              const isExpanded = expandedMonth === m.month;
              const isDownloading = downloading === m.month;

              return (
                <div
                  key={m.month}
                  className="rounded-2xl border border-slate-200 bg-white shadow-sm transition-all"
                >
                  <button
                    type="button"
                    onClick={() => toggleMonth(m.month)}
                    className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-600">
                        {m.month.split("-")[1]}
                      </div>
                      <div>
                        <p className="text-base font-semibold text-slate-900">
                          {formatMonth(m.month)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {m.total} total record{m.total === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDownload(m.month);
                        }}
                        disabled={isDownloading}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        {isDownloading ? "Downloading..." : "Download .xlsx"}
                      </button>
                      <svg
                        className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-100 px-5 py-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <DataCard
                          label="Teacher Annotations"
                          count={m.annotations}
                          color="bg-emerald-100 text-emerald-700"
                        />
                        <DataCard
                          label="Student Answers"
                          count={m.studentAnswers}
                          color="bg-blue-100 text-blue-700"
                        />
                        <DataCard
                          label="Strategy Plans"
                          count={m.strategyPlans}
                          color="bg-violet-100 text-violet-700"
                        />
                        <DataCard
                          label="Published Content"
                          count={m.publishedContent}
                          color="bg-amber-100 text-amber-700"
                        />
                        <DataCard
                          label="Material Ratings"
                          count={m.contentRatings}
                          color="bg-rose-100 text-rose-700"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DataCard({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${color}`}
        >
          {count}
        </span>
        <span className="text-xs text-slate-500">
          record{count === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
