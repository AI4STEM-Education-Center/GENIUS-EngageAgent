"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { History, Pencil, Plus } from "lucide-react";
import type { LessonDraft, LessonListRow, LessonRow } from "@/lib/lessons-store";
import { editHref, formatDay, goTo, historyHref, lessonFetch, LessonsFrame, LoadError, messageOf, plural, ui } from "./lesson-ui";

function TaskCounts({ counts }: { counts: Record<number, number> }) {
  const versions = Object.keys(counts).map(Number).filter((version) => counts[version] > 0).sort((a, b) => b - a);
  if (!versions.length) return <>No tasks yet</>;
  return <>{versions.map((version) => `Version ${version}: ${plural(counts[version], "task")}`).join(" · ")}</>;
}

function LessonRowItem({ row, opening, onEdit }: { row: LessonListRow; opening: boolean; onEdit: () => void }) {
  const title = row.title || "Untitled lesson";
  const named = `Lesson ${row.lessonNumber}: ${title}`;
  const published = row.currentVersion !== null;
  return (
    <li className="grid gap-3 border-b border-line-2 p-4 last:border-b-0 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {title !== `Lesson ${row.lessonNumber}` && <span className="text-xs font-semibold text-mute">Lesson {row.lessonNumber}</span>}
          {!published && <span className={`${ui.pill} bg-warn-light text-warn`}>Draft only</span>}
          {published && row.draftVersion !== null && <span className={`${ui.pill} bg-info-light text-info`}>Draft</span>}
        </div>
        <h2 className="mt-1 break-words text-base font-semibold text-ink">{title}</h2>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
          <p>{published ? `Version ${row.currentVersion} · Published ${formatDay(row.currentPublishedAt)}` : "Not published yet"}</p>
          <p>Created by {row.createdBy.name}</p>
          <p><TaskCounts counts={row.tasksByVersion} /></p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} disabled={opening} aria-label={`Edit ${named}`} className={ui.secondary}>
          <Pencil size={15} aria-hidden="true" />{opening ? "Opening..." : "Edit"}
        </button>
        <Link href={historyHref(row.lessonNumber)} aria-label={`History of ${named}`} className={ui.secondary}>
          <History size={15} aria-hidden="true" />History
        </Link>
      </div>
    </li>
  );
}

function ListContent() {
  const [rows, setRows] = useState<LessonListRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setLoadError(""); setRows(null); setAttempt((n) => n + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    lessonFetch<{ lessons: LessonListRow[] }>("/api/lessons", { signal: controller.signal })
      .then((result) => setRows(result.lessons))
      .catch((error) => { if (!controller.signal.aborted) setLoadError(messageOf(error)); });
    return () => controller.abort();
  }, [attempt]);

  async function newLesson() {
    setBusy("new"); setActionError("");
    try {
      const { row } = await lessonFetch<{ row: LessonRow }>("/api/lessons", { method: "POST", json: {} });
      goTo(editHref(row.lessonNumber));
    } catch (error) { setActionError(messageOf(error)); setBusy(null); }
  }

  /** Opens the draft, or starts the next version as a copy of the current one. */
  async function edit(lessonNumber: number) {
    setBusy(lessonNumber); setActionError("");
    try {
      await lessonFetch<{ draft: LessonDraft }>(`/api/lessons/${lessonNumber}/draft`, { method: "POST", json: {} });
      goTo(editHref(lessonNumber));
    } catch (error) { setActionError(messageOf(error)); setBusy(null); }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink">Lessons</h1>
          <p className={`mt-1 ${ui.hint}`}>Published lessons can be used in new tasks. Tasks keep the version they started with.</p>
        </div>
        <button type="button" onClick={newLesson} disabled={busy !== null} className={ui.primary}>
          <Plus size={16} aria-hidden="true" />{busy === "new" ? "Adding..." : "New lesson"}
        </button>
      </div>
      {actionError && <p role="alert" className="mt-4 rounded-lg border border-bad bg-bad-light p-3 text-sm text-bad">{actionError}</p>}
      <div className="mt-5">
        {loadError ? <LoadError message={loadError} onRetry={retry} />
          : !rows ? <p role="status" className={ui.hint}>Loading lessons...</p>
          : !rows.length ? <p className={`${ui.card} ${ui.hint}`}>No lessons yet. Select New lesson to add the first one.</p>
          : (
            <ul aria-label="Lessons" className="overflow-hidden rounded-xl border border-line bg-white">
              {rows.map((row) => <LessonRowItem key={row.lessonId} row={row} opening={busy === row.lessonNumber} onEdit={() => edit(row.lessonNumber)} />)}
            </ul>
          )}
      </div>
    </>
  );
}

export default function LessonsList() {
  return <LessonsFrame><ListContent /></LessonsFrame>;
}
