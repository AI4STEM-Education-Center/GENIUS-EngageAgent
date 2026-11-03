"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Flag, Lock, Pencil, Sparkles } from "lucide-react";
import { scopedTaskFetch } from "@/lib/client-auth";
import type { BoardQuestion, QuestionBoard } from "@/lib/class-questions";
import type { TaskQuestions } from "@/lib/class-questions-server";
import type { QuizReport, ReportRelease } from "@/lib/quiz-report";
import QuizReportView from "./QuizReportView";

type Props = {
  classId: string;
  assignmentId: string;
  /** Questions come from Content Review, so they start once materials are sent in Step 3. */
  materialsSent: boolean;
  /** A one-line status for the Step 4 tab. */
  onStatusChange?: (status: string) => void;
};

const POLL_MS = 30_000;
const card = "rounded-xl border border-line bg-white p-5";
const pill = "rounded-full bg-line-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2";
const button = "inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50";
const primary = "inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45";
const ghost = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-canvas";
const TAG_STYLE: Record<string, string> = {
  Investigable: "bg-ok-light text-ok", "Explanation-seeking": "bg-info-light text-info", Clarifying: "bg-warn-light text-warn", "Off-topic": "bg-line-2 text-mute",
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const errorText = async (res: Response, fallback: string) => ((await res.json().catch(() => ({}))) as { error?: string }).error ?? fallback;

function Empty({ children, locked }: { children: React.ReactNode; locked?: boolean }) {
  return <div className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-dashed border-line px-4 py-8 text-sm text-mute">{locked && <Lock size={15} />}{children}</div>;
}

// Step 4 in the v8.3 layout (#182): the students' questions sorted for
// discussion, the Class Question Board the teacher publishes from them, and
// the release of quiz feedback reports.
export default function DiscussionStep({ classId, assignmentId, materialsSent, onStatusChange }: Props) {
  const scope = { classId, assignmentId };
  const query = new URLSearchParams(scope).toString();

  // 1 · Student questions
  const [questions, setQuestions] = useState<TaskQuestions | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const preselected = useRef(false);

  // 2 · Board
  const [board, setBoard] = useState<QuestionBoard | null>(null);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [boardBusy, setBoardBusy] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  // 3 · Reports
  const [reports, setReports] = useState<{ release: ReportRelease | null; lessonNumber: number | null; students: { id: string; name: string }[] } | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [preview, setPreview] = useState<{ name: string; report: QuizReport | null; error?: string } | null>(null);

  const loadQuestions = useCallback(async () => {
    try {
      const res = await scopedTaskFetch(scope, `/api/question-analysis?${query}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await errorText(res, "Student questions couldn't be loaded right now."));
      setQuestions((await res.json()) as TaskQuestions);
      setQuestionsError(null);
    } catch (error) {
      setQuestionsError(error instanceof Error ? error.message : "Student questions couldn't be loaded right now.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const loadBoard = useCallback(async () => {
    const res = await scopedTaskFetch(scope, `/api/question-board?${query}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setBoard(((await res.json()) as { board: QuestionBoard | null }).board);
    setBoardLoaded(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const loadReports = useCallback(async () => {
    try {
      const res = await scopedTaskFetch(scope, `/api/quiz-report?${query}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await errorText(res, "Reports couldn't be loaded right now."));
      setReports(await res.json());
      setReportsError(null);
    } catch (error) {
      setReportsError(error instanceof Error ? error.message : "Reports couldn't be loaded right now.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    void loadBoard();
    void loadReports();
    if (!materialsSent) return;
    void loadQuestions();
    // New questions keep arriving while students work; the analysis is redone only when they change.
    const id = window.setInterval(() => { void loadQuestions(); void loadReports(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [materialsSent, loadQuestions, loadBoard, loadReports]);

  // Start from the published board, or else from the AI's suggestions, once.
  useEffect(() => {
    if (preselected.current || !boardLoaded || !questions) return;
    preselected.current = true;
    const all = questions.groups.flatMap((group) => group.questions);
    if (board) {
      setSelected(new Set(board.questions.map((q) => q.id)));
      setEdits(Object.fromEntries(board.questions.filter((q) => all.find((a) => a.id === q.id)?.text !== q.text).map((q) => [q.id, q.text])));
    } else {
      setSelected(new Set(all.filter((q) => q.suggested).map((q) => q.id)));
    }
  }, [board, boardLoaded, questions]);

  const total = questions?.total ?? 0;
  useEffect(() => {
    onStatusChange?.(board ? "Board live" : total ? plural(total, "question") : "Class results");
  }, [board, total, onStatusChange]);

  const all = questions?.groups.flatMap((group) => group.questions.map((q) => ({ ...q, group: group.title }))) ?? [];
  const textOf = (id: string) => edits[id] ?? all.find((q) => q.id === id)?.text ?? board?.questions.find((q) => q.id === id)?.text ?? "";
  const toggle = (ids: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    return next;
  });
  // A selected question that has since left the list (a student changed it) stays on the board as published.
  const chosen: BoardQuestion[] = [...selected].map((id) => {
    const q = all.find((item) => item.id === id);
    const published = board?.questions.find((item) => item.id === id);
    return { id, text: textOf(id).trim(), theme: q?.group ?? published?.theme ?? "" };
  }).filter((q) => q.text);

  const publish = async () => {
    setBoardBusy(true);
    setBoardError(null);
    try {
      const res = await scopedTaskFetch(scope, "/api/question-board", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scope, questions: chosen }),
      });
      if (!res.ok) throw new Error(await errorText(res, "The board couldn't be saved right now."));
      setBoard(((await res.json()) as { board: QuestionBoard }).board);
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : "The board couldn't be saved right now.");
    } finally {
      setBoardBusy(false);
    }
  };
  const unpublish = async () => {
    setBoardBusy(true);
    setBoardError(null);
    try {
      const res = await scopedTaskFetch(scope, "/api/question-board", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scope) });
      if (!res.ok) throw new Error(await errorText(res, "The board couldn't be unpublished right now."));
      setBoard(null);
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : "The board couldn't be unpublished right now.");
    } finally {
      setBoardBusy(false);
    }
  };

  const release = async (reason: "taught" | "early") => {
    setReleasing(true);
    setReportsError(null);
    try {
      const res = await scopedTaskFetch(scope, "/api/quiz-report-release", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scope, reason }),
      });
      if (!res.ok) throw new Error(await errorText(res, "Reports couldn't be released right now."));
      const { release: released } = (await res.json()) as { release: ReportRelease };
      setReports((prev) => (prev ? { ...prev, release: released } : prev));
    } catch (error) {
      setReportsError(error instanceof Error ? error.message : "Reports couldn't be released right now.");
    } finally {
      setReleasing(false);
    }
  };
  const openPreview = async (student: { id: string; name: string }) => {
    setPreview({ name: student.name, report: null });
    try {
      const res = await scopedTaskFetch(scope, `/api/quiz-report?${query}&studentId=${encodeURIComponent(student.id)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await errorText(res, "This report couldn't be loaded."));
      const { report } = (await res.json()) as { report: QuizReport | null };
      setPreview({ name: student.name, report, ...(report ? {} : { error: "This student has no quiz report." }) });
    } catch (error) {
      setPreview({ name: student.name, report: null, error: error instanceof Error ? error.message : "This report couldn't be loaded." });
    }
  };

  const suggested = all.filter((q) => q.suggested).length;
  const students = reports?.students ?? [];
  const lesson = reports?.lessonNumber;

  return (
    <div>
      <nav aria-label="Step 4 sections" className="mb-4 flex flex-wrap gap-2 text-sm">
        <a href="#questions" className={pill}>1 · Student questions{total ? ` (${total})` : ""}</a>
        <a href="#board" className={pill}>2 · Class Question Board</a>
        <a href="#reports" className={pill}>3 · Feedback reports</a>
      </nav>
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-faint">Step 4</p>
      <h1 className="mt-1 text-[28px] font-bold tracking-tight">Questions &amp; discussion</h1>

      <section id="questions" aria-labelledby="questions-title" className={`${card} mt-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="questions-title" className="text-xl font-bold">Student questions</h2>
          {questions && total > 0 && <span className="ml-auto text-sm text-mute">{plural(total, "question")} from {plural(questions.students, "student")}</span>}
        </div>
        {!materialsSent ? <Empty locked>Available after materials are sent in Step 3</Empty>
          : questionsError ? (
            <div role="alert" className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-bad/20 bg-bad-light px-4 py-3 text-sm text-bad">
              {questionsError}<button type="button" onClick={() => void loadQuestions()} className="ml-auto font-semibold underline">Try again</button>
            </div>)
          : !questions ? <p role="status" className="mt-4 text-sm text-mute">Loading and sorting questions…</p>
          : total === 0 ? <Empty>No questions yet</Empty>
          : <>
            {questions.analysisError
              ? <div role="status" className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-warn-light px-4 py-3 text-sm text-warn">
                  {questions.analysisError} You can still choose questions for the board.
                  <button type="button" onClick={() => void loadQuestions()} className="ml-auto font-semibold underline">Try again</button>
                </div>
              : suggested > 0 && <div className="mt-4 flex items-center gap-2 rounded-lg bg-ai-light px-4 py-3 text-sm text-ai"><Sparkles size={16} /><b>{suggested} suggested for discussion</b></div>}
            {questions.groups.map((group) => {
              const ids = group.questions.map((q) => q.id);
              return (
                <div key={group.title} role="group" aria-label={group.title} className="mt-5">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{group.title}</h3><span className={pill}>{group.questions.length}</span>
                    <button type="button" onClick={() => toggle(ids, !ids.every((id) => selected.has(id)))} className={`ml-auto ${ghost}`}>
                      {ids.every((id) => selected.has(id)) ? "Clear all" : "Select all"}
                    </button>
                  </div>
                  <ul className="mt-2 grid gap-2">
                    {group.questions.map((q) => (
                      <li key={q.id} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${selected.has(q.id) ? "border-brand bg-brand-light/50" : "border-line-2"}`}>
                        <input type="checkbox" aria-label={textOf(q.id)} checked={selected.has(q.id)} onChange={(event) => toggle([q.id], event.target.checked)} className="mt-1 h-4 w-4 accent-brand" />
                        <div className="min-w-0 flex-1">
                          {editing === q.id
                            ? <input type="text" aria-label="Board wording" autoFocus defaultValue={textOf(q.id)} maxLength={300}
                                onBlur={(event) => { const text = event.target.value.trim(); setEdits((prev) => { const next = { ...prev }; if (text && text !== q.text) next[q.id] = text; else delete next[q.id]; return next; }); setEditing(null); }}
                                onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur(); }}
                                className="w-full rounded-md border border-line px-2 py-1 text-[14.5px] focus:border-brand focus:outline-none" />
                            : <p className="text-[14.5px]">{textOf(q.id)}{edits[q.id] && <span className={`ml-2 ${pill}`}>Edited for the board</span>}</p>}
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mute">
                            <span>{q.studentName}</span>
                            {q.tag && <span className={`rounded-full px-2 py-0.5 font-semibold ${TAG_STYLE[q.tag]}`}>{q.tag}</span>}
                            {q.suggested && <span className="inline-flex items-center gap-1 rounded-full bg-ai-light px-2 py-0.5 font-semibold text-ai"><Sparkles size={11} />Suggested</span>}
                          </div>
                        </div>
                        <button type="button" onClick={() => setEditing(q.id)} className={ghost}><Pencil size={12} />Edit wording</button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
              <b>{selected.size}</b> selected<span className="text-xs text-mute">· Shown without names</span>
              <button type="button" onClick={() => void publish()} disabled={chosen.length === 0 || boardBusy} className={`ml-auto ${primary}`}>
                {boardBusy ? "Saving…" : board ? `Update board (${chosen.length})` : `Publish ${chosen.length} to Class Question Board`}
              </button>
            </div>
          </>}
      </section>

      <section id="board" aria-labelledby="board-title" className={`${card} mt-6`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="board-title" className="text-xl font-bold">Class Question Board</h2>
          {board && <>
            <span className="ml-auto rounded-full bg-ok-light px-2.5 py-0.5 text-xs font-semibold text-ok">Live for students</span>
            <button type="button" onClick={() => void unpublish()} disabled={boardBusy} className={ghost}>Unpublish</button>
          </>}
        </div>
        {boardError && <p role="alert" className="mt-3 text-sm text-bad">{boardError}</p>}
        {!board ? <Empty>Not published yet</Empty> : (
          <ul aria-label="Questions on the board" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {board.questions.map((q) => (
              <li key={q.id} className="rounded-lg border border-warn/20 bg-warn-light/60 p-3.5 text-sm">
                {q.theme && <p className="text-xs font-semibold text-warn">{q.theme}</p>}
                <p className="mt-1 leading-6">{q.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="reports" aria-labelledby="reports-title" className={`${card} mt-6`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="reports-title" className="text-xl font-bold">Feedback reports</h2>
          {reports?.release ? <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-ok-light px-2.5 py-0.5 text-xs font-semibold text-ok"><Check size={13} />Released</span>
            : students.length > 0 && <>
              <span className="ml-auto rounded-full bg-ok-light px-2.5 py-0.5 text-xs font-semibold text-ok">{plural(students.length, "report")} ready</span>
              <span className={`inline-flex items-center gap-1 ${pill}`}><Lock size={12} />Held until Lesson {lesson} is taught</span>
            </>}
        </div>
        {reportsError && <p role="alert" className="mt-3 text-sm text-bad">{reportsError}</p>}
        {students.length === 0 ? <Empty>No reports yet</Empty> : (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {reports?.release
              ? <p role="status" className="flex items-center gap-1.5 text-sm text-ok"><Check size={15} />Released to {plural(students.length, "student")}</p>
              : <>
                <button type="button" onClick={() => void release("taught")} disabled={releasing} className={primary}><Flag size={15} />Mark Lesson {lesson} as taught</button>
                <button type="button" onClick={() => void release("early")} disabled={releasing} className={ghost}>Release now instead</button>
              </>}
            <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
              Preview a report
              <select value="" onChange={(event) => { const student = students.find((s) => s.id === event.target.value); if (student) void openPreview(student); }}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm">
                <option value="">Choose a student</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
        )}
        {preview && (
          <div role="region" aria-label={`Report preview for ${preview.name}`} className="mt-5 rounded-xl bg-canvas p-4">
            <div className="mb-3 flex items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-faint">Preview{reports?.release ? "" : " · not yet released"}</p>
              <button type="button" onClick={() => setPreview(null)} className={`ml-auto ${button}`}>Close preview</button>
            </div>
            {preview.report ? <QuizReportView report={preview.report} name={preview.name} />
              : preview.error ? <p role="alert" className="text-sm text-bad">{preview.error}</p>
              : <p role="status" className="text-sm text-mute">Loading…</p>}
          </div>
        )}
      </section>
    </div>
  );
}
