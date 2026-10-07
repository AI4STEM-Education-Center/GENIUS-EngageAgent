"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, Expand, ImagePlus, LoaderCircle, RefreshCw, ScanEye, Send, Sparkles, X } from "lucide-react";
import type { UserContext } from "@/lib/auth";
import { STRATEGIES, isSlideAsset, parseDraft, type SlideDeck, type SlideLesson, type SlideStrategy, type TeachingSlide } from "@/lib/slides/model";
import { browserMeasure, layoutErrors } from "@/lib/slides/layout";
import { decodeSlideAsset, downloadPresentation } from "@/lib/slides/export";
import { DEFAULT_MODEL_SELECTION, INITIAL_MODEL_CATALOG, type SlideModelCatalog } from "@/lib/slides/models";
import SlidePreview from "./SlidePreview";
import { imageCheckKey, imageMatchesPlan, imageReferenceId, imageSourcePrompt, preservedAssets, qualityErrors, reviewFindings, textCheckKey } from "@/lib/slides/quality";
import type { SlidePromptProvenance } from "@/lib/slides/prompt-versions";
import { analogyStudentFields } from "@/lib/slides/analogy";
import { analogyMappingIndex, resolveAnalogyMethod } from "@/lib/slides/analogy-methods";
import { loadSlideDraft, saveSlideDraft, slideDraftKey } from "@/lib/slides/draft-storage";
import { postSlideRequest } from "@/lib/slides/client-transport";
import { publishSlideDeck } from "@/lib/slides/publish-client";

const input = "w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-teal-700 disabled:opacity-50";
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-50";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-teal-800 bg-teal-800 px-3 py-2 text-sm font-medium text-white hover:bg-teal-900 disabled:opacity-50";
const icon = `${button} h-10 w-10 shrink-0 p-0`;
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export type SlidesWorkspaceHandle = { generate(): void };
type SlidesWorkspaceProps = {
  user: UserContext;
  embeddedContext?: { lessonNumber: number; strategy: SlideStrategy; classroomContext?: string };
  onBusyChange?: (strategy: SlideStrategy, busy: boolean) => void;
  onReadyChange?: (strategy: SlideStrategy, ready: boolean) => void;
  onPublished?: () => void;
};

