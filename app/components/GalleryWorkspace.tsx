"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Save, Send } from "lucide-react";
import type { UserContext } from "@/lib/auth";
import type { GalleryCopy, GalleryMaterial, SavedGalleryCopySummary } from "@/lib/material-gallery";
import { galleryCopyAttribution, prepareGalleryDelivery, listSavedGalleryCopies, loadSavedGalleryCopy, refreshGalleryCopyMedia, saveGalleryCopy } from "@/lib/material-gallery-client";
import GalleryCopyDetails from "./GalleryCopyDetails";
import SavedMaterialsPanel from "./SavedMaterialsPanel";
import type { StrategyFocus } from "@/lib/strategy-focus";
import { scopedTaskFetch } from "@/lib/client-auth";
import { useTaskLesson } from "@/lib/lesson-client";
import type { SlideDeck } from "@/lib/slides/model";
import MaterialGalleryPanel from "./MaterialGalleryPanel";
import SlidesWorkspace from "./SlidesWorkspace";
import VideoMaterialEditor from "./VideoMaterialEditor";
import VideoAdaptation from "./VideoAdaptation";
import ShareVideoMaterial from "./ShareVideoMaterial";
import MaterialActivityView from "./MaterialActivityView";
import SendMaterialDialog from "./SendMaterialDialog";
import { publishSlideDeck } from "@/lib/slides/publish-client";
import type { GalleryScope } from "@/lib/material-gallery";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50";
const primary = `${button} !border-brand !bg-brand !text-white hover:!bg-brand-dark`;
const copyId = (copy: GalleryCopy) => copy.format === "slides" ? copy.deck.id : copy.item.id.replace(/^gallery-copy-/, "");
type Editor = { copy: GalleryCopy; revision: number; savedAt?: string };
type LeaveGuard = (proceed: () => void) => void;
type HistoryNavigation = EventTarget & { traverseTo: (key: string) => { committed: Promise<unknown>; finished: Promise<unknown> } };
type HistoryNavigateEvent = Event & { navigationType?: string; destination?: { key?: string; sameDocument?: boolean } };
type Props = { user: UserContext; initialCopy?: GalleryCopy; taskTitle?: string; recommendation?: { lessonNumber: number; strategy: string; focus?: StrategyFocus }; onBack: () => void; onPublished?: () => void; registerLeaveGuard?: (guard: LeaveGuard | null) => void };

