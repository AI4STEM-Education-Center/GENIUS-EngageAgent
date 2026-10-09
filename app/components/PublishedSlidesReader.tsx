"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, RefreshCw, X } from "lucide-react";
import type { SlideElement } from "@/lib/slides/layout";
import { isPublishedSlideResponse, type PublishedSlideResponse } from "@/lib/slides/publication";
import SlideCanvas from "./SlideCanvas";
import { scopedClientAuthHeaders } from "@/lib/client-auth";
import { GENIUS_LAUNCH_UPGRADE_CODE, GENIUS_LAUNCH_UPGRADE_MESSAGE } from "@/lib/slides/access-errors";

type Props = {
  classId: string;
  assignmentId: string;
  publicationId: string;
  audience: "teacher" | "student";
  onQuestion?: () => void;
};

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50";
const REFRESH_MS = 8 * 60 * 1000;

function SlideText({ elements }: { elements: SlideElement[] }) {
  // The canvas is the visual reading surface. Keep its text and image
  // descriptions available to assistive technology without repeating the slide.
  return <section aria-label="Slide text" className="sr-only">
    {elements.filter(element => element.id !== "step-number" && element.id !== "question-card").map(element => element.kind === "image"
      ? <p key={element.id} className="whitespace-pre-line break-words text-sm text-slate-600"><span className="font-semibold">Image description: </span>{element.alt}</p>
      : element.id === "title" ? <h4 key={element.id} className="break-words text-lg font-semibold">{element.text}</h4>
        : <p key={element.id} className={`whitespace-pre-line break-words ${element.bold ? "font-semibold" : ""}`}>{element.text}</p>)}
  </section>;
}