const SlidesWorkspaceEditor = forwardRef<SlidesWorkspaceHandle, SlidesWorkspaceProps>(function SlidesWorkspaceEditor({ user, embeddedContext, onBusyChange, onReadyChange, onPublished }, ref) {
  const [lessons, setLessons] = useState<SlideLesson[]>([]);
  const [standaloneLesson, setLessonNumber] = useState(1);
  const [standaloneStrategy, setStrategy] = useState<SlideStrategy>("analogy");
  const lessonNumber = embeddedContext?.lessonNumber ?? standaloneLesson;
  const strategy = embeddedContext?.strategy ?? standaloneStrategy;
  const embedded = Boolean(embeddedContext);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [models, setModels] = useState<SlideModelCatalog>(INITIAL_MODEL_CATALOG);
  const selection = DEFAULT_MODEL_SELECTION;
  const [classroomContext, setClassroomContext] = useState("");
  const sharedClassroomContext = embeddedContext?.classroomContext;
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [reviewWarnings, setReviewWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [preparedDownload, setPreparedDownload] = useState<{ url: string; dataUri?: string; httpUrl?: string; fileName: string; deck: SlideDeck } | null>(null);
  const exportRequest = useRef(0);
  const exportJob = useRef<AbortController | null>(null);
  const publishJob = useRef<AbortController | null>(null);
  const [publishedDeck, setPublishedDeck] = useState<SlideDeck | null>(null);
  const [feedback, setFeedback] = useState("");
  const [reload, setReload] = useState(0);
  const job = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const classroomHelpId = useId();
  const reviewControlId = useId();
  const reviewHelpId = useId();
  const imageRecovery = useRef<HTMLElement>(null);
  const { classId, assignmentId } = user;
  const scope = useMemo(() => ({ userId: user.geniusId, classId: classId || "", assignmentId: assignmentId || "", lessonNumber, strategy }), [user.geniusId, classId, assignmentId, lessonNumber, strategy]);
  const scopeKey = slideDraftKey(scope);
  const [restoredScope, setRestoredScope] = useState("");
  const [savedDeck, setSavedDeck] = useState<SlideDeck | null>(null);
  const [storageError, setStorageError] = useState("");
  const canGenerate = catalogLoaded && restoredScope === scopeKey && lessons.some(lesson => lesson.lessonNumber === lessonNumber)
    && models.text.some(model => model.id === selection.textModel) && models.image.some(model => model.id === selection.imageModel);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogLoaded(false);
    fetch(`/api/slides?${new URLSearchParams({ classId: classId || "", assignmentId: assignmentId || "" })}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load lessons."); return data as { lessons: SlideLesson[]; models?: SlideModelCatalog }; })
      .then(value => { if (!controller.signal.aborted) { setLessons(value.lessons); setModels(value.models || INITIAL_MODEL_CATALOG); if (!embedded) setLessonNumber(value.lessons[0]?.lessonNumber ?? 1); setCatalogLoaded(true); setError(""); } })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [classId, assignmentId, reload, embedded]);
  useEffect(() => {
    if (!catalogLoaded || !lessons.some(lesson => lesson.lessonNumber === scope.lessonNumber)) return;
    // Standalone controls can select settings for the next draft without replacing
    // the current one. Embedded workspace identity is isolated by the keyed wrapper.
    if (deck) { setRestoredScope(scopeKey); return; }
    let active = true;
    void loadSlideDraft(scope).then(restored => {
      if (!active || !restored) return;
      setDeck(restored); setSavedDeck(restored); setReviewed(false); setDownloaded(false);
      setClassroomContext(restored.classroomContext ?? "");
      setStatus("Saved draft restored. Continue checking or editing; generation does not restart automatically.");
    }).catch(() => {
      if (active) setStorageError("Draft recovery is unavailable. Keep this tab open and download your slides before leaving.");
    }).finally(() => { if (active) setRestoredScope(scopeKey); });
    return () => { active = false; };
    // Only workspace selection/catalog changes start restoration, never edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogLoaded, scopeKey]);
  useEffect(() => {
    if (!deck || !restoredScope) return;
    let active = true;
    // Capture the deck's own scope: changing a standalone selector cannot save
    // an earlier lesson's output under the new lesson or strategy.
    void saveSlideDraft({ ...scope, lessonNumber: deck.lessonNumber, strategy: deck.strategy }, deck).then(() => {
      if (active) { setSavedDeck(deck); setStorageError(""); }
    }).catch(() => {
      if (active) setStorageError("This draft could not be saved on this device. Keep this tab open and download your slides before leaving.");
    });
    return () => { active = false; };
  }, [deck, restoredScope, scope]);
  useEffect(() => () => { job.current?.abort(); }, []);
  useEffect(() => () => { exportRequest.current++; exportJob.current?.abort(); }, [deck]);
  useEffect(() => () => { publishJob.current?.abort(); }, [deck]);
  useEffect(() => { if (publishedDeck && publishedDeck !== deck) setPublishedDeck(null); }, [deck, publishedDeck]);
  useEffect(() => () => { if (preparedDownload) URL.revokeObjectURL(preparedDownload.url); }, [preparedDownload]);
  useEffect(() => {
    if (preparedDownload && preparedDownload.deck !== deck) setPreparedDownload(null);
  }, [deck, preparedDownload]);
  useEffect(() => { onBusyChange?.(strategy, busy); }, [onBusyChange, strategy, busy]);
  useEffect(() => () => { onBusyChange?.(strategy, false); }, [onBusyChange, strategy]);
  useEffect(() => { onReadyChange?.(strategy, canGenerate); }, [onReadyChange, strategy, canGenerate]);
  useEffect(() => () => { onReadyChange?.(strategy, false); }, [onReadyChange, strategy]);
  // Creating or revealing an embedded editor never starts a paid generation.
  useImperativeHandle(ref, () => ({ generate: () => generate() }));
  const issues = useMemo(() => {
    if (!deck || typeof document === "undefined") return [];
    try { return layoutErrors(deck, browserMeasure()); }
    catch (err) { return [err instanceof Error ? err.message : "Unable to measure slides."]; }
  }, [deck]);
  const qualityIssues = useMemo(() => deck ? qualityErrors(deck) : [], [deck]);
  const findings = useMemo(() => deck ? reviewFindings(deck) : [], [deck]);
  const suggestions = useMemo(() => [...new Set([...qualityIssues, ...findings, ...reviewWarnings])], [qualityIssues, findings, reviewWarnings]);
  useEffect(() => {
    if (!busy && (!deck || deck === savedDeck)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [deck, savedDeck, busy]);

  async function post(path: string, body: object, controller: AbortController) {
    return postSlideRequest<{ draft: unknown; asset: unknown; issues: string[]; model?: string; promptProvenance?: SlidePromptProvenance }>(
      path, { classId, assignmentId, ...body }, controller.signal);
  }
  async function run(work: (controller: AbortController) => Promise<void>) {
    job.current?.abort();
    const controller = new AbortController(); job.current = controller;
    setBusy(true); setError(""); setReviewWarnings([]);
    try { await work(controller); }
    catch (err) { if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "Unable to complete this request."); setStatus(""); } }
    finally { if (job.current === controller) { setBusy(false); job.current = null; } }
  }
  function showDraft(target: SlideDeck, controller: AbortController) {
    if (!controller.signal.aborted) {
      setDeck(target);
      setIndex(current => Math.min(current, target.draft.slides.length - 1));
    }
  }
  async function checkText(target: SlideDeck, controller: AbortController): Promise<SlideDeck> {
    setStatus("Checking teaching sequence and scientific content...");
    try {
      const result = await post("/api/slides/check", { lessonNumber: target.lessonNumber, strategy: target.strategy, draft: target.draft, textModel: target.modelSelection?.textModel, classroomContext: target.classroomContext ?? "" }, controller);
      const next = { ...target, checks: { images: target.checks?.images || {}, text: { key: textCheckKey(target), issues: result.issues, model: result.model } } };
      showDraft(next, controller);
      return next;
    } catch {
      controller.signal.throwIfAborted();
      setReviewWarnings(current => [...new Set([...current, "Text review could not finish. You can still send complete slides, or optionally run Check slides again."])]);
      return target;
    }
  }
  async function checkImage(target: SlideDeck, visualId: string, controller: AbortController, force = false): Promise<SlideDeck> {
    const asset = target.assets[visualId];
    const existing = target.checks?.images[visualId];
    if (!asset || !imageMatchesPlan(target, visualId)) return target;
    const key = imageCheckKey(target, visualId);
    if (!force && existing?.key === key && existing.imageData === asset.data) return target;
    setStatus(`Checking ${visualId} image against the slide text...`);
    const reference = visualId === "variation" ? target.assets.target : target.strategy === "analogy" && target.draft.analogyPlan && visualId === "target" ? target.assets.analogue : undefined;
    const phenomenon = target.draft.analogyMethod === "six-step" && visualId === "target" ? target.assets.phenomenon : undefined;
    try {
      const result = await post("/api/slides/check", { lessonNumber: target.lessonNumber, strategy: target.strategy, draft: target.draft, textModel: target.modelSelection?.textModel, classroomContext: target.classroomContext ?? "", visualId,
        asset: { data: asset.data, width: asset.width, height: asset.height },
        ...(reference ? { referenceAsset: { data: reference.data, width: reference.width, height: reference.height } } : {}),
        ...(phenomenon ? { phenomenonAsset: { data: phenomenon.data, width: phenomenon.width, height: phenomenon.height } } : {}) }, controller);
      const next = { ...target, checks: { ...target.checks, images: { ...target.checks?.images, [visualId]: { key, issues: result.issues, model: result.model, imageData: asset.data } } } };
      showDraft(next, controller);
      return next;
    } catch {
      controller.signal.throwIfAborted();
      setReviewWarnings(current => [...new Set([...current, `${label(visualId)} image review could not finish. You can still send complete slides, or optionally run Check slides again.`])]);
      return target;
    }
  }
  async function imageFor(target: SlideDeck, visualId: string, controller: AbortController, imageModel = target.modelSelection?.imageModel || DEFAULT_MODEL_SELECTION.imageModel, feedback = ""): Promise<SlideDeck> {
    const referenceId = imageReferenceId(target.draft, visualId);
    if (referenceId && !imageMatchesPlan(target, referenceId)) throw new Error(`Generate the current ${referenceId} image first.`);
    const baseline = referenceId ? target.assets[referenceId] : undefined;
    const result = await post("/api/slides/image", { lessonNumber: target.lessonNumber, strategy: target.strategy, draft: target.draft, visualId, imageModel, ...(feedback ? { feedback } : {}),
      ...(baseline ? { referenceAsset: { data: baseline.data, width: baseline.width, height: baseline.height } } : {}) }, controller);
    const asset = await decodeSlideAsset(result.asset);
    const next = { ...target, assets: { ...target.assets, [visualId]: { ...asset, sourcePrompt: imageSourcePrompt(target.draft, visualId), ...(baseline ? { referenceData: baseline.data } : {}) } } };
    showDraft(next, controller);
    return next;
  }
  function generate(review = false) {
    if (!canGenerate || busy || job.current || (review && !deck)) return;
    void run(async controller => {
      const chosenLesson = review && deck ? deck.lessonNumber : lessonNumber;
      const chosenStrategy = review && deck ? deck.strategy : strategy;
      const chosenPrompt = review && deck ? deck.promptProvenance?.version ?? "optimized" : "optimized";
      const chosenMethod = review && deck ? resolveAnalogyMethod(deck.draft.analogyMethod) : "six-step";
      const chosenClassroomContext = review && deck ? deck.classroomContext ?? "" : (sharedClassroomContext ?? classroomContext).trim();
      const chosenModels = { ...selection };
      setStatus(review ? "Reviewing slide content..." : chosenStrategy === "analogy" && chosenMethod === "six-step" ? "Generating six-step slides..." : chosenStrategy === "experience bridging" ? "Generating experience-bridging slides..." : "Generating five slides...");
      const context = { lessonNumber: chosenLesson, strategy: chosenStrategy, textModel: chosenModels.textModel, promptVersion: chosenPrompt, classroomContext: chosenClassroomContext,
        ...(chosenStrategy === "analogy" ? { analogyMethod: chosenMethod } : {}) };
      const result = await post("/api/slides", { ...context, operation: review ? "review" : "generate", ...(review && deck ? { draft: deck.draft, feedback: [feedback, ...issues, ...qualityIssues, ...findings].join("\n").slice(0, 6000) } : {}) }, controller);
      const draft = parseDraft(result.draft, chosenStrategy, true);
      let next: SlideDeck = { id: review && deck ? deck.id : crypto.randomUUID(), lessonNumber: chosenLesson, strategy: chosenStrategy, draft, classroomContext: chosenClassroomContext, assets: preservedAssets(review ? deck : null, draft), checks: review ? deck?.checks : undefined, modelSelection: chosenModels, textModel: result.model, promptProvenance: result.promptProvenance };
      if (controller.signal.aborted) return;
      // Bounded native repairs; retain drafts on failure and never loop on provider errors.
      setDeck(next); setIndex(0); setReviewed(false); setDownloaded(false);
      next = await checkText(next, controller);
      const textFindings = (candidate: SlideDeck) => [...(candidate.checks?.text?.issues || []), ...layoutErrors(candidate, browserMeasure())];
      for (let attempt = 0; attempt < 2 && textFindings(next).length; attempt++) {
        try {
          setStatus("Correcting slide content and layout...");
          const repaired = await post("/api/slides", { ...context, operation: "review", draft: next.draft, feedback: textFindings(next).join("\n").slice(0, 6000) }, controller);
          const corrected = parseDraft(repaired.draft, chosenStrategy, true);
          const unchanged = JSON.stringify(corrected) === JSON.stringify(next.draft);
          next = { ...next, draft: corrected, assets: preservedAssets(next, corrected), textModel: repaired.model, promptProvenance: repaired.promptProvenance };
          showDraft(next, controller);
          next = await checkText(next, controller);
          if (unchanged) break;
        } catch {
          controller.signal.throwIfAborted();
          setReviewWarnings(current => [...new Set([...current, "Automatic text refinement could not finish. The generated draft is retained; further refinement is optional."])]);
          break;
        }
      }
      if (controller.signal.aborted) return;
      if (layoutErrors(next, browserMeasure()).length) { setStatus("Draft retained. Layout corrections needed."); return; }
      const failures: string[] = [];
      // Generate both reference pictures before checking their shared target image.
      const imageOrder = next.draft.analogyMethod === "six-step"
        ? ["phenomenon", "analogue", "target"].map(id => next.draft.visuals.find(visual => visual.id === id)!)
        : next.draft.visuals;
      for (const [n, visual] of imageOrder.entries()) {
        if (controller.signal.aborted) return;
        try {
          if (!imageMatchesPlan(next, visual.id)) {
            setStatus(`Generating image ${n + 1} of ${next.draft.visuals.length}...`);
            next = await imageFor(next, visual.id, controller);
          }
          if (controller.signal.aborted) return;
          next = await checkImage(next, visual.id, controller);
          const imageFindings = next.checks?.images[visual.id]?.issues || [];
          if (imageFindings.length) {
            setStatus(`Correcting ${visual.id} image...`);
            next = await imageFor(next, visual.id, controller, chosenModels.imageModel, imageFindings.join("\n").slice(0, 4000));
            next = await checkImage(next, visual.id, controller, true);
          }
        }
        catch (err) {
          if (!controller.signal.aborted) {
            const message = `${label(visual.id)}: ${err instanceof Error ? err.message : "Image generation failed."}`;
            if (isSlideAsset(next.assets[visual.id])) setReviewWarnings(current => [...new Set([...current, `${message} The existing image is retained; refinement is optional.`])]);
            else failures.push(message);
          }
        }
      }
      if (controller.signal.aborted) return;
      setError(failures.join("\n")); setStatus(failures.length ? "Slide text ready. Some images need a retry." : layoutErrors(next, browserMeasure()).length ? "Draft retained. Layout corrections needed." : `${next.draft.slides.length} slides ready to send.`);
    });
  }
  function edit(field: keyof Omit<TeachingSlide, "stage">, value: string | string[]) {
    const previous = deck?.draft.slides[index]?.[field];
    if (previous === value || (Array.isArray(previous) && Array.isArray(value)
      && previous.length === value.length && previous.every((item, n) => item === value[n]))) return;
    setDeck(current => current ? { ...current, draft: { ...current.draft, slides: current.draft.slides.map((slide, n) => n === index ? { ...slide, [field]: value } : slide) } } : current);
    setReviewed(false); setDownloaded(false); setStatus("");
  }
  function editMapping(field: "mappingHint" | "responseStarter", value: string) {
    setDeck(current => current?.draft.analogyPlan ? { ...current, draft: { ...current.draft, analogyPlan: { ...current.draft.analogyPlan, [field]: value } } } : current);
    setReviewed(false); setDownloaded(false); setStatus("");
  }
  function retryImage(visualId: string) {
    if (!deck) return;
    setReviewed(false); setDownloaded(false);
    void run(async controller => {
      setStatus(`Generating ${visualId} image...`);
      const check = deck.checks?.images[visualId];
      const feedback = check?.key === imageCheckKey(deck, visualId) && check.imageData === deck.assets[visualId]?.data ? check.issues.join("\n").slice(0, 4000) : "";
      const next = await imageFor({ ...deck, modelSelection: { ...selection } }, visualId, controller, selection.imageModel, feedback);
      if (controller.signal.aborted) return;
      await checkImage(next, visualId, controller);
      if (!controller.signal.aborted) setStatus("Image updated. Review suggestions are optional.");
    });
  }
  function checkCurrent() {
    if (!deck) return;
    setReviewed(false); setDownloaded(false);
    void run(async controller => {
      let next = await checkText({ ...deck, modelSelection: { ...selection } }, controller);
      for (const visual of next.draft.visuals) {
        if (controller.signal.aborted) return;
        next = await checkImage(next, visual.id, controller, true);
      }
      if (!controller.signal.aborted) setStatus(layoutErrors(next, browserMeasure()).length ? "Draft retained. Layout corrections needed."
        : next.draft.visuals.some(visual => !isSlideAsset(next.assets[visual.id])) ? "Draft retained. Generate the missing images before sending."
          : "Quality checks complete. You can send the slides or optionally revise them.");
    });
  }
  async function download() {
    if (!deck || !ready || busy || exportJob.current) return;
    const request = ++exportRequest.current;
    const controller = new AbortController(); exportJob.current = controller;
    setPreparedDownload(null);
    setBusy(true); setError(""); setStatus("Preparing PowerPoint...");
    try {
      const file = await downloadPresentation(deck, browserMeasure(), { classId, assignmentId }, controller.signal);
      if (request !== exportRequest.current || controller.signal.aborted) { URL.revokeObjectURL(file.url); return; }
      setPreparedDownload({ ...file, deck });
      setDownloaded(true); setStatus("PowerPoint ready. If downloading did not start, use Save PPTX file.");
    } catch (err) { if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "Download failed."); setStatus(""); } }
    finally { if (exportJob.current === controller) { exportJob.current = null; setBusy(false); } }
  }
  async function publish() {
    if (!deck || !ready || busy || publishJob.current || publishedDeck === deck || !classId || !assignmentId) return;
    const controller = new AbortController(); publishJob.current = controller;
    setBusy(true); setError("");
    try {
      await publishSlideDeck(deck, { classId, assignmentId }, controller.signal, setStatus);
      if (controller.signal.aborted || publishJob.current !== controller) return;
      setPublishedDeck(deck);
      setStatus("Slides published. Students can read them in Explore and ask.");
      onPublished?.();
    } catch (err) {
      if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "Unable to send slides. Your draft is retained; try again."); setStatus(""); }
    } finally { if (publishJob.current === controller) { publishJob.current = null; setBusy(false); } }
  }
  const missingImages = deck?.draft.visuals.some(visual => !isSlideAsset(deck.assets[visual.id]));
  const slide = deck?.draft.slides[index];
  const ready = !!deck && !missingImages && !issues.length;
  const changedImages = useMemo(() => deck?.draft.visuals.some(visual => deck.assets[visual.id] && !imageMatchesPlan(deck, visual.id)), [deck]);
  const recoveryImages = useMemo(() => deck?.draft.visuals.flatMap(visual => {
    const missing = !isSlideAsset(deck.assets[visual.id]);
    if (!missing && imageMatchesPlan(deck, visual.id)) return [];
    const referenceId = imageReferenceId(deck.draft, visual.id);
    return [{ id: visual.id, missing, needsReference: referenceId && !imageMatchesPlan(deck, referenceId) ? referenceId : undefined }];
  }) ?? [], [deck]);
  const reviewBlock = busy ? "busy" : issues.length ? "layout" : missingImages ? "images" : null;
  const reviewHelp = reviewBlock === "busy" ? "Finish the current operation before sending or downloading."
    : reviewBlock === "layout" ? "The slide layout or required content needs correction. Review the details below, then edit the draft or revise it with AI."
      : reviewBlock === "images" ? "Images are missing. Use Image recovery below to generate or retry them."
        : publishedDeck === deck ? "This version is published. Students can read it in Explore and ask. You can also download the PowerPoint."
                : reviewed ? "Review confirmed for this version. Download the PowerPoint or send the slides to students."
                  : "The slides and images are ready. You can send them to students or download now. Checking, confirming review, and refining are optional.";

  const Container = embedded ? "section" : "main";
  const Heading = embedded ? "h3" : "h1";
  return <Container aria-label={embedded ? `${label(strategy)} slides` : undefined} className={embedded ? "min-w-0" : "mx-auto max-w-7xl px-5 pb-12"}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
      <Heading className="text-2xl font-semibold">{embedded ? `${label(strategy)} slides` : "Teaching slides"}</Heading>
      {deck && <span className="text-sm text-gray-500">{deck === savedDeck ? "Saved on this device" : storageError ? "Unsaved draft" : "Saving draft..."}{downloaded ? " · Export prepared" : ""}</span>}
    </div>
    {(!embedded || sharedClassroomContext === undefined) && <div className="grid items-end gap-3 border-b border-gray-200 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      {!embedded && <><label className="min-w-0 text-sm font-medium">Lesson<select aria-label="Lesson" className={`${input} mt-2`} value={lessonNumber} disabled={busy || !lessons.length} onChange={e => setLessonNumber(Number(e.target.value))}>{lessons.map(lesson => <option key={lesson.lessonNumber} value={lesson.lessonNumber}>{lesson.lessonNumber}. {lesson.lessonTitle}</option>)}</select></label>
      <label className="min-w-0 text-sm font-medium">Strategy<select aria-label="Strategy" className={`${input} mt-2`} value={strategy} disabled={busy} onChange={e => setStrategy(e.target.value as SlideStrategy)}>{STRATEGIES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label></>}
      {sharedClassroomContext === undefined && <label className="min-w-0 text-sm font-medium sm:col-span-3">Classroom context (optional)
        <textarea aria-label="Classroom context (optional)" aria-describedby={classroomHelpId} className={`${input} mt-2`} rows={2} maxLength={1200} disabled={busy} value={classroomContext} onChange={e => setClassroomContext(e.target.value)} placeholder="Grade, prior knowledge, familiar experiences, what students find hard to picture, and classroom constraints" />
        <span id={classroomHelpId} className="mt-1 block text-xs font-normal text-gray-500">Used for new slides. Revisions and checks keep the draft&apos;s original context.</span>
      </label>}
      {!embedded && <button className={`${primaryButton} sm:col-start-3 sm:row-start-1`} disabled={busy || !canGenerate} onClick={() => generate()}><Sparkles size={17} />{deck ? "Generate new slides" : "Generate slides"}</button>}
    </div>}
    {storageError && <p role="alert" className="mt-3 text-sm text-amber-800">{storageError}</p>}
    <div className="flex min-h-12 flex-wrap items-center gap-3 py-3">
      {busy && <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />}
      <p role="status" className="min-w-0 text-sm text-gray-600">{status}</p>
      {busy && job.current && <button className={icon} title="Cancel generation" aria-label="Cancel generation" onClick={() => { job.current?.abort(); job.current = null; setBusy(false); setStatus("Generation cancelled."); }}><X size={17} /></button>}
      {busy && publishJob.current && <button className={icon} title="Cancel publishing" aria-label="Cancel publishing" onClick={() => { publishJob.current?.abort(); publishJob.current = null; setBusy(false); setStatus("Publishing stopped. Your draft is retained."); }}><X size={17} /></button>}
    </div>
    {error && <div role="alert" className="mb-4 whitespace-pre-line break-words border-l-4 border-red-700 bg-red-50 p-3 text-sm text-red-900">{error}{!lessons.length && <button className={`${button} ml-3`} onClick={() => setReload(n => n + 1)}>Retry</button>}</div>}
    {!deck && <div className="border-y border-gray-200 py-16 text-center text-sm text-gray-500">No slide draft yet.</div>}
    {deck && slide && <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{deck.draft.title}</h2><p className="mt-1 text-sm text-gray-500">Lesson {deck.lessonNumber} · {label(deck.strategy)} · {deck.draft.slides.length} slides</p></div>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy} onClick={checkCurrent}><ScanEye size={16} />Check slides</button>
          <button className={icon} disabled={!!issues.length} title="Enlarge preview" aria-label="Enlarge preview" onClick={() => dialog.current?.showModal()}><Expand size={17} /></button>
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Slide preview" className="min-w-0">
          <SlidePreview deck={deck} index={index} />
          <div className="my-3 flex items-center justify-between gap-2">
            <button className={icon} title="Previous slide" aria-label="Previous slide" disabled={index === 0} onClick={() => setIndex(n => n - 1)}><ChevronLeft size={19} /></button>
            <span className="text-sm tabular-nums">{index + 1} / {deck.draft.slides.length}</span>
            <button className={icon} title="Next slide" aria-label="Next slide" disabled={index === deck.draft.slides.length - 1} onClick={() => setIndex(n => n + 1)}><ChevronRight size={19} /></button>
          </div>
          <ol className="divide-y divide-gray-200 border-y border-gray-200">{deck.draft.slides.map((item, n) => <li key={item.stage}><button className={`flex min-h-11 w-full items-start gap-3 px-3 py-3 text-left text-sm ${index === n ? "bg-teal-50 text-teal-900" : "hover:bg-gray-100"}`} aria-current={index === n ? "step" : undefined} onClick={() => setIndex(n)}><span className="font-mono">{n + 1}</span><span className="min-w-0 break-words">{item.title}</span></button></li>)}</ol>
          <section aria-label="Review and publish" className="mt-5 rounded-lg border border-teal-200 bg-teal-50/50 p-4">
            <h3 className="text-base font-semibold text-gray-900">Review and publish</h3>
            <p id={reviewHelpId} aria-live="polite" className="mt-2 text-sm leading-6 text-gray-700">{reviewHelp}</p>
            {!busy && reviewBlock === "images" && <button type="button" className={`${button} mt-3`} onClick={() => { imageRecovery.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); imageRecovery.current?.focus({ preventScroll: true }); }}><ImagePlus size={16} />Go to image recovery</button>}
            {!!suggestions.length && !busy && <section aria-label="AI review suggestions" className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <h4 className="font-semibold">AI review suggestions (optional)</h4>
              <p className="mt-2 leading-6">Refine with AI is optional. You can download or send complete slides without refining, checking again, or confirming review.</p>
              <button type="button" className={`${button} mt-3`} disabled={!canGenerate} onClick={() => generate(true)}><RefreshCw size={16} />Refine with AI</button>
              <details className="mt-3"><summary className="cursor-pointer font-medium">View {suggestions.length} {suggestions.length === 1 ? "suggestion" : "suggestions"}</summary><ul className="mt-3 space-y-2">{suggestions.map((finding, n) => <li key={n} className="break-words">{finding}</li>)}</ul></details>
            </section>}
            <p className="mt-4 text-xs text-gray-500">Optional review record — not required to send or download.</p>
            <button id={reviewControlId} type="button" role="checkbox" aria-checked={reviewed} aria-describedby={reviewHelpId} disabled={!ready || busy}
              onClick={() => setReviewed(current => !current)} className={`mt-4 flex min-h-12 w-full items-start gap-3 rounded-md border bg-white px-3 py-3 text-left text-sm leading-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 ${ready && !busy ? "cursor-pointer border-teal-600 hover:bg-teal-50" : "border-gray-300 text-gray-500"}`}>
              <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border ${reviewed ? "border-teal-800 bg-teal-800 text-white" : "border-gray-400 bg-white"}`}>{reviewed && <Check size={16} />}</span>
              <span>I have reviewed all {deck.draft.slides.length} slides and their images.</span>
            </button>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={button} disabled={!ready || busy || reviewed} onClick={() => setReviewed(true)}><ScanEye size={16} />{reviewed ? "Review confirmed" : "Confirm review"}</button>
              <button type="button" className={button} disabled={busy || !ready} onClick={download}><Download size={17} />Download PPTX</button>
              <button type="button" className={primaryButton} disabled={busy || !ready || !classId || !assignmentId || publishedDeck === deck} onClick={publish}><Send size={17} />{publishedDeck === deck ? "Published" : "Send to students"}</button>
              {preparedDownload?.deck === deck && !busy && ready && <a className={button} href={preparedDownload.httpUrl || preparedDownload.dataUri || preparedDownload.url} download={preparedDownload.fileName}>Save PPTX file</a>}
            </div>
            {preparedDownload?.deck === deck && !busy && ready && preparedDownload.httpUrl && <p className="mt-2 text-xs text-gray-500">Save link expires in 10 minutes. Select Download PPTX again to refresh it.</p>}
          </section>
        </section>
        <aside aria-label="Slide editor" className="min-w-0 border-t border-gray-200 pt-4 lg:border-t-0 lg:pt-0">
          <h3 className="mb-4 text-base font-semibold">Edit slide text</h3>
          <div className="space-y-4">{(["title", "body", "task"] as const).map(field => <label key={field} className="block text-sm font-medium">{field === "task" ? "Thinking task" : label(field)}<textarea aria-label={`Slide ${field}`} className={`${input} mt-2 resize-y`} rows={field === "title" ? 2 : 4} disabled={busy} value={slide[field]} onChange={e => edit(field, e.target.value)} />{field === "body" && deck.strategy !== "analogy" && <span className="mt-1 block text-xs font-normal text-gray-600">{slide.stage === "question" ? "Leave this empty; students see their question task and writing card." : "Optional when the picture and thinking task provide enough context."}</span>}</label>)}{index === analogyMappingIndex(deck.draft.analogyMethod) && deck.draft.analogyPlan && analogyStudentFields(deck.draft.analogyMethod).map(field => <label key={field} className="block text-sm font-medium">{field === "mappingHint" ? "Visible comparison hint" : "Student response starter"}<textarea className={`${input} mt-2 resize-y`} rows={2} maxLength={field === "mappingHint" ? 140 : 100} disabled={busy} value={deck.draft.analogyPlan![field]} onChange={e => editMapping(field, e.target.value)} /></label>)}</div>
        </aside>
      </div>
      {!!issues.length && <div role="alert" className="mt-5 border-l-4 border-red-700 bg-red-50 p-4 text-sm text-red-900"><ul className="space-y-2">{issues.map((issue, n) => <li key={n} className="whitespace-pre-line break-words">{issue}</li>)}</ul></div>}
      {!!missingImages && !busy && <p className="mt-3 text-sm text-amber-900">Images pending. Download unavailable.</p>}
      <section aria-label="Revise slides" className="mt-6 border-t border-gray-200 pt-5">
        <h3 className="text-base font-semibold">Revise slides (optional)</h3>
        <label className="mt-3 block text-sm font-medium">Revision request<textarea aria-label="Revision request" className={`${input} mt-2 resize-y`} rows={2} maxLength={3000} disabled={busy} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="Describe what you would like to improve." /></label>
        <button className={`${button} mt-3`} disabled={busy || !canGenerate} onClick={() => generate(true)}><RefreshCw size={16} />Revise with AI</button>
      </section>
      {(missingImages || changedImages) && <section ref={imageRecovery} tabIndex={-1} aria-label="Image recovery" className="mt-5 rounded-md border border-gray-200 p-4 focus:outline-2 focus:outline-teal-700">
        <h3 className="text-sm font-semibold">Image recovery</h3>
        <p className="mt-1 text-sm text-gray-600">Missing or invalid images must be generated before sending. Updating existing images is optional.</p>
        <ul className="mt-3 flex flex-wrap gap-3">{recoveryImages.map(visual => <li key={visual.id} className="rounded-md border border-gray-200 bg-white p-3">
          <p className="mb-2 text-sm">{label(visual.id)} · {visual.missing ? "Missing" : "Needs update"}</p>
          {visual.needsReference && <p className="mb-2 text-sm text-gray-600">Regenerate {visual.needsReference} first.</p>}
          <button className={button} disabled={busy || !!issues.length || !!visual.needsReference} onClick={() => retryImage(visual.id)}><ImagePlus size={16} />Regenerate {visual.id} image</button>
        </li>)}</ul>
      </section>}
      <dialog ref={dialog} className="fixed inset-0 m-auto w-[96vw] max-w-7xl max-h-[96vh] overflow-auto border border-gray-300 bg-gray-50 p-3 backdrop:bg-black/70">
        <div className="mb-3 flex items-center justify-between gap-2"><button className={icon} aria-label="Previous enlarged slide" disabled={index === 0} onClick={() => setIndex(n => n - 1)}><ChevronLeft size={19} /></button><span className="text-sm">{index + 1} / {deck.draft.slides.length}</span><button className={icon} aria-label="Next enlarged slide" disabled={index === deck.draft.slides.length - 1} onClick={() => setIndex(n => n + 1)}><ChevronRight size={19} /></button><button className={icon} aria-label="Close preview" title="Close preview" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
        <div className="mx-auto w-full" style={{ maxWidth: "calc((96vh - 90px) * 16 / 9)" }}><SlidePreview deck={deck} index={index} /></div>
      </dialog>
    </>}
  </Container>;
});

const SlidesWorkspace = forwardRef<SlidesWorkspaceHandle, SlidesWorkspaceProps>(function SlidesWorkspace(props, ref) {
  const { user, embeddedContext } = props;
  const key = JSON.stringify([user.geniusId, user.role, user.classId, user.assignmentId, embeddedContext?.lessonNumber, embeddedContext?.strategy]);
  return <SlidesWorkspaceEditor key={key} {...props} ref={ref} />;
});

export default SlidesWorkspace;