/** A separate task-scoped library/editor. It never changes the generation workflow's draft or strategy. */
export default function GalleryWorkspace({ user, initialCopy, taskTitle, recommendation, onBack, onPublished, registerLeaveGuard }: Props) {
  const classId = user.classId || "", assignmentId = user.assignmentId || "";
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"shared" | "saved">("shared");
  const [format, setFormat] = useState<"slides" | "video">("slides");
  const [saved, setSaved] = useState<SavedGalleryCopySummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const initialOpened = useRef(false);
  useEffect(() => { if (initialCopy && !initialOpened.current) { initialOpened.current = true; openEditor(initialCopy); } }, [initialCopy]);
  const [attribution, setAttribution] = useState<Partial<GalleryMaterial> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const working = useRef<GalleryCopy | null>(null);
  const [currentCopy, setCurrentCopy] = useState<GalleryCopy | null>(null);
  const baseline = useRef<SlideDeck | GalleryCopy | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slideBusy, setSlideBusy] = useState(false);
  const [videoEditing, setVideoEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const requests = useRef(new Set<AbortController>());
  const mounted = useRef(true);
  const saving = useRef(false);
  const approvedLeave = useRef(false);
  const activeId = editor ? copyId(editor.copy) : "";
  const slideLesson = useTaskLesson({ classId, assignmentId }, editor?.copy.format === "slides" ? editor.copy.deck.lessonNumber : null);
  const keepEditing = useCallback(() => { pendingLeaveRef.current = null; setPendingLeave(null); }, []);
  useEffect(() => {
    setAttribution(null);
    if (!activeId) return;
    const controller = new AbortController();
    galleryCopyAttribution({ classId, assignmentId }, activeId, controller.signal).then(value => {
      if (!controller.signal.aborted) setAttribution(value);
    }).catch(() => { /* Attribution is optional for legacy/offline materials; never block editing. */ });
    return () => controller.abort();
  }, [activeId, classId, assignmentId, refresh]);

  useEffect(() => {
    const requestSet = requests.current;
    mounted.current = true;
    return () => { mounted.current = false; requestSet.forEach(request => request.abort()); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); requests.current.add(controller);
    setListLoading(true);
    listSavedGalleryCopies({ classId, assignmentId }, controller.signal).then(result => {
      if (!controller.signal.aborted) setSaved(result.items);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load your saved materials."); })
      .finally(() => { requests.current.delete(controller); if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [classId, assignmentId, refresh]);

  const requestLeave = useCallback<LeaveGuard>(proceed => {
    if (videoEditing) { setNotice("Finish editing the video before leaving. Apply your changes or cancel the editor."); return; }
    if (busy || slideBusy) { setNotice("Wait for the current operation to finish."); return; }
    if (dirty) { pendingLeaveRef.current = proceed; setPendingLeave(() => proceed); }
    else proceed();
  }, [busy, slideBusy, dirty, videoEditing]);
  useEffect(() => {
    const dialog = leaveDialog.current;
    if (pendingLeave && dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-keep-editing]")?.focus();
    } else if (!pendingLeave && dialog?.open) dialog.close();
  }, [pendingLeave]);
  useEffect(() => { registerLeaveGuard?.(requestLeave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, requestLeave]);
  useEffect(() => {
    if (!dirty && !videoEditing && !busy && !slideBusy) return;
    const warn = (event: BeforeUnloadEvent) => { if (!approvedLeave.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, videoEditing, busy, slideBusy]);
  useEffect(() => {
    if (!dirty && !busy && !slideBusy && !videoEditing) return;
    const navigation = (window as Window & { navigation?: HistoryNavigation }).navigation;
    if (!navigation || typeof navigation.traverseTo !== "function") return;
    // Unlike popstate, navigate can cancel before Next's history traversal.
    // Resume the exact destination entry after confirmation; never add dummy
    // history entries or counteract Back/Forward with history.go(). Native
    // beforeunload still protects full-page exits; unsupported/noncancelable
    // same-document traversals cannot be blocked through this API.
    const guard = (event: Event) => {
      const historyEvent = event as HistoryNavigateEvent;
      const destination = historyEvent.destination;
      if (approvedLeave.current || event.defaultPrevented || !event.cancelable
        || historyEvent.navigationType !== "traverse" || !destination?.sameDocument || !destination.key) return;
      event.preventDefault();
      const key = destination.key;
      requestLeave(() => {
        approvedLeave.current = true;
        const failed = () => {
          approvedLeave.current = false;
          if (mounted.current) setError("Navigation could not finish. Your material is still open; try again.");
        };
        try {
          const result = navigation.traverseTo(key);
          void Promise.all([result.committed, result.finished]).catch(failed);
        } catch { failed(); }
      });
    };
    navigation.addEventListener("navigate", guard);
    return () => navigation.removeEventListener("navigate", guard);
  }, [dirty, busy, slideBusy, videoEditing, requestLeave]);

  function openEditor(copy: GalleryCopy, revision = 0, savedAt?: string) {
    approvedLeave.current = false;
    const value = { copy, revision, savedAt };
    editorRef.current = value; working.current = copy; baseline.current = copy.format === "slides" ? copy.deck : copy;
    setCurrentCopy(copy); setEditor(value); setDirty(revision === 0); setError(""); setNotice("");
  }
  function closeEditor() {
    editorRef.current = null; working.current = null; baseline.current = null;
    setCurrentCopy(null); setEditor(null); setDirty(false); setError(""); setNotice(""); setTab("saved");
  }
  async function openSaved(id: string) {
    const controller = new AbortController(); requests.current.add(controller); setBusy(true); setError("");
    try {
      const value = await loadSavedGalleryCopy({ classId, assignmentId }, id, controller.signal);
      if (!controller.signal.aborted) openEditor(value.copy, value.revision, value.savedAt);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to open this material."); }
    finally { requests.current.delete(controller); if (!controller.signal.aborted) setBusy(false); }
  }
  const saveCopy = useCallback(async (copy: GalleryCopy) => {
    const current = editorRef.current;
    if (!current || copyId(current.copy) !== copyId(copy)) throw new Error("Open this material again before saving.");
    if (saving.current) throw new Error("A save is already in progress.");
    const controller = new AbortController(); requests.current.add(controller); saving.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await saveGalleryCopy({ classId, assignmentId }, copy, current.revision, controller.signal);
      controller.signal.throwIfAborted();
      if (!mounted.current || !editorRef.current || copyId(editorRef.current.copy) !== result.copyId) throw new DOMException("This editor was closed.", "AbortError");
      const savedCopy = copy;
      working.current = savedCopy;
      const next = { copy: savedCopy, revision: result.revision, savedAt: result.savedAt };
      editorRef.current = next; baseline.current = savedCopy.format === "slides" ? savedCopy.deck : savedCopy;
      setCurrentCopy(savedCopy); setEditor(next); setDirty(false); setNotice("Saved to your materials. Students see it only when you send it."); setRefresh(value => value + 1);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Your changes could not be saved.");
      throw reason;
    } finally { requests.current.delete(controller); saving.current = false; if (mounted.current) setBusy(false); }
  }, [classId, assignmentId]);
  const saveSlides = useCallback(async (deck: SlideDeck) => {
    const copy = working.current;
    if (!copy || copy.format !== "slides" || copy.deck.id !== deck.id) throw new Error("Open this slide deck again before saving.");
    await saveCopy({ ...copy, deck: { ...deck, gallerySource: copy.source } });
    // The editor retains the exact deck object; use it to track later changes.
    baseline.current = deck;
  }, [saveCopy]);
  const changedSlides = useCallback((deck: SlideDeck) => {
    const copy = working.current;
    if (!copy || copy.format !== "slides" || copy.deck.id !== deck.id) return;
    approvedLeave.current = false;
    working.current = { ...copy, deck: { ...deck, gallerySource: copy.source } };
    setCurrentCopy(working.current);
    setDirty(editorRef.current?.revision === 0 || baseline.current !== deck);
  }, []);
  const onSlideBusy = useCallback((_strategy: string, value: boolean) => setSlideBusy(value), []);
  const onVideoEditingChange = useCallback((editing: boolean) => {
    setVideoEditing(editing);
    if (editing) { approvedLeave.current = false; keepEditing(); }
    else setNotice(current => current.startsWith("Finish editing the video") ? "" : current);
  }, [keepEditing]);
  const changedVideo = useCallback((item: import("@/lib/types").ContentItem) => {
    const current = working.current;
    if (current?.format !== "video" || current.item.id !== item.id || !item.gallerySource) return;
    approvedLeave.current = false;
    const next: GalleryCopy = { ...current, item: item as typeof current.item };
    working.current = next; setCurrentCopy(next); setEditor(previous => previous ? { ...previous, copy: next } : previous); setDirty(true); setNotice("");
  }, []);

  // An unpublished copy still needs fresh signed media after restoration or returning to this tab.
  useEffect(() => {
    const copy = working.current;
    if (copy?.format !== "video") return;
    const requestSet = requests.current;
    const controller = new AbortController(); requestSet.add(controller);
    let refreshing = false;
    const renew = async () => {
      if (refreshing || controller.signal.aborted || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const revision = editorRef.current?.revision || 0;
        const media = revision > 0
          ? (await loadSavedGalleryCopy({ classId, assignmentId }, copyId(copy), controller.signal)).copy
          : { format: "video", media: await refreshGalleryCopyMedia({ classId, assignmentId }, copy.item.id, controller.signal) };
        if (controller.signal.aborted || media.format !== "video" || working.current?.format !== "video" || copyId(working.current) !== copyId(copy)) return;
        working.current = { ...working.current, media: media.media };
        setEditor(previous => previous?.copy.format === "video" ? { ...previous, copy: { ...previous.copy, media: media.media } } : previous);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The video could not refresh. Reopen your saved material to try again."); }
      finally { refreshing = false; }
    };
    void renew(); const interval = window.setInterval(() => void renew(), 8 * 60_000);
    const visible = () => { if (document.visibilityState === "visible") void renew(); };
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); requestSet.delete(controller); window.clearInterval(interval); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [activeId, classId, assignmentId]);

  async function sendMaterial(destination: GalleryScope) {
    const copy = working.current;
    if (!copy || busy || videoEditing) throw new Error("Finish editing before sending.");
    const controller = new AbortController(); requests.current.add(controller);
    try {
      await saveCopy(copy); controller.signal.throwIfAborted(); setBusy(true);
      if (copy.format === "slides") await publishSlideDeck(copy.deck, destination, controller.signal);
      else {
        const deliveryId = await prepareGalleryDelivery(destination, copyId(copy), controller.signal);
        const response = await scopedTaskFetch(destination, "/api/content-publish", {
          method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...destination, contentItems: [{ ...copy.item, id: deliveryId, media: copy.media, galleryWorkspace: true }] }),
        });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to send this material.");
      }
      if (!controller.signal.aborted) { setNotice("Sent to students. Your saved material remains in your library."); onPublished?.(); }
    } finally { requests.current.delete(controller); if (mounted.current) setBusy(false); }
  }
  async function saveAndLeave() {
    const copy = working.current, proceed = pendingLeaveRef.current;
    if (!copy || videoEditing || !proceed) return;
    try {
      await saveCopy(copy);
      // Escape/Keep editing can cancel the navigation while the save finishes.
      if (pendingLeaveRef.current !== proceed) return;
      keepEditing(); approvedLeave.current = true; proceed();
    } catch { /* Retain editor and error. */ }
  }
  const disabled = busy || slideBusy;
  return <section aria-label="Gallery workspace" className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Gallery</h1><p className="mt-1 text-sm text-mute">Browse, edit and save materials across your classes. Choose a class only when sending.</p></div>
      <button type="button" className={button} disabled={disabled} onClick={() => requestLeave(onBack)}><ArrowLeft size={16} />{classId ? "Back to task" : "My classes"}</button>
    </div>
    {error && !pendingLeave && <p role="alert" className="rounded-lg bg-bad-light p-3 text-sm text-bad">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-ok-light p-3 text-sm">{notice}</p>}
    {editor ? <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={button} disabled={disabled} onClick={() => requestLeave(closeEditor)}><ArrowLeft size={16} />Back to Gallery</button>
        <span className="text-sm text-mute">{dirty ? "Unsaved changes" : editor.savedAt ? "Saved to your materials" : "Your editable copy"}</span>
      </div>
      <p className="text-sm text-mute">{editor.copy.source.private ? "Your private material." : `Your copy of “${editor.copy.source.title}”.`} Changes stay private until you share or send.</p>
      {currentCopy && <GalleryCopyDetails copy={currentCopy} revision={editor.revision} savedAt={editor.savedAt} dirty={dirty} owner={user.name} source={attribution} />}
      {editor.copy.format === "slides" ? !slideLesson.lesson ? <p role={slideLesson.error ? "alert" : "status"} className="text-sm text-mute">{slideLesson.error || "Loading the lesson…"}</p> : <fieldset disabled={busy} className="min-w-0"><SlidesWorkspace key={activeId} user={user}
        embeddedContext={{ lessonNumber: editor.copy.deck.lessonNumber, strategy: editor.copy.deck.strategy, classroomContext: editor.copy.deck.classroomContext, focus: editor.copy.deck.focus }}
        incomingDeck={editor.copy.deck} adaptation={editor.copy.adaptation} incomingDeckSaved={editor.revision > 0} draftNamespace={`gallery:${activeId}`} compactEditor
        onSaveDraft={saveSlides} onDraftChange={changedSlides} onRequestSend={deck => { changedSlides(deck); setSending(true); }} onBusyChange={onSlideBusy} onPublished={onPublished} /></fieldset>
        : <article className="rounded-xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{editor.copy.item.title}</h2><a className={button} href={`/api/download?${new URLSearchParams({ url: editor.copy.media.video, filename: "EngageAgent-video.mp4" })}`} download="EngageAgent-video.mp4">Download video</a></div>
          <div className="my-4 flex flex-wrap gap-2">
            <VideoMaterialEditor item={editor.copy.item} videoUrl={editor.copy.media.video} imageUrl={editor.copy.media.image} disabled={disabled} draftOnly onEditingChange={onVideoEditingChange}
              onChange={changedVideo} />
            <button type="button" className={button} disabled={disabled || videoEditing} onClick={() => { if (working.current) void saveCopy(working.current).catch(() => {}); }}><Save size={16} />{busy ? "Saving…" : "Save changes"}</button>
            <button type="button" className={primary} disabled={disabled || videoEditing} onClick={() => setSending(true)}><Send size={16} />Send to students</button>
          </div>
          <VideoAdaptation key={activeId} scope={{ classId, assignmentId }} item={editor.copy.item} adaptation={editor.copy.adaptation} disabled={disabled || videoEditing} onChange={changedVideo} onBusyChange={setSlideBusy} />
          <details className="mb-4"><summary className="cursor-pointer text-sm font-semibold">Share with teachers</summary><ShareVideoMaterial scope={{ classId, assignmentId }} item={editor.copy.item} lessonNumber={editor.copy.item.lessonNumber!} focus={editor.copy.item.focus ? { misconceptions: editor.copy.item.focus.misconceptions || [], coreIdeas: editor.copy.item.focus.coreIdeas || [] } : undefined} videoUrl={editor.copy.media.video} imageUrl={editor.copy.media.image} disabled={disabled || videoEditing} onShared={() => setRefresh(value => value + 1)} /></details>
          {editor.copy.item.activity ? <MaterialActivityView activity={editor.copy.item.activity} preview media={editor.copy.media} />
            : <><video aria-label="Gallery video" src={editor.copy.media.video} poster={editor.copy.media.image} controls playsInline className="my-4 max-h-96 w-full rounded-lg" /><p className="whitespace-pre-wrap">{editor.copy.item.body}</p></>}
        </article>}
    </div> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Gallery collection" className="flex gap-2">
          <button type="button" className={tab === "shared" ? primary : button} aria-pressed={tab === "shared"} onClick={() => setTab("shared")}>Browse materials</button>
          <button type="button" className={tab === "saved" ? primary : button} aria-pressed={tab === "saved"} onClick={() => setTab("saved")}>My saved materials</button>
        </div>
        <div role="group" aria-label="Gallery material type" className="flex gap-2">{(["slides", "video"] as const).map(value => <button key={value} type="button" className={format === value ? primary : button} aria-pressed={format === value} onClick={() => setFormat(value)}>{value === "slides" ? "Slides" : "Video"}</button>)}</div>
      </div>
      {tab === "shared" ? <MaterialGalleryPanel scope={{ classId, assignmentId }} lessonNumber={recommendation?.lessonNumber || 0} strategy={recommendation?.strategy || ""} focus={recommendation?.focus} format={format} standalone disabled={busy} onUse={copy => openEditor(copy)} />
        : <SavedMaterialsPanel key={format} items={saved} format={format} loading={listLoading} busy={busy} onOpen={id => void openSaved(id)} />}
    </>}
    {sending && <SendMaterialDialog current={classId && assignmentId ? { classId, assignmentId } : undefined} className={user.className} taskTitle={taskTitle} onClose={() => setSending(false)} onSend={sendMaterial} />}
    <dialog ref={leaveDialog} role="alertdialog" aria-label="Save your Gallery changes" aria-modal="true"
      onCancel={event => { event.preventDefault(); keepEditing(); }}
      onClose={() => { if (!leaveDialog.current?.open) keepEditing(); }}
      className="fixed inset-0 m-auto max-h-[90vh] w-[94vw] max-w-lg overflow-auto rounded-xl border border-warn bg-white p-6 shadow-xl backdrop:bg-ink/50">
      <p className="font-semibold">Save your changes before leaving?</p><p className="mt-2 text-sm">Your last saved version will remain available in My saved materials.</p>
      {pendingLeave && error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" data-keep-editing className={button} onClick={keepEditing}>Keep editing</button>
        <button className={button} disabled={disabled} onClick={() => { const proceed = pendingLeaveRef.current; keepEditing(); approvedLeave.current = true; proceed?.(); }}>Discard changes</button>
        <button className={primary} disabled={disabled} onClick={() => void saveAndLeave()}>Save and leave</button></div>
    </dialog>
  </section>;
}
