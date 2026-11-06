"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, History, Trash2 } from "lucide-react";
import { LESSON_IMAGE_PATH, LESSON_IMAGE_TOO_LARGE, MAX_LESSON_IMAGE_BYTES } from "@/lib/lesson-images";
import { lessonProblems, type LessonChanges, type LessonProblem } from "@/lib/lessons";
import type { LessonActor, LessonDraft, LessonVersion } from "@/lib/lessons-store";
import LessonChangesView from "./LessonChangesView";
import LessonForm, { contentFromForm, fieldDomId, formFromContent, type LessonFormState } from "./LessonForm";
import { formatMoment, goTo, historyHref, LessonApiError, LessonDialog, lessonFetch, LessonsFrame, LESSONS_HOME, LoadError, messageOf, ui, useLessonToast } from "./lesson-ui";

type LeaveGuard = (proceed: () => void) => void;
type DraftInfo = { version: number; updatedBy: LessonActor; updatedAt: string };
type Preview = { version: number; problems: LessonProblem[]; changes: LessonChanges | null; suggestedNote: string };
/** Why a save was refused: someone changed the draft, published or discarded it, or the lesson was deleted. */
type Conflict = "changed" | "gone" | "deleted";

const SAVE_ERROR_401 = "You've been signed out. Sign in again in another tab, then select Save draft. What you typed is still here.";
const saveFailure = (error: unknown) => error instanceof LessonApiError && error.status === 401 ? SAVE_ERROR_401 : messageOf(error);

function goToField(field: string) {
  const element = document.getElementById(fieldDomId(field));
  element?.scrollIntoView?.({ block: "center" });
  element?.focus({ preventScroll: true });
}

function PublishedNotice({ lessonNumber, version }: { lessonNumber: number; version: number }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <div className={`${ui.card} mx-auto max-w-xl text-center`}>
      <CheckCircle2 size={32} className="mx-auto text-ok" aria-hidden="true" />
      <h1 ref={heading} tabIndex={-1} className="mt-3 text-xl font-semibold text-ink outline-none">Lesson {lessonNumber} version {version} published</h1>
      <p className={`mt-2 ${ui.hint}`}>New tasks get this version. Tasks that already use this lesson keep the version they have.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href={LESSONS_HOME} className={ui.primary}>Back to Lessons</Link>
        <Link href={historyHref(lessonNumber)} className={ui.secondary}>History</Link>
      </div>
    </div>
  );
}

