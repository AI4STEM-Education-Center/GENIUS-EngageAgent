"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Pencil } from "lucide-react";
import { CONFIDENCE_STEM, OPTION_LETTERS, type LessonChanges, type LessonDraftContent } from "@/lib/lessons";
import type { LessonDraft, LessonVersion } from "@/lib/lessons-store";
import { MISCONCEPTION_TEXT } from "@/lib/misconceptions";
import LessonChangesView from "./LessonChangesView";
import { editHref, formatMoment, goTo, LESSONS_HOME, lessonFetch, LessonApiError, LessonImagePreview, LessonsFrame, LoadError, messageOf, plural, ui } from "./lesson-ui";

type VersionRow = Omit<LessonVersion, "lesson"> & { title: string; taskCount: number };
type VersionDetail = Omit<LessonVersion, "lesson"> & { title: string; content: LessonDraftContent; previousVersion: number | null; changes: LessonChanges | null };
type VersionTask = { classId: string; assignmentId: string; teacher: { id: string; name: string }; className: string | null; taskTitle: string | null; quizPublished: boolean };
type Panel = "version" | "compare" | "tasks";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={ui.eyebrow}>{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-2">{children}</dd>
    </div>
  );
}

/** One version laid out to read. Nothing here can be changed. */
export function LessonReadOnly({ content }: { content: LessonDraftContent }) {
  const idea = content.coreIdeas.filter((text) => text.trim());
  return (
    <div className="grid min-w-0 gap-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label="Lesson title">{content.title}</Fact>
        <Fact label="Learning objective">{content.objective}</Fact>
        <Fact label="Topic">{content.topic}</Fact>
        <Fact label="Target concept">{content.targetConcept}</Fact>
      </dl>
      <section>
        <h4 className={ui.eyebrow}>Core ideas</h4>
        <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-sm text-ink-2">{idea.map((text, index) => <li key={index} className="break-words">{text}</li>)}</ol>
      </section>
      <section>
        <h4 className={ui.eyebrow}>Misconceptions</h4>
        <ul className="mt-2 grid gap-1.5 text-sm text-ink-2">
          {content.misconceptions.map((id) => <li key={id} className="break-words"><b className="font-semibold text-ink">{id}</b> {MISCONCEPTION_TEXT[id]}</li>)}
        </ul>
      </section>
      <section>
        <h4 className={ui.eyebrow}>Quiz items</h4>
        <p className={`mt-1 ${ui.hint}`}>Each one is followed by “{CONFIDENCE_STEM}”</p>
        <ol className="mt-3 grid gap-3">
          {content.quizItems.map((item, index) => (
            <li key={item.id} className="min-w-0 rounded-lg border border-line-2 p-3 text-sm text-ink-2">
              <p className="break-words font-semibold text-ink">Q{index + 1}. {item.stem}</p>
              {item.image && <div className="mt-2"><LessonImagePreview src={item.image} alt={`Picture for question ${index + 1}`} /></div>}
              <ul className="mt-2 grid gap-1.5">
                {OPTION_LETTERS.map((letter) => {
                  const ids = item.wrongOptionMisconceptions[letter];
                  return (
                    <li key={letter} className="break-words">
                      <b className="font-semibold">{letter}.</b> {item.options[letter]}
                      {item.correct === letter && <span className={`${ui.pill} ml-2 bg-ok-light text-ok`}><Check size={12} className="mr-1" aria-hidden="true" />Correct answer</span>}
                      {ids?.length ? <span className="ml-2 text-mute">({ids.join(", ")})</span> : null}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 break-words"><b className="font-semibold">Matched misconception:</b> {item.matchedMisconception ? `${item.matchedMisconception} ${MISCONCEPTION_TEXT[item.matchedMisconception] ?? ""}` : "None"}</p>
              <p className="mt-1 break-words"><b className="font-semibold">Explanation:</b> {item.explanation}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function TasksTable({ tasks }: { tasks: VersionTask[] }) {
  if (!tasks.length) return <p className={ui.hint}>No tasks use this version.</p>;
  return (
    <ul aria-label="Tasks using this version" className="grid gap-2">
      {tasks.map((task) => (
        <li key={`${task.classId}:${task.assignmentId}`} className="rounded-lg border border-line-2 p-3">
          <dl className="grid gap-3 sm:grid-cols-4">
            <Fact label="Class">{task.className ?? task.classId}</Fact>
            <Fact label="GENIUS lesson">{task.taskTitle ?? task.assignmentId}</Fact>
            <Fact label="Teacher">{task.teacher.name}</Fact>
            <Fact label="Quiz">{task.quizPublished ? "Published" : "Not published"}</Fact>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function VersionItem({ lessonNumber, row, current, hasPrevious }: { lessonNumber: number; row: VersionRow; current: boolean; hasPrevious: boolean }) {
  const headingId = useId(), panelId = useId();
  const [open, setOpen] = useState<Panel | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [tasks, setTasks] = useState<VersionTask[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (panel: Panel) => {
    setError("");
    const base = `/api/lessons/${lessonNumber}/versions/${row.version}`;
    try {
      if (panel === "tasks") setTasks((await lessonFetch<{ tasks: VersionTask[] }>(`${base}/tasks`)).tasks);
      else setDetail(await lessonFetch<VersionDetail>(base));
    } catch (loadFailure) { setError(messageOf(loadFailure)); }
  }, [lessonNumber, row.version]);

  function toggle(panel: Panel) {
    if (open === panel) { setOpen(null); return; }
    setOpen(panel);
    setError("");
    if (panel === "tasks" ? !tasks : !detail) void load(panel);
  }

  const button = (panel: Panel, label: string) => (
    <button type="button" onClick={() => toggle(panel)} aria-expanded={open === panel} aria-controls={open === panel ? panelId : undefined} aria-describedby={headingId}
      className={`${ui.secondary} ${open === panel ? "border-brand bg-brand-light text-brand-dark" : ""}`}>{label}</button>
  );
  const waiting = <p role="status" className={ui.hint}>Loading...</p>;

  return (
    <li className="min-w-0 border-b border-line-2 p-4 last:border-b-0 sm:p-5" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="text-base font-semibold text-ink">Version {row.version}</h2>
        <span className={`${ui.pill} bg-ok-light text-ok`}>Published</span>
        {current && <span className={`${ui.pill} bg-brand-light text-brand-dark`}>Current</span>}
      </div>
      <p className="mt-1 break-words text-sm text-ink-2">Published by {row.publishedBy.name} on {formatMoment(row.publishedAt)}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-2"><b className="font-semibold">Change note:</b> {row.changeNote}</p>
      <p className="mt-1 text-sm text-ink-2">{row.taskCount ? `${plural(row.taskCount, "task")} using it` : "No tasks using it"}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {button("version", "Open")}
        {hasPrevious && button("compare", "Compare with previous")}
        {button("tasks", "Show tasks")}
      </div>
      {open && (
        <div id={panelId} className="mt-3 min-w-0 rounded-lg bg-canvas p-4">
          {error ? <LoadError message={error} onRetry={() => { void load(open); }} />
            : open === "tasks" ? (tasks ? <TasksTable tasks={tasks} /> : waiting)
            : !detail ? waiting
            : open === "version" ? <LessonReadOnly content={detail.content} />
            : detail.changes ? (
              <>
                <h3 className="mb-3 text-sm font-semibold text-ink">What changed from version {detail.previousVersion} to version {row.version}</h3>
                <LessonChangesView changes={detail.changes} emptyMessage="Nothing changed between these two versions." />
              </>
            ) : <p className={ui.hint}>This is the first version, so there’s nothing to compare it with.</p>}
        </div>
      )}
    </li>
  );
}

function HistoryContent({ lessonNumber }: { lessonNumber: number }) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [draft, setDraft] = useState<LessonDraft | null>(null);
  const [error, setError] = useState("");
  const [editError, setEditError] = useState("");
  const [opening, setOpening] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const base = `/api/lessons/${lessonNumber}`;
    Promise.all([
      lessonFetch<{ versions: VersionRow[] }>(`${base}/versions`, { signal: controller.signal }),
      // Most lessons have no draft, which the route reports as not found.
      lessonFetch<{ draft: LessonDraft }>(`${base}/draft`, { signal: controller.signal }).catch((failure) => {
        if (failure instanceof LessonApiError && failure.status === 404) return { draft: null };
        throw failure;
      }),
    ]).then(([history, found]) => { setVersions(history.versions); setDraft(found.draft); })
      .catch((failure) => { if (!controller.signal.aborted) setError(messageOf(failure)); });
    return () => controller.abort();
  }, [lessonNumber, attempt]);

  async function edit() {
    setOpening(true); setEditError("");
    try {
      await lessonFetch<{ draft: LessonDraft }>(`/api/lessons/${lessonNumber}/draft`, { method: "POST", json: {} });
      goTo(editHref(lessonNumber));
    } catch (failure) { setEditError(messageOf(failure)); setOpening(false); }
  }

  const title = versions?.[0]?.title || draft?.content.title;
  return (
    <>
      <Link href={LESSONS_HOME} className={ui.textLink}><ArrowLeft size={15} aria-hidden="true" />Lessons</Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink">History</h1>
          <p className={`mt-1 break-words ${ui.hint}`}>Lesson {lessonNumber}{title ? `: ${title}` : ""}</p>
        </div>
        {versions && <button type="button" onClick={edit} disabled={opening} className={ui.secondary}><Pencil size={15} aria-hidden="true" />{opening ? "Opening..." : "Edit"}</button>}
      </div>
      {editError && <p role="alert" className="mt-4 rounded-lg border border-bad bg-bad-light p-3 text-sm text-bad">{editError}</p>}
      <div className="mt-5">
        {error ? <LoadError message={error} onRetry={() => { setError(""); setVersions(null); setAttempt((n) => n + 1); }} />
          : !versions ? <p role="status" className={ui.hint}>Loading history...</p>
          : (
            <ul aria-label="Versions, newest first" className="overflow-hidden rounded-xl border border-line bg-white">
              {draft && (
                <li className="min-w-0 border-b border-line-2 p-4 last:border-b-0 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-ink">Version {draft.version}</h2>
                    <span className={`${ui.pill} bg-info-light text-info`}>Draft</span>
                  </div>
                  <p className="mt-1 break-words text-sm text-ink-2">Last saved by {draft.updatedBy.name} on {formatMoment(draft.updatedAt)}. Not published yet.</p>
                </li>
              )}
              {versions.map((row, index) => (
                <VersionItem key={row.version} lessonNumber={lessonNumber} row={row} current={index === 0} hasPrevious={index < versions.length - 1} />
              ))}
              {!versions.length && !draft && <li className={`p-5 ${ui.hint}`}>This lesson has no versions yet.</li>}
            </ul>
          )}
      </div>
    </>
  );
}

export default function LessonHistory({ lessonNumber }: { lessonNumber: number }) {
  return <LessonsFrame><HistoryContent lessonNumber={lessonNumber} /></LessonsFrame>;
}
