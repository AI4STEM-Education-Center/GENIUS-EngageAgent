"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Expand, ImagePlus, LoaderCircle, RefreshCw, ScanEye, Send, Sparkles, X } from "lucide-react";
import type { UserContext } from "@/lib/auth";
import { STRATEGIES, parseDraft, type SlideDeck, type SlideLesson, type SlideStrategy, type SlideVisual, type TeachingSlide } from "@/lib/slides/model";
import { browserMeasure, layoutErrors } from "@/lib/slides/layout";
import { decodeSlideAsset, downloadPresentation } from "@/lib/slides/export";
import { DEFAULT_MODEL_SELECTION, INITIAL_MODEL_CATALOG, type SlideModelCatalog, type SlideModelSelection } from "@/lib/slides/models";
import SlidePreview from "./SlidePreview";
import { hasTeacherDecision, imageCheckKey, imageMatchesPlan, imageReferenceId, imageSourcePrompt, preservedAssets, qualityErrors, reviewFindings, textCheckKey } from "@/lib/slides/quality";
import { PROMPT_LABELS, PROMPT_VERSIONS, type SlidePromptProvenance, type SlidePromptVersion } from "@/lib/slides/prompt-versions";
import { analogyStudentFields } from "@/lib/slides/analogy";
import { ANALOGY_METHODS, analogyMappingIndex, resolveAnalogyMethod, type AnalogyMethod } from "@/lib/slides/analogy-methods";
import { loadSlideDraft, saveSlideDraft, slideDraftKey } from "@/lib/slides/draft-storage";
import { postSlideRequest } from "@/lib/slides/client-transport";
import { publishSlideDeck } from "@/lib/slides/publish-client";

