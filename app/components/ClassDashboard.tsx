"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import type { ClassDashboard as Data, DashboardQuestion } from "@/lib/class-dashboard";

const card = "rounded-xl border border-line bg-white";
const pill = "rounded-full bg-line-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2";
const th = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.06em] text-faint";
const td = "px-4 py-3 align-top";
const TAG_STYLE: Record<string, string> = {
  Investigable: "bg-ok-light text-ok", "Explanation-seeking": "bg-info-light text-info", Clarifying: "bg-warn-light text-warn", "Off-topic": "bg-line-2 text-mute",
};
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const lessonLabel = (n: number | null) => (n ? `Lesson ${n}` : "No lesson yet");

// The class dashboard (#207), laid out as in the v8.4 prototype: misconception
// patterns from every quiz in the class, then every student question, which
// the teacher can filter, search and add to a lesson's Class Question Board.
// The top of the page isn't decided yet, so it's left out.
export default function ClassDashboard({ classId, className }: { classId: string; className?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [lessonFilter, setLessonFilter] = useState<"all" | number>("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/class-dashboard?${new URLSearchParams({ classId })}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "The dashboard couldn't load.");
      setData(body as Data);
    } catch (err) { setError(err instanceof Error ? err.message : "The dashboard couldn't load."); }
  }, [classId]);
  useEffect(() => { void load(); }, [load]);

  const tasks = useMemo(() => new Map((data?.tasks ?? []).map(task => [task.assignmentId, task])), [data]);
  const boardTargets = (data?.tasks ?? []).filter(task => task.lessonNumber !== null);
  const lessons = [...new Set((data?.questions ?? []).map(q => q.lessonNumber).filter((n): n is number => n !== null))].sort((a, b) => a - b);
  const query = search.trim().toLowerCase();
  const shown = (data?.questions ?? []).filter(q => (lessonFilter === "all" || q.lessonNumber === lessonFilter)
    && (!query || q.text.toLowerCase().includes(query) || q.studentName.toLowerCase().includes(query)));

  async function addToBoard(question: DashboardQuestion, toAssignmentId: string) {
    const target = tasks.get(toAssignmentId);
    if (!target) return;
    setAdding(question.id); setNotice(null);
    try {
      const res = await fetch("/api/class-dashboard", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, questionId: question.id, fromAssignmentId: question.assignmentId, toAssignmentId }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "The question couldn't be added.");
      setData(prev => prev && { ...prev, questions: prev.questions.map(q => (q.id === question.id && !q.onBoards.includes(toAssignmentId) ? { ...q, onBoards: [...q.onBoards, toAssignmentId] } : q)) });
      setNotice({ text: `Added to the ${lessonLabel(target.lessonNumber)} board (${target.title}).` });
    } catch (err) { setNotice({ text: err instanceof Error ? err.message : "The question couldn't be added.", bad: true }); }
    finally { setAdding(null); }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 pb-12 pt-6 sm:px-5">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-faint">EngageAgent dashboard</p>
      <h1 className="mt-1 break-words text-[28px] font-bold tracking-tight">{className || "Class dashboard"}</h1>

      {error ? (
        <div role="alert" className="mt-6 flex flex-wrap items-center gap-2 rounded-lg border border-bad/20 bg-bad-light px-4 py-3 text-sm text-bad">
          {error}<button type="button" onClick={() => void load()} className="ml-auto font-semibold underline">Try again</button>
        </div>
      ) : !data ? <p role="status" className="mt-6 text-sm text-mute">Loading the dashboard…</p> : <>
        <section aria-labelledby="patterns-title" className={`${card} mt-6`}>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4 sm:px-5">
            <h2 id="patterns-title" className="text-xl font-bold">Misconception patterns</h2>
            <span className="ml-auto text-xs text-mute">Share of incorrect quiz answers</span>
          </div>
          {data.misconceptions.length === 0 ? <p className="border-t border-line-2 px-5 py-8 text-center text-sm text-mute">No quiz answers yet</p> : (
            <div className="overflow-x-auto border-t border-line-2">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr><th className={th}>Lesson</th><th className={th}>Misconception</th><th className={th}>Incorrect answers</th><th className={th}><span className="sr-only">Share</span></th></tr></thead>
                <tbody>
                  {data.misconceptions.map(m => (
                    <tr key={`${m.assignmentId}:${m.code}`} className="border-t border-line-2">
                      <td className={`${td} whitespace-nowrap`}>Lesson {m.lessonNumber}<div className="text-xs text-mute">{day(m.takenAt)}</div></td>
                      <td className={td}><span className="mr-1.5 inline-grid min-w-6 place-items-center rounded-md bg-warn-light px-1.5 text-xs font-bold text-warn">{m.code}</span>{m.text}</td>
                      <td className={`${td} whitespace-nowrap`}>{m.count} of {m.incorrect}</td>
                      <td className={`${td} w-44`}>
                        <div aria-hidden className="mt-1.5 h-2 rounded-full bg-line-2"><div className="h-2 rounded-full bg-brand" style={{ width: `${Math.round((m.count / Math.max(1, m.incorrect)) * 100)}%` }} /></div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="dashboard-questions-title" className={`${card} mt-6`}>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4 sm:px-5">
            <h2 id="dashboard-questions-title" className="text-xl font-bold">Student questions</h2><span className={pill}>{data.questions.length}</span>
            <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
              <div role="group" aria-label="Lesson" className="flex flex-wrap gap-1 rounded-lg bg-canvas p-1">
                {(["all", ...lessons] as const).map(value => (
                  <button key={value} type="button" aria-pressed={lessonFilter === value} onClick={() => setLessonFilter(value)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${lessonFilter === value ? "bg-white text-ink shadow-sm" : "text-mute hover:text-ink"}`}>
                    {value === "all" ? "All lessons" : `Lesson ${value}`}
                  </button>
                ))}
              </div>
              <label className="relative w-full sm:w-60">
                <span className="sr-only">Search questions or students</span>
                <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search questions or students"
                  className="w-full rounded-lg border border-line bg-white py-1.5 pl-8 pr-2 text-sm focus:border-brand focus:outline-none" />
              </label>
            </div>
          </div>
          {notice && <p role={notice.bad ? "alert" : "status"} className={`mx-4 mb-3 rounded-lg px-3 py-2 text-sm sm:mx-5 ${notice.bad ? "bg-bad-light text-bad" : "bg-ok-light text-ok"}`}>{notice.text}</p>}
          <div className="overflow-x-auto border-t border-line-2">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr><th className={th}>Question</th><th className={th}>Student</th><th className={th}>Lesson</th><th className={th}>Type</th><th className={th}>Board</th><th className={th}><span className="sr-only">Add to a board</span></th></tr></thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-mute">{data.questions.length ? "No questions match" : "No questions yet"}</td></tr>
                ) : shown.map(q => (
                  <tr key={`${q.assignmentId}:${q.id}`} className="border-t border-line-2">
                    <td className={`${td} max-w-[420px]`}>{q.text}</td>
                    <td className={`${td} whitespace-nowrap`}>{q.studentName}</td>
                    <td className={`${td} whitespace-nowrap`}>{lessonLabel(q.lessonNumber)}<div className="text-xs text-mute">{day(q.askedAt)}</div></td>
                    <td className={td}>{q.tag ? <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TAG_STYLE[q.tag]}`}>{q.tag}</span> : <span className="text-mute">—</span>}</td>
                    <td className={td}>{q.onBoards.length
                      ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-ok-light px-2 py-0.5 text-xs font-semibold text-ok"><Check size={12} />
                          On board{q.onBoards.length > 1 || q.onBoards[0] !== q.assignmentId ? ` · ${q.onBoards.map(id => lessonLabel(tasks.get(id)?.lessonNumber ?? null)).join(", ")}` : ""}</span>
                      : <span className="text-mute">—</span>}</td>
                    <td className={td}>
                      <select aria-label={`Add “${q.text}” to a lesson's board`} value="" disabled={adding === q.id || boardTargets.length === 0}
                        onChange={event => { if (event.target.value) void addToBoard(q, event.target.value); }}
                        className="w-44 rounded-lg border border-line bg-white px-2 py-1.5 text-xs disabled:opacity-50">
                        <option value="">{adding === q.id ? "Adding…" : "Add to board…"}</option>
                        {boardTargets.map(task => {
                          const already = q.onBoards.includes(task.assignmentId);
                          return <option key={task.assignmentId} value={task.assignmentId} disabled={already || !task.boardPublished}>
                            {lessonLabel(task.lessonNumber)} · {task.title}{already ? " (on board)" : !task.boardPublished ? " (board not published)" : ""}
                          </option>;
                        })}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>}
    </main>
  );
}