function EditorContent({ lessonNumber, registerGuard }: { lessonNumber: number; registerGuard: (guard: LeaveGuard | null) => void }) {
  const draftUrl = `/api/lessons/${lessonNumber}/draft`, publishUrl = `/api/lessons/${lessonNumber}/publish`;
  const [phase, setPhase] = useState<"loading" | "error" | "no-draft" | "ready" | "published">("loading");
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<LessonFormState | null>(null);
  const [info, setInfo] = useState<DraftInfo | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [resolving, setResolving] = useState(false);
  const [confirmingLoad, setConfirmingLoad] = useState(false);
  const [checked, setChecked] = useState<LessonProblem[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [note, setNote] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishedVersion, setPublishedVersion] = useState(0);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState("");
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [announcement, setAnnouncement] = useState("");
  const { showToast, toastElement } = useLessonToast();

  const revision = useRef(0);
  const approvedLeave = useRef(false);
  const saveRunning = useRef<Promise<boolean> | null>(null);
  const scrollToProblems = useRef(false);

  const content = useMemo(() => form ? contentFromForm(form) : null, [form]);
  const currentJson = useMemo(() => content ? JSON.stringify(content) : "", [content]);
  const dirty = phase === "ready" && currentJson !== savedJson;
  const isUploading = Object.values(uploading).some(Boolean);
  const blocked = saving || checking || resolving || publishing;

  // Once the form differs from what was checked, the list follows the form, so question numbers stay right after a reorder.
  const problems = useMemo(() => {
    if (!checked || !content) return [];
    return dirty ? lessonProblems(content) : checked;
  }, [checked, content, dirty]);

  // What async work needs to see, as of now rather than when it started.
  const latest = useRef({ form, savedJson, conflict, dirty });
  useEffect(() => { latest.current = { form, savedJson, conflict, dirty }; });

  const applyDraft = useCallback((draft: LessonDraft) => {
    const next = formFromContent(draft.content);
    revision.current = draft.revision;
    setForm(next);
    setSavedJson(JSON.stringify(contentFromForm(next)));
    setInfo({ version: draft.version, updatedBy: draft.updatedBy, updatedAt: draft.updatedAt });
    setConflict(null); setSaveError(""); setChecked(null); setJustSaved(false);
    setPhase("ready");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    lessonFetch<{ draft: LessonDraft }>(draftUrl, { signal: controller.signal })
      .then(({ draft }) => applyDraft(draft))
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof LessonApiError && error.status === 404) { setPhase("no-draft"); return; }
        setLoadError(messageOf(error)); setPhase("error");
      });
    return () => controller.abort();
  }, [draftUrl, attempt, applyDraft]);

  useEffect(() => {
    if (!scrollToProblems.current || !problems.length) return;
    scrollToProblems.current = false;
    goToField(problems[0].field);
  }, [problems]);

  useEffect(() => {
    if (!dirty && !saving && !isUploading) return;
    const warn = (event: BeforeUnloadEvent) => { if (!approvedLeave.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving, isUploading]);

  useEffect(() => {
    registerGuard((proceed) => {
      if (latest.current.dirty) setPendingLeave(() => proceed);
      else proceed();
    });
    return () => registerGuard(null);
  }, [registerGuard]);

  const save = useCallback(() => {
    if (saveRunning.current) return saveRunning.current;
    const sending = latest.current.form;
    if (!sending) return Promise.resolve(false);
    const run = (async () => {
      const sent = contentFromForm(sending);
      setSaving(true); setSaveError(""); setJustSaved(false);
      try {
        const { draft } = await lessonFetch<{ draft: LessonDraft }>(draftUrl, { method: "PUT", json: { content: sent, revision: revision.current } });
        revision.current = draft.revision;
        setSavedJson(JSON.stringify(sent));
        setInfo({ version: draft.version, updatedBy: draft.updatedBy, updatedAt: draft.updatedAt });
        setChecked((previous) => previous && lessonProblems(sent));
        setJustSaved(true);
        return true;
      } catch (error) {
        if (error instanceof LessonApiError && error.status === 409) setConflict("changed");
        else if (error instanceof LessonApiError && error.status === 404) setConflict("gone");
        else setSaveError(saveFailure(error));
        return false;
      } finally { setSaving(false); }
    })().finally(() => { saveRunning.current = null; });
    saveRunning.current = run;
    return run;
  }, [draftUrl]);

  /** Opens whatever draft exists now, or starts a new one from the current version. */
  const reopenDraft = useCallback(async () => {
    try {
      return (await lessonFetch<{ draft: LessonDraft }>(draftUrl, { method: "POST", json: {} })).draft;
    } catch (error) {
      if (error instanceof LessonApiError && error.status === 404) setConflict("deleted");
      else setSaveError(saveFailure(error));
      return null;
    }
  }, [draftUrl]);

  /** Saves what's on this page over whatever is stored now. */
  async function keepMine() {
    setResolving(true); setSaveError("");
    const draft = await reopenDraft();
    if (draft) {
      revision.current = draft.revision;
      setInfo({ version: draft.version, updatedBy: draft.updatedBy, updatedAt: draft.updatedAt });
      setConflict(null);
      await save();
    }
    setResolving(false);
  }

  async function loadLatest() {
    setResolving(true); setSaveError("");
    const draft = await reopenDraft();
    if (draft) applyDraft(draft);
    setConfirmingLoad(false);
    setResolving(false);
  }

  async function startFromNoDraft() {
    setLoadError("");
    try {
      applyDraft((await lessonFetch<{ draft: LessonDraft }>(draftUrl, { method: "POST", json: {} })).draft);
    } catch (error) { setLoadError(messageOf(error)); }
  }

  /** Saves, checks, then either shows what's wrong or asks for the change note. Nothing is published yet. */
  async function startPublish() {
    setChecking(true); setSaveError(""); setPublishError("");
    try {
      if (latest.current.dirty && !await save()) return;
      const found = await lessonFetch<Preview>(publishUrl);
      if (found.problems.length) { showProblems(found.problems); return; }
      setChecked(null);
      setNote(found.suggestedNote);
      setPreview(found);
    } catch (error) { setSaveError(saveFailure(error)); }
    finally { setChecking(false); }
  }

  function showProblems(found: LessonProblem[]) {
    scrollToProblems.current = true;
    setChecked(found);
  }

  async function confirmPublish() {
    const changeNote = note.trim();
    if (!changeNote) { setPublishError("Add a change note."); return; }
    setPublishing(true); setPublishError("");
    try {
      const { version } = await lessonFetch<{ version: Omit<LessonVersion, "lesson"> }>(publishUrl, { method: "POST", json: { changeNote, revision: revision.current } });
      setPreview(null);
      setPublishedVersion(version.version);
      setPhase("published");
    } catch (error) {
      if (error instanceof LessonApiError && error.status === 409) { setPreview(null); setConflict("changed"); }
      else if (error instanceof LessonApiError && error.status === 404) { setPreview(null); setConflict("gone"); }
      else if (error instanceof LessonApiError && error.problems.length) { setPreview(null); showProblems(error.problems); }
      else setPublishError(saveFailure(error));
    } finally { setPublishing(false); }
  }

  async function discard() {
    setDiscarding(true); setDiscardError("");
    try {
      await lessonFetch<{ lessonDeleted: boolean }>(draftUrl, { method: "DELETE" });
    } catch (error) {
      // Already gone means someone else got there first, which is what was asked for.
      if (!(error instanceof LessonApiError && error.status === 404)) { setDiscardError(messageOf(error)); setDiscarding(false); return; }
    }
    approvedLeave.current = true;
    goTo(LESSONS_HOME);
  }

  async function uploadImage(itemId: string, file: File) {
    setUploading((current) => ({ ...current, [itemId]: true }));
    try {
      if (file.size > MAX_LESSON_IMAGE_BYTES) throw new LessonApiError(LESSON_IMAGE_TOO_LARGE, 413);
      const body = new FormData();
      body.set("file", file);
      const { url } = await lessonFetch<{ url: string }>(LESSON_IMAGE_PATH, { method: "POST", body });
      setForm((current) => current && { ...current, quizItems: current.quizItems.map((item) => item.id === itemId ? { ...item, image: url } : item) });
      setAnnouncement("Image added.");
    } catch (error) {
      // The picture failed, but nothing else should be lost with it.
      const saved = !latest.current.conflict && (!latest.current.dirty || await save());
      showToast(`The image couldn't be uploaded. ${messageOf(error)} ${saved ? "The rest of your draft is saved." : "Your other edits are still on this page, but aren't saved yet."}`);
    } finally {
      setUploading((current) => ({ ...current, [itemId]: false }));
    }
  }

  function leaveNow(proceed: () => void) {
    approvedLeave.current = true;
    setPendingLeave(null);
    proceed();
  }

  if (phase === "loading") return <p role="status" className={ui.hint}>Loading the draft...</p>;
  if (phase === "error") return <LoadError message={loadError} onRetry={() => { setPhase("loading"); setAttempt((n) => n + 1); }} />;
  if (phase === "published") return <PublishedNotice lessonNumber={lessonNumber} version={publishedVersion} />;
  if (phase === "no-draft" || !form || !info) {
    return (
      <div className={`${ui.card} mx-auto max-w-xl`}>
        <h1 className="text-xl font-semibold text-ink">This lesson has no draft</h1>
        <p className={`mt-2 ${ui.hint}`}>It may have been published or discarded. Select Edit to start a new draft from the current version.</p>
        {loadError && <p role="alert" className="mt-3 text-sm text-bad">{loadError}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={startFromNoDraft} className={ui.primary}>Edit</button>
          <Link href={LESSONS_HOME} className={ui.secondary}>Back to Lessons</Link>
        </div>
      </div>
    );
  }

  const neverPublished = info.version === 1;
  const status = saving ? "Saving..." : dirty ? "Unsaved changes" : justSaved ? "Draft saved" : `Last saved by ${info.updatedBy.name}, ${formatMoment(info.updatedAt)}`;

  return (
    <>
      <div inert={Boolean(checking || preview || confirmingDiscard || pendingLeave || confirmingLoad)}>
        <button type="button" onClick={() => latest.current.dirty ? setPendingLeave(() => () => goTo(LESSONS_HOME)) : goTo(LESSONS_HOME)} className={ui.textLink}>
          <ArrowLeft size={15} aria-hidden="true" />Lessons
        </button>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-mute">Lesson {lessonNumber} · Draft version {info.version}</p>
            <h1 className="mt-0.5 break-words text-2xl font-semibold text-ink">{form.title.trim() || "Untitled lesson"}</h1>
            <p className={`mt-1 ${ui.hint}`}>{neverPublished ? "Not published yet, so tasks can't use it." : `Version ${info.version - 1} stays as it is until you publish this one.`}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => latest.current.dirty ? setPendingLeave(() => () => goTo(historyHref(lessonNumber))) : goTo(historyHref(lessonNumber))} className={ui.secondary}>
              <History size={15} aria-hidden="true" />History
            </button>
            <button type="button" onClick={() => { setDiscardError(""); setConfirmingDiscard(true); }} disabled={blocked} className={ui.danger}>
              <Trash2 size={15} aria-hidden="true" />Discard draft
            </button>
          </div>
        </div>

        {conflict && (
          <div role="alert" className="mt-4 rounded-xl border border-warn bg-warn-light p-4 text-sm text-warn">
            <p className="font-semibold">
              {conflict === "changed" ? "Someone else changed this lesson while you were editing."
                : conflict === "gone" ? "Someone else published or discarded this draft while you were editing."
                : "Someone else deleted this lesson while you were editing, so it can't be saved."}
            </p>
            <p className="mt-1">{conflict === "deleted" ? "What you typed is still on this page. Copy anything you want to keep before you leave." : "What you typed is still here, but it hasn't been saved."}</p>
            {conflict !== "deleted" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={keepMine} disabled={resolving} className={ui.primary}>{resolving ? "Saving..." : "Keep my version"}</button>
                <button type="button" onClick={() => setConfirmingLoad(true)} disabled={resolving} className={ui.secondary}>Load the latest version</button>
              </div>
            )}
          </div>
        )}

        {problems.length > 0 && (
          <div role="alert" className="mt-4 rounded-xl border border-bad bg-bad-light p-4 text-sm text-bad">
            <p className="font-semibold">{problems.length === 1 ? "1 problem" : `${problems.length} problems`} to fix before this can be published. Nothing was published.</p>
            <ul className="mt-2 grid max-h-48 gap-1 overflow-y-auto">
              {problems.map((problem) => (
                <li key={`${problem.field}:${problem.message}`}>
                  <button type="button" onClick={() => goToField(problem.field)} className="text-left underline">{problem.message}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5">
          <LessonForm form={form} problems={problems} uploading={uploading} announce={setAnnouncement}
            onChange={(update) => { setJustSaved(false); setForm((current) => current && update(current)); }}
            onImage={(itemId, file) => { void uploadImage(itemId, file); }} />
        </div>

        <div className="sticky bottom-3 z-30 mt-5 grid gap-2 rounded-xl border border-line bg-white p-3 shadow-lg">
          {saveError && <p role="alert" className="text-sm font-medium text-bad">{saveError}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p role="status" className="min-w-0 flex-1 basis-40 text-sm text-mute">{status}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { void save(); }} disabled={blocked || Boolean(conflict)} className={ui.secondary}>{saving ? "Saving..." : "Save draft"}</button>
              <button type="button" onClick={() => { void startPublish(); }} disabled={blocked || isUploading || Boolean(conflict)} className={ui.primary}>{checking ? "Checking..." : "Publish version"}</button>
            </div>
          </div>
        </div>
      </div>

      <p role="status" className="sr-only">{announcement}</p>
      {toastElement}

      {preview && (
        <LessonDialog wide title={`Publish version ${preview.version}`} closeLocked={publishing} onClose={() => setPreview(null)}
          footer={<>
            <button type="button" onClick={() => setPreview(null)} disabled={publishing} className={ui.secondary}>Cancel</button>
            <button type="button" onClick={() => { void confirmPublish(); }} disabled={publishing} className={ui.primary}>{publishing ? "Publishing..." : `Publish version ${preview.version}`}</button>
          </>}>
          {preview.changes ? (
            <section className="min-w-0">
              <h3 className="mb-2 text-sm font-semibold text-ink">What changed since version {preview.version - 1}</h3>
              <LessonChangesView changes={preview.changes} emptyMessage={`Nothing has changed since version ${preview.version - 1}. Publishing makes an identical version.`} />
            </section>
          ) : <p className={ui.hint}>This is the first version of this lesson.</p>}
          <div className="grid gap-1.5">
            <label htmlFor="lesson-change-note" className={ui.label}>Change note</label>
            <textarea id="lesson-change-note" rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} className={ui.input}
              aria-describedby="lesson-change-note-hint" />
            <p id="lesson-change-note-hint" className={ui.hint}>Saved with this version so other teachers can see why it changed.</p>
          </div>
          {publishError && <p role="alert" className="text-sm font-medium text-bad">{publishError}</p>}
        </LessonDialog>
      )}

      {confirmingDiscard && (
        <LessonDialog title="Discard this draft?" closeLocked={discarding} onClose={() => setConfirmingDiscard(false)}
          footer={<>
            <button type="button" onClick={() => setConfirmingDiscard(false)} disabled={discarding} className={ui.secondary}>Keep editing</button>
            <button type="button" onClick={() => { void discard(); }} disabled={discarding} className={ui.dangerSolid}>{discarding ? "Discarding..." : "Discard draft"}</button>
          </>}>
          <p className="text-sm text-ink-2">
            {neverPublished
              ? "This lesson was never published, so the whole lesson is deleted with its draft. This can't be undone."
              : `Your changes for version ${info.version} are deleted. Version ${info.version - 1} stays as it is. This can't be undone.`}
          </p>
          {discardError && <p role="alert" className="text-sm font-medium text-bad">{discardError}</p>}
        </LessonDialog>
      )}

      {confirmingLoad && (
        <LessonDialog title="Load the latest version?" closeLocked={resolving} onClose={() => setConfirmingLoad(false)}
          footer={<>
            <button type="button" onClick={() => setConfirmingLoad(false)} disabled={resolving} className={ui.secondary}>Keep what I typed</button>
            <button type="button" onClick={() => { void loadLatest(); }} disabled={resolving} className={ui.dangerSolid}>{resolving ? "Loading..." : "Load the latest version"}</button>
          </>}>
          <p className="text-sm text-ink-2">This replaces what you typed on this page with the latest saved version. What you typed since your last save is lost.</p>
        </LessonDialog>
      )}

      {pendingLeave && (
        <LessonDialog title="Leave without saving?" closeLocked={saving} onClose={() => setPendingLeave(null)}
          footer={<>
            <button type="button" onClick={() => setPendingLeave(null)} disabled={saving} className={ui.secondary}>Keep editing</button>
            <button type="button" onClick={() => leaveNow(pendingLeave)} disabled={saving} className={ui.secondary}>Leave without saving</button>
            <button type="button" disabled={saving || Boolean(conflict)} className={ui.primary}
              onClick={async () => { if (await save()) leaveNow(pendingLeave); else setPendingLeave(null); }}>{saving ? "Saving..." : "Save draft and leave"}</button>
          </>}>
          <p className="text-sm text-ink-2">You have changes on this page that aren’t saved yet.</p>
        </LessonDialog>
      )}
    </>
  );
}

/** Add or change a lesson (UC 2.1, 2.2). The page frame's links ask before leaving unsaved changes. */
export default function LessonEditor({ lessonNumber }: { lessonNumber: number }) {
  const guard = useRef<LeaveGuard | null>(null);
  const registerGuard = useCallback((next: LeaveGuard | null) => { guard.current = next; }, []);
  const beforeNavigate = useCallback<LeaveGuard>((proceed) => { if (guard.current) guard.current(proceed); else proceed(); }, []);
  return <LessonsFrame beforeNavigate={beforeNavigate}><EditorContent lessonNumber={lessonNumber} registerGuard={registerGuard} /></LessonsFrame>;
}