const input = "w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-teal-700 disabled:opacity-50";
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-50";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-teal-800 bg-teal-800 px-3 py-2 text-sm font-medium text-white hover:bg-teal-900 disabled:opacity-50";
const icon = `${button} h-10 w-10 shrink-0 p-0`;
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const storyLabels: Record<AnalogyMethod, string> = {
  "six-step": "Six-step analogy (recommended)",
  "reference-story": "Reference five-step story",
  "predict-transfer": "Compare and predict",
};
const storyDescriptions: Record<AnalogyMethod, string> = {
  "six-step": "Observe a lesson-aligned real-world phenomenon → identify the target difficulty → explore a familiar analogue → compare with teacher guidance → explain or predict → write a question. A boundary page is added only when it helps prevent a likely misunderstanding.",
  "reference-story": "Introduce both situations → explore the familiar one → map their relationship → clarify when useful → ask a question.",
  "predict-transfer": "Introduce both situations → map their relationship → predict a changed condition → revisit the reason → ask a question.",
};

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
  const [promptVersion, setPromptVersion] = useState<SlidePromptVersion>("optimized");
  const [analogyMethod, setAnalogyMethod] = useState<AnalogyMethod>("six-step");
  const [models, setModels] = useState<SlideModelCatalog>(INITIAL_MODEL_CATALOG);
  const [selection, setSelection] = useState<SlideModelSelection>(DEFAULT_MODEL_SELECTION);
  const [classroomContext, setClassroomContext] = useState("");
  const sharedClassroomContext = embeddedContext?.classroomContext;
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [preparedDownload, setPreparedDownload] = useState<{ url: string; dataUri?: string; httpUrl?: string; fileName: string; deck: SlideDeck } | null>(null);
  const exportRequest = useRef(0);
  const exportJob = useRef<AbortController | null>(null);
  const publishJob = useRef<AbortController | null>(null);
  const [publishedDeck, setPublishedDeck] = useState<SlideDeck | null>(null);
  const [feedback, setFeedback] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [tab, setTab] = useState<"text" | "notes" | "images">("text");
  const [reload, setReload] = useState(0);
  const job = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const classroomHelpId = useId();
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
      if (restored.modelSelection) setSelection({
        textModel: models.text.some(model => model.id === restored.modelSelection!.textModel) ? restored.modelSelection.textModel : DEFAULT_MODEL_SELECTION.textModel,
        imageModel: models.image.some(model => model.id === restored.modelSelection!.imageModel) ? restored.modelSelection.imageModel : DEFAULT_MODEL_SELECTION.imageModel,
      });
      if (restored.promptProvenance) setPromptVersion(restored.promptProvenance.version);
      if (restored.strategy === "analogy") setAnalogyMethod(resolveAnalogyMethod(restored.draft.analogyMethod));
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
    if (preparedDownload && (preparedDownload.deck !== deck || !reviewed)) setPreparedDownload(null);
  }, [deck, reviewed, preparedDownload]);
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
    setBusy(true); setError("");
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
    const result = await post("/api/slides/check", { lessonNumber: target.lessonNumber, strategy: target.strategy, draft: target.draft, textModel: target.modelSelection?.textModel, classroomContext: target.classroomContext ?? "" }, controller);
    const next = { ...target, checks: { images: target.checks?.images || {}, text: { key: textCheckKey(target), issues: result.issues, model: result.model } } };
    showDraft(next, controller);
    return next;
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
    const result = await post("/api/slides/check", { lessonNumber: target.lessonNumber, strategy: target.strategy, draft: target.draft, textModel: target.modelSelection?.textModel, classroomContext: target.classroomContext ?? "", visualId,
      asset: { data: asset.data, width: asset.width, height: asset.height },
      ...(reference ? { referenceAsset: { data: reference.data, width: reference.width, height: reference.height } } : {}),
      ...(phenomenon ? { phenomenonAsset: { data: phenomenon.data, width: phenomenon.width, height: phenomenon.height } } : {}) }, controller);
    const next = { ...target, checks: { ...target.checks, images: { ...target.checks?.images, [visualId]: { key, issues: result.issues, model: result.model, imageData: asset.data } } } };
    showDraft(next, controller);
    return next;
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
      const chosenPrompt = review && deck ? deck.promptProvenance?.version ?? "optimized" : promptVersion;
      const chosenMethod = review && deck ? resolveAnalogyMethod(deck.draft.analogyMethod) : analogyMethod;
      const chosenClassroomContext = review && deck ? deck.classroomContext ?? "" : (sharedClassroomContext ?? classroomContext).trim();
      const chosenModels = { ...selection };
      setStatus(review ? "Reviewing slide content..." : chosenStrategy === "analogy" && chosenMethod === "six-step" ? "Generating six-step slides..." : chosenStrategy === "experience bridging" ? "Generating experience-bridging slides..." : "Generating five slides...");
      const context = { lessonNumber: chosenLesson, strategy: chosenStrategy, textModel: chosenModels.textModel, promptVersion: chosenPrompt, classroomContext: chosenClassroomContext,
        ...(chosenStrategy === "analogy" ? { analogyMethod: chosenMethod } : {}) };
      const result = await post("/api/slides", { ...context, operation: review ? "review" : "generate", ...(review && deck ? { draft: deck.draft, feedback: [feedback, ...issues, ...qualityIssues].join("\n").slice(0, 6000) } : {}) }, controller);
      const draft = parseDraft(result.draft, chosenStrategy, true);
      let next: SlideDeck = { id: review && deck ? deck.id : crypto.randomUUID(), lessonNumber: chosenLesson, strategy: chosenStrategy, draft, classroomContext: chosenClassroomContext, assets: preservedAssets(review ? deck : null, draft), checks: review ? deck?.checks : undefined, modelSelection: chosenModels, textModel: result.model, promptProvenance: result.promptProvenance };
      if (controller.signal.aborted) return;
      // Bounded native repairs; retain drafts on failure and never loop on provider errors.
      setDeck(next); setIndex(0); setReviewed(false); setDownloaded(false);
      next = await checkText(next, controller);
      const textFindings = (candidate: SlideDeck) => [...(candidate.checks?.text?.issues || []), ...layoutErrors(candidate, browserMeasure())];
      for (let attempt = 0; attempt < 2 && textFindings(next).length; attempt++) {
        setStatus("Correcting slide content and layout...");
        const repaired = await post("/api/slides", { ...context, operation: "review", draft: next.draft, feedback: textFindings(next).join("\n").slice(0, 6000) }, controller);
        const corrected = parseDraft(repaired.draft, chosenStrategy, true);
        const unchanged = JSON.stringify(corrected) === JSON.stringify(next.draft);
        next = { ...next, draft: corrected, assets: preservedAssets(next, corrected), textModel: repaired.model, promptProvenance: repaired.promptProvenance };
        showDraft(next, controller);
        next = await checkText(next, controller);
        if (unchanged) break;
      }
      if (controller.signal.aborted) return;
      if (next.checks?.text?.issues.length) { setStatus("Draft retained. Teaching-content corrections needed."); return; }
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
        catch (err) { if (!controller.signal.aborted) failures.push(`${label(visual.id)}: ${err instanceof Error ? err.message : "Image generation failed."}`); }
      }
      if (controller.signal.aborted) return;
      setError(failures.join("\n")); setStatus(failures.length ? "Slide text ready. Some images need a retry." : layoutErrors(next, browserMeasure()).length ? "Draft retained. Layout corrections needed." : qualityErrors(next).length ? "Draft retained. Image corrections needed." : `${next.draft.slides.length} slides ready for review.`);
      if (failures.length) setTab("images");
    });
  }
  function edit(field: keyof Omit<TeachingSlide, "stage">, value: string | string[]) {
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
      const checked = await checkImage(next, visualId, controller);
      if (!controller.signal.aborted) setStatus(qualityErrors(checked).length ? "Image updated. Quality check needs attention." : "Image updated.");
    });
  }
  function editVisual(id: string, field: keyof Omit<SlideVisual, "id">, value: string) {
    setDeck(current => current ? { ...current, draft: { ...current.draft, visuals: current.draft.visuals.map(visual => visual.id === id ? { ...visual, [field]: value } : visual) } } : current);
    setReviewed(false); setDownloaded(false); setStatus("");
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
      if (!controller.signal.aborted) setStatus(qualityErrors(next).length || layoutErrors(next, browserMeasure()).length ? "Draft retained. Corrections needed." : "Quality checks complete. Teacher review pending.");
    });
  }
  async function download() {
    if (!deck || !reviewed || busy || qualityIssues.length || exportJob.current) return;
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
    if (!deck || !ready || !reviewed || busy || publishJob.current || publishedDeck === deck || !classId || !assignmentId) return;
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
  const missingImages = deck?.draft.visuals.some(visual => !deck.assets[visual.id]);
  const slide = deck?.draft.slides[index];
  const ready = !!deck && !missingImages && !issues.length && !qualityIssues.length;

  const Container = embedded ? "section" : "main";
  const Heading = embedded ? "h3" : "h1";
  return <Container aria-label={embedded ? `${label(strategy)} slides` : undefined} className={embedded ? "min-w-0" : "mx-auto max-w-7xl px-5 pb-12"}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
      <Heading className="text-2xl font-semibold">{embedded ? `${label(strategy)} slides` : "Teaching slides"}</Heading>
      {deck && <span className="text-sm text-gray-500">{deck === savedDeck ? "Saved on this device" : storageError ? "Unsaved draft" : "Saving draft..."}{downloaded ? " · Export prepared" : ""}</span>}
    </div>
    <div className="grid items-end gap-3 border-b border-gray-200 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      {!embedded && <><label className="min-w-0 text-sm font-medium">Lesson<select aria-label="Lesson" className={`${input} mt-2`} value={lessonNumber} disabled={busy || !lessons.length} onChange={e => setLessonNumber(Number(e.target.value))}>{lessons.map(lesson => <option key={lesson.lessonNumber} value={lesson.lessonNumber}>{lesson.lessonNumber}. {lesson.lessonTitle}</option>)}</select></label>
      <label className="min-w-0 text-sm font-medium">Strategy<select aria-label="Strategy" className={`${input} mt-2`} value={strategy} disabled={busy} onChange={e => setStrategy(e.target.value as SlideStrategy)}>{STRATEGIES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label></>}
      <div className="grid min-w-0 gap-3 sm:col-span-3 sm:grid-cols-3">
        <label className="min-w-0 text-sm font-medium">Prompt version<select aria-label="Prompt version" className={`${input} mt-2`} disabled={busy} value={promptVersion} onChange={e => setPromptVersion(e.target.value as SlidePromptVersion)}>{PROMPT_VERSIONS.map(value => <option key={value} value={value}>{PROMPT_LABELS[value]}</option>)}</select></label>
        <label className="min-w-0 text-sm font-medium">Text model<select aria-label="Text model" className={`${input} mt-2`} disabled={busy} value={selection.textModel} onChange={e => setSelection(current => ({ ...current, textModel: e.target.value }))}>{models.text.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
        <label className="min-w-0 text-sm font-medium">Image model<select aria-label="Image model" className={`${input} mt-2`} disabled={busy} value={selection.imageModel} onChange={e => setSelection(current => ({ ...current, imageModel: e.target.value }))}>{models.image.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
      </div>
      {strategy === "analogy" && <label className="min-w-0 text-sm font-medium sm:col-span-3">Analogy story
        <select aria-label="Analogy story" className={`${input} mt-2`} disabled={busy} value={analogyMethod} onChange={e => setAnalogyMethod(e.target.value as AnalogyMethod)}>{ANALOGY_METHODS.map(value => <option key={value} value={value}>{storyLabels[value]}</option>)}</select>
        <span className="mt-1 block text-xs font-normal text-gray-600">{storyDescriptions[analogyMethod]} {analogyMethod === "six-step" ? "The first two slides show the target only; the familiar analogue first appears on slide 3." : "Earlier method: target and familiar situation appear together on the first slide."}</span>
        {deck?.strategy === "analogy" && resolveAnalogyMethod(deck.draft.analogyMethod) !== analogyMethod && <span className="mt-1 block text-xs font-normal text-gray-600">This choice applies to new slides. The current slides and AI revisions keep {storyLabels[resolveAnalogyMethod(deck.draft.analogyMethod)]}.</span>}
      </label>}
      {sharedClassroomContext === undefined && <label className="min-w-0 text-sm font-medium sm:col-span-3">Classroom context (optional)
        <textarea aria-label="Classroom context (optional)" aria-describedby={classroomHelpId} className={`${input} mt-2`} rows={2} maxLength={1200} disabled={busy} value={classroomContext} onChange={e => setClassroomContext(e.target.value)} placeholder="Grade, prior knowledge, familiar experiences, what students find hard to picture, and classroom constraints" />
        <span id={classroomHelpId} className="mt-1 block text-xs font-normal text-gray-500">Used for new slides. Revisions and checks keep the draft&apos;s original context.</span>
      </label>}
      {!embedded && <button className={`${primaryButton} sm:col-start-3 sm:row-start-1`} disabled={busy || !canGenerate} onClick={() => generate()}><Sparkles size={17} />{deck ? "Generate new slides" : "Generate slides"}</button>}
    </div>
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
        <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{deck.draft.title}</h2><p className="mt-1 text-sm text-gray-500">Lesson {deck.lessonNumber} · {label(deck.strategy)} · {deck.draft.slides.length} slides{deck.strategy === "analogy" ? ` · ${storyLabels[resolveAnalogyMethod(deck.draft.analogyMethod)]}` : ""}</p>{deck.textModel && <p className="mt-1 break-words text-xs text-gray-500">Text: {deck.textModel}</p>}</div>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy} onClick={checkCurrent}><ScanEye size={16} />Check slides</button>
          <button className={button} disabled={busy} onClick={() => generate(true)} title="Apply feedback and correct quality findings"><RefreshCw size={16} />Revise with AI</button>
          <button className={icon} disabled={!!issues.length} title="Enlarge preview" aria-label="Enlarge preview" onClick={() => dialog.current?.showModal()}><Expand size={17} /></button>
          <button className={button} disabled={busy || !ready || !reviewed} onClick={download}><Download size={17} />Download PPTX</button>
          <button className={primaryButton} disabled={busy || !ready || !reviewed || !classId || !assignmentId || publishedDeck === deck} onClick={publish}><Send size={17} />{publishedDeck === deck ? "Published" : "Send to students"}</button>
          {preparedDownload?.deck === deck && !busy && ready && reviewed && <><a className={button} href={preparedDownload.httpUrl || preparedDownload.dataUri || preparedDownload.url} download={preparedDownload.fileName}>Save PPTX file</a>{preparedDownload.httpUrl && <p className="text-xs text-gray-500">Save link expires in 10 minutes. Select Download PPTX again to refresh it.</p>}</>}
        </div>
      </div>
      {deck.promptProvenance && <p className="mb-3 break-words text-xs text-gray-500">{PROMPT_LABELS[deck.promptProvenance.version]} · {deck.promptProvenance.revision}</p>}
      <label className="mb-5 block text-sm font-medium">Revision request<textarea aria-label="Revision request" className={`${input} mt-2 resize-y`} rows={2} maxLength={3000} disabled={busy} value={feedback} onChange={e => setFeedback(e.target.value)} /></label>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Slide preview" className="min-w-0">
          <SlidePreview deck={deck} index={index} />
          <div className="my-3 flex items-center justify-between gap-2">
            <button className={icon} title="Previous slide" aria-label="Previous slide" disabled={index === 0} onClick={() => setIndex(n => n - 1)}><ChevronLeft size={19} /></button>
            <span className="text-sm tabular-nums">{index + 1} / {deck.draft.slides.length}</span>
            <button className={icon} title="Next slide" aria-label="Next slide" disabled={index === deck.draft.slides.length - 1} onClick={() => setIndex(n => n + 1)}><ChevronRight size={19} /></button>
          </div>
          <ol className="divide-y divide-gray-200 border-y border-gray-200">{deck.draft.slides.map((item, n) => <li key={item.stage}><button className={`flex min-h-11 w-full items-start gap-3 px-3 py-3 text-left text-sm ${index === n ? "bg-teal-50 text-teal-900" : "hover:bg-gray-100"}`} aria-current={index === n ? "step" : undefined} onClick={() => setIndex(n)}><span className="font-mono">{n + 1}</span><span className="min-w-0 break-words">{item.title}</span></button></li>)}</ol>
          <label className="mt-5 flex items-start gap-3 text-sm"><input type="checkbox" checked={reviewed} disabled={!ready || busy} onChange={e => setReviewed(e.target.checked)} className="mt-1 accent-teal-800" />I have reviewed all {deck.draft.slides.length} slides and their images.</label>
        </section>
        <aside aria-label="Slide editor" className="min-w-0 border-t border-gray-200 lg:border-t-0">
          <div className="mb-4 flex border-b border-gray-200" role="tablist" aria-label="Slide fields">{(["text", "notes", "images"] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} className={`flex-1 border-b-2 px-2 py-3 text-sm ${tab === value ? "border-teal-800 font-semibold text-teal-900" : "border-transparent text-gray-600"}`} onClick={() => setTab(value)}>{label(value)}</button>)}</div>
          {tab === "text" && <div className="space-y-4">{(["title", "body", "task"] as const).map(field => <label key={field} className="block text-sm font-medium">{field === "task" ? "Thinking task" : label(field)}<textarea aria-label={`Slide ${field}`} className={`${input} mt-2 resize-y`} rows={field === "title" ? 2 : 4} disabled={busy} value={slide[field]} onChange={e => edit(field, e.target.value)} />{field === "body" && deck.strategy !== "analogy" && <span className="mt-1 block text-xs font-normal text-gray-600">{slide.stage === "question" ? "Leave this empty. Put the recap and lesson transition in Notes; students see their question task and writing card." : "Optional when the picture and thinking task provide enough context."}</span>}</label>)}{index === analogyMappingIndex(deck.draft.analogyMethod) && deck.draft.analogyPlan && analogyStudentFields(deck.draft.analogyMethod).map(field => <label key={field} className="block text-sm font-medium">{field === "mappingHint" ? "Visible comparison hint" : "Student response starter"}<textarea className={`${input} mt-2 resize-y`} rows={2} maxLength={field === "mappingHint" ? 140 : 100} disabled={busy} value={deck.draft.analogyPlan![field]} onChange={e => editMapping(field, e.target.value)} /></label>)}</div>}
          {tab === "notes" && <div className="space-y-4">{deck.strategy !== "analogy" && <p className="text-xs text-gray-600">Private guidance, exported as speaker notes: purpose and reasoning, then possible responses, a follow-up if students are stuck, and the spoken transition. Up to 150 words / 900 characters per note.</p>}{[0, 1].map(n => <label key={n} className="block text-sm font-medium">Teacher note {n + 1}<textarea className={`${input} mt-2 resize-y`} rows={4} disabled={busy} value={slide.teacherNotes[n] || ""} onChange={e => { const notes = [...slide.teacherNotes]; notes[n] = e.target.value; edit("teacherNotes", notes); }} onBlur={() => edit("teacherNotes", slide.teacherNotes.filter(value => value.trim()))} /></label>)}</div>}
          {tab === "notes" && deck.draft.analogyPlan && <details className="mt-5 border-t border-gray-200 pt-4 text-sm"><summary className="cursor-pointer font-medium">Teaching design for this comparison</summary><dl className="mt-3 space-y-3">{Object.entries(deck.draft.analogyPlan).filter(([key, value]) => value && !analogyStudentFields(deck.draft.analogyMethod).some(field => field === key)).map(([key, value]) => <div key={key}><dt className="font-medium">{label(key.replace(/([A-Z])/g, " $1").toLowerCase())}</dt><dd className="mt-1 text-gray-600">{value}</dd></div>)}</dl></details>}
          {tab === "images" && <ul className="divide-y divide-gray-200">{deck.draft.visuals.map(visual => <li key={visual.id} className="space-y-3 py-3 first:pt-0"><h3 className="text-sm font-medium">{label(visual.id)}</h3>{(["prompt", "caption", "alt"] as const).map(field => <label key={field} className="block text-sm font-medium">{field === "prompt" ? "Image plan" : field === "alt" ? "Alt text" : "Caption"}<textarea aria-label={`${visual.id} ${field}`} className={`${input} mt-2 resize-y`} rows={field === "prompt" ? 5 : 2} disabled={busy} maxLength={field === "prompt" ? 1800 : field === "caption" ? 85 : 160} value={visual[field]} onChange={e => editVisual(visual.id, field, e.target.value)} /></label>)}{deck.assets[visual.id]?.model && <p className="break-words text-xs text-gray-500">{deck.assets[visual.id].model}</p>}<div className="flex items-center justify-between gap-2 text-sm"><span>{!deck.assets[visual.id] ? "Missing" : !imageMatchesPlan(deck, visual.id) ? "Plan changed" : deck.checks?.images[visual.id]?.key !== imageCheckKey(deck, visual.id) ? "Check pending" : deck.checks?.images[visual.id]?.issues.length ? "Needs correction" : "Ready"}</span><button className={icon} disabled={busy || !!issues.length} title={`Regenerate ${visual.id} image`} aria-label={`Regenerate ${visual.id} image`} onClick={() => retryImage(visual.id)}><ImagePlus size={18} /></button></div></li>)}</ul>}
        </aside>
      </div>
      {!!issues.length && <div role="alert" className="mt-5 border-l-4 border-red-700 bg-red-50 p-4 text-sm text-red-900"><ul className="space-y-2">{issues.map((issue, n) => <li key={n} className="whitespace-pre-line break-words">{issue}</li>)}</ul></div>}
      {!!qualityIssues.filter(issue => !findings.includes(issue)).length && !busy && <div role="alert" className="mt-5 border-l-4 border-amber-700 bg-amber-50 p-4 text-sm text-amber-950"><ul className="space-y-2">{qualityIssues.filter(issue => !findings.includes(issue)).map((issue, n) => <li key={n} className="break-words">{issue}</li>)}</ul></div>}
      {!!findings.length && !busy && <section aria-label="Teacher quality decision" className="mt-5 border-l-4 border-amber-700 bg-amber-50 p-4 text-sm text-amber-950">
        <h3 className="font-semibold">AI review findings</h3>
        <ul className="my-3 space-y-2" role="alert">{findings.map((finding, n) => <li key={n} className="break-words">{finding}</li>)}</ul>
        <label className="block font-medium">Teacher decision note<textarea aria-label="Teacher decision note" className={`${input} mt-2`} rows={3} maxLength={1000} value={decisionReason} onChange={e => { setDecisionReason(e.target.value); setDeck(current => current ? { ...current, teacherDecision: undefined } : current); setReviewed(false); setDownloaded(false); }} /></label>
        <button className={`${button} mt-3`} disabled={decisionReason.trim().length < 10 || !!issues.length || !!missingImages || !!qualityErrors(deck, false).length || hasTeacherDecision(deck)} onClick={() => { setDeck({ ...deck, teacherDecision: { reason: decisionReason.trim(), draftKey: textCheckKey(deck), checks: deck.checks!, assets: deck.assets } }); setReviewed(false); setDownloaded(false); }}><ScanEye size={16} />Accept after teacher review</button>
        {hasTeacherDecision(deck) && <p className="mt-2 font-medium">Teacher decision recorded for this version.</p>}
      </section>}
      {!!missingImages && !busy && <p className="mt-3 text-sm text-amber-900">Images pending. Download unavailable.</p>}
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