function Reader({ classId, assignmentId, publicationId, audience, onQuestion }: Props) {
  const [publication, setPublication] = useState<PublishedSlideResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [prediction, setPrediction] = useState("");
  const [recordedPrediction, setRecordedPrediction] = useState("");
  const [expanded, setExpanded] = useState(false);
  const predictionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const questionRequested = useRef(false);
  const refresh = useRef<() => void>(() => {});
  const lastImageRefresh = useRef(-Infinity);

  useEffect(() => {
    let active = true;
    let request: AbortController | null = null;
    const load = async () => {
      request?.abort();
      const controller = new AbortController(); request = controller;
      const timeout = setTimeout(() => controller.abort(), 20_000);
      setLoading(true);
      try {
        const query = new URLSearchParams({ classId, assignmentId, publicationId });
        const headers = scopedClientAuthHeaders({ classId, assignmentId });
        const response = await fetch(`/api/slides/publication?${query}`, { headers, signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          let message = response.status === 401 || response.status === 403
            ? "Sign in to this class to read these slides." : "Unable to load the published slides. Please retry.";
          if (response.status === 401 && headers.Authorization) {
            message = "Your GENIUS session is no longer valid. Reopen this task in GENIUS to continue reading the slides.";
            const failure: unknown = await response.json().catch(() => null);
            // This code is emitted only after the server verifies the launch.
            // Unknown responses retain session guidance; never display arbitrary error text.
            if (failure && typeof failure === "object" && "code" in failure && failure.code === GENIUS_LAUNCH_UPGRADE_CODE) {
              message = GENIUS_LAUNCH_UPGRADE_MESSAGE;
            }
          }
          throw new Error(message);
        }
        const value: unknown = await response.json();
        if (!isPublishedSlideResponse(value) || value.publicationId !== publicationId) throw new Error("The published slides could not be read. Please retry.");
        if (active && request === controller && !controller.signal.aborted) {
          setPublication(value); setError("");
        }
      } catch (reason) {
        if (active && request === controller) setError(controller.signal.aborted
          ? "Loading the slides took too long. Please retry." : reason instanceof Error ? reason.message : "Unable to load the published slides. Please retry.");
      } finally {
        clearTimeout(timeout);
        if (active && request === controller) { request = null; setLoading(false); }
      }
    };
    refresh.current = () => { void load(); };
    void load();
    const interval = setInterval(() => { void load(); }, REFRESH_MS);
    return () => { active = false; request?.abort(); clearInterval(interval); refresh.current = () => {}; };
  }, [classId, assignmentId, publicationId]);

  useEffect(() => {
    if (expanded) {
      wasExpanded.current = true;
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (wasExpanded.current) {
      wasExpanded.current = false;
      if (questionRequested.current) { questionRequested.current = false; onQuestion?.(); }
      else expandButton.current?.focus();
    }
  }, [expanded, onQuestion]);

  const page = publication?.manifest.pages[index];
  const elements = useMemo<SlideElement[]>(() => page?.elements.map(element => element.kind === "image"
    ? { id: element.id, kind: "image", frame: element.frame, fit: element.fit, alt: element.alt, data: publication?.assets[element.assetId]?.url }
    : element) ?? [], [page, publication]);
  const isStudent = audience === "student";
  const needsPrediction = isStudent && publication?.manifest.strategy === "cognitive conflict" && page?.stage === "prediction";
  const canAdvance = !needsPrediction || /[\p{L}\p{N}]/u.test(recordedPrediction || prediction);
  const last = !!publication && index === publication.manifest.pages.length - 1;

  function next() {
    if (!publication || last || !canAdvance) return;
    if (needsPrediction && !recordedPrediction) setRecordedPrediction(prediction.trim());
    setIndex(current => current + 1);
  }
  function imageFailed() {
    if (loading) return;
    // One automatic renewal per burst; a broken asset must not create a fetch loop.
    if (Date.now() - lastImageRefresh.current < 30_000) {
      setError("A slide image could not load. Retry loading the slides."); return;
    }
    lastImageRefresh.current = Date.now(); refresh.current();
  }
  function openQuestions() {
    if (!expanded) { onQuestion?.(); return; }
    questionRequested.current = true;
    dialog.current?.close(); setExpanded(false);
    // The effect moves focus only after the modal has closed and unmounted.
  }
  const controls = <div className="my-3 flex flex-wrap items-center justify-between gap-2">
    <button type="button" className={button} aria-label="Previous slide" disabled={index === 0} onClick={() => setIndex(current => current - 1)}><ChevronLeft size={18} aria-hidden="true" />Previous</button>
    <span aria-live="polite" className="text-sm tabular-nums">Slide {index + 1} of {publication?.manifest.pages.length ?? 0}</span>
    <button type="button" className={button} aria-label="Next slide" disabled={last || !canAdvance} onClick={next}>Next<ChevronRight size={18} aria-hidden="true" /></button>
  </div>;

  if (!publication) return <section aria-label="Published slides" className="my-4 rounded-lg border border-slate-200 p-4">
    {loading ? <p role="status">Loading slides...</p> : <><p role="alert" className="text-sm text-red-800">{error}</p><button type="button" className={`${button} mt-3`} onClick={() => refresh.current()}><RefreshCw size={16} aria-hidden="true" />Retry slides</button></>}
  </section>;
  if (!page) return <p role="alert">This slide is unavailable.</p>;

  const content = (inDialog: boolean) => <>
    {isStudent && page.stage === "compare" && recordedPrediction && <section aria-label="Your recorded prediction" className="mb-4 rounded-md border border-teal-200 bg-teal-50 p-4 text-slate-800">
      <h4 className="font-semibold">Your prediction</h4><p className="mt-1 whitespace-pre-wrap break-words">{recordedPrediction}</p>
    </section>}
    <SlideCanvas elements={elements} title={page.title} index={index} ariaHidden onImageError={imageFailed} />
    <SlideText elements={elements} />
    {needsPrediction && <div className="mt-4">
      <label htmlFor={`${predictionId}${inDialog ? "-expanded" : ""}`} className="text-sm font-semibold text-slate-800">Your prediction</label>
      <textarea id={`${predictionId}${inDialog ? "-expanded" : ""}`} rows={3} maxLength={2000} value={recordedPrediction || prediction}
        readOnly={!!recordedPrediction} onChange={event => setPrediction(event.target.value)}
        className="mt-2 block w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-base text-slate-900 focus:outline-teal-700 read-only:bg-slate-50" />
      <p className="mt-1 text-sm text-slate-600">{recordedPrediction ? "Your prediction is recorded so you can compare it with the observation." : "Write your prediction before continuing to the observation."}</p>
    </div>}
    {controls}
    {isStudent && last && page.stage === "question" && (onQuestion
      ? <button type="button" className={button} onClick={openQuestions}>Write your scientific question</button>
      : <p className="text-sm text-slate-700">Record your scientific question in Your questions below.</p>)}
  </>;

  return <section aria-label="Published slides" className="my-4 min-w-0">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h3 className="min-w-0 break-words text-lg font-semibold text-slate-900">{publication.manifest.title}</h3>
      <button ref={expandButton} type="button" className={button} onClick={() => setExpanded(true)}><Expand size={17} aria-hidden="true" />Enlarge slides</button>
    </div>
    {error && <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3"><p role="alert" className="text-sm text-amber-950">{error}</p>
      <button type="button" className={`${button} mt-2`} disabled={loading} onClick={() => refresh.current()}><RefreshCw size={16} aria-hidden="true" />Retry slides</button></div>}
    {audience === "teacher" && <label className="mb-3 block text-sm font-medium text-slate-700">Choose slide<select className="ml-2 max-w-full rounded-md border border-slate-300 bg-white p-2" value={index} onChange={event => setIndex(Number(event.target.value))}>
      {publication.manifest.pages.map((entry, n) => <option key={n} value={n}>{n + 1}. {entry.title}</option>)}
    </select></label>}
    {!expanded && content(false)}
    {expanded && <dialog ref={dialog} onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)} aria-label="Enlarged slides" className="fixed inset-0 m-auto max-h-[96vh] w-[96vw] max-w-7xl overflow-auto rounded-lg border border-slate-300 bg-slate-50 p-4 backdrop:bg-black/70">
      <div className="mb-3 flex justify-end"><button type="button" className={button} onClick={() => { dialog.current?.close(); setExpanded(false); }}><X size={18} aria-hidden="true" />Close presentation</button></div>
      {content(true)}
    </dialog>}
  </section>;
}

export default function PublishedSlidesReader(props: Props) {
  // Parent polling may replace item objects; only a different publication or
  // workspace resets a learner's position and recorded prediction.
  return <Reader key={JSON.stringify([props.classId, props.assignmentId, props.publicationId, props.audience])} {...props} />;
}
