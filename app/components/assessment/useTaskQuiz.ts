"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scopedTaskFetch } from "@/lib/client-auth";
import type { ItemChange, QuizSource, TaskQuizView } from "@/lib/task-quiz";
import type { QuizItem } from "@/lib/types";

/** The state and server calls behind Step 1's Quiz tab and publish bar (#177). The routes are in app/api/task-quiz. */

export type LessonChoice = { lessonNumber: number; title: string; currentVersion: number };
export type LessonCardData = {
  number: number; version: number; title: string; objective: string; coreIdeas: string[];
  misconceptions: { id: string; text: string; addedByYou?: boolean }[];
};
export type PublishedBar = { published: string; progress: string; canGoToStep2: boolean; classSize: number | null };
export type QuizPreview = { heading: string; items: QuizItem[] };
export type QuizToast = { kind: "ok" | "error"; text: string };
export type ReplacePrompt = { text: string; proceed: () => void };
export type CreateSettings = { count: number; focus: "all" | number; readingLevel: string };
export type QuizBusy = "lesson" | "source" | "upload" | "link" | "create" | "match" | "item" | "publish" | "preview" | null;

type Options = {
  classId?: string;
  assignmentId?: string;
  /** A lesson this task already points at (an old draft), shown first until the teacher picks. */
  suggestedLesson?: number | null;
  /** Step 1 is on screen, so the submitted count keeps itself up to date. */
  active?: boolean;
  onLessonKnown?: (lessonNumber: number) => void;
  onLessonPicked?: (lessonNumber: number) => void;
  onPublished?: (lessonNumber: number) => void;
};

const TOO_LARGE = "Files up to 10 MB";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const NO_CONNECTION = "Couldn't reach the server — try again";
const POLL_MS = 20_000;
const TOAST_MS = 6_000;

const readJson = (response: Response): Promise<Record<string, never> & Record<string, unknown>> =>
  response.json().catch(() => ({})) as Promise<Record<string, never> & Record<string, unknown>>;

export function useTaskQuiz({ classId, assignmentId, suggestedLesson, active, onLessonKnown, onLessonPicked, onPublished }: Options) {
  const enabled = Boolean(classId && assignmentId);
  const scope = { classId: classId ?? "", assignmentId: assignmentId ?? "" };
  const query = `classId=${encodeURIComponent(scope.classId)}&assignmentId=${encodeURIComponent(scope.assignmentId)}`;

  const [view, setView] = useState<TaskQuizView | null>(null);
  const [legacyStatus, setLegacyStatus] = useState<string | null>(null);
  const [publishedBar, setPublishedBar] = useState<PublishedBar | null>(null);
  const [lessons, setLessons] = useState<LessonChoice[]>([]);
  const [firstCard, setFirstCard] = useState<LessonCardData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<QuizBusy>(null);
  const [toast, setToast] = useState<QuizToast | null>(null);
  const [prompt, setPrompt] = useState<ReplacePrompt | null>(null);
  const [preview, setPreview] = useState<QuizPreview | null>(null);
  const [tab, setTab] = useState<QuizSource | null>(null);
  // The teacher said yes to replacing reviewed items, and the new items are still to come.
  const [replaceAgreed, setReplaceAgreed] = useState(false);

  const newestRevision = useRef(-1);
  const callbacks = useRef({ onLessonKnown, onLessonPicked, onPublished });
  useEffect(() => { callbacks.current = { onLessonKnown, onLessonPicked, onPublished }; });

  /** A slow reply can't undo a newer one. */
  const showView = useCallback((next: TaskQuizView) => {
    if (next.revision < newestRevision.current) return;
    newestRevision.current = next.revision;
    setView(next);
  }, []);

  const post = (path: string, body: Record<string, unknown>) => scopedTaskFetch(scope, path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scope, ...body }),
  });

  const loadState = useCallback(async (isStale: () => boolean = () => false) => {
    const response = await scopedTaskFetch({ classId, assignmentId }, `/api/task-quiz?${query}`, { cache: "no-store" });
    const data = await readJson(response);
    if (isStale()) return;
    const quiz = data.quiz as TaskQuizView | undefined;
    if (!response.ok || !quiz) throw new Error(typeof data.error === "string" ? data.error : "The quiz could not be loaded.");
    showView(quiz);
    setLegacyStatus((data.legacyStatus as string | null | undefined) ?? null);
    setPublishedBar((data.publishedBar as PublishedBar | undefined) ?? null);
    setLoadError("");
    if (quiz.lesson) callbacks.current.onLessonKnown?.(quiz.lesson.number);
  }, [classId, assignmentId, query, showView]);

  const load = useCallback(async (isStale: () => boolean = () => false) => {
    try {
      const [response] = await Promise.all([
        scopedTaskFetch({ classId, assignmentId }, `/api/task-quiz/lesson?${query}`, { cache: "no-store" }),
        loadState(isStale),
      ]);
      const data = await readJson(response);
      if (isStale()) return;
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The lessons could not be loaded.");
      setLessons((data.lessons as LessonChoice[] | undefined) ?? []);
      setFirstCard((data.lesson as LessonCardData | null | undefined) ?? null);
    } catch (reason) {
      if (!isStale()) setLoadError(reason instanceof Error ? reason.message : "The quiz could not be loaded.");
    }
  }, [classId, assignmentId, query, loadState]);

  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    newestRevision.current = -1;
    void load(() => stale);
    return () => { stale = true; };
  }, [enabled, load]);

  // The class's submitted count, while the teacher is looking at it.
  const published = view?.status === "published";
  useEffect(() => {
    if (!enabled || !published || !active) return;
    const timer = window.setInterval(() => { void loadState().catch(() => {}); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, published, active, loadState]);

  // An old draft's lesson comes first, until a lesson is picked here.
  const pinnedLesson = view?.lesson?.number;
  const quizLoaded = Boolean(view);
  useEffect(() => {
    if (!enabled || !quizLoaded || !suggestedLesson || pinnedLesson || firstCard?.number === suggestedLesson) return;
    let stale = false;
    scopedTaskFetch({ classId, assignmentId }, `/api/task-quiz/lesson?${query}&lessonNumber=${suggestedLesson}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await readJson(response);
        if (!stale && response.ok && data.lesson) setFirstCard(data.lesson as LessonCardData);
      })
      .catch(() => {});
    return () => { stale = true; };
  }, [enabled, quizLoaded, classId, assignmentId, query, suggestedLesson, pinnedLesson, firstCard?.number]);

  // Good news goes away by itself. A failure stays until it's closed or the teacher does something else.
  useEffect(() => {
    if (toast?.kind !== "ok") return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /** One server call, asking first when the server says reviewed items would be replaced. */
  async function run(kind: Exclude<QuizBusy, null>, send: (confirmReplace: boolean) => Promise<Response>, confirmReplace: boolean, done?: (data: Record<string, unknown>) => void) {
    setBusy(kind);
    setToast(null);
    try {
      const response = await send(confirmReplace);
      const data = await readJson(response);
      if (response.status === 409 && data.code === "confirm_replace") {
        setPrompt({ text: String(data.error), proceed: () => { void run(kind, send, true, done); } });
        return;
      }
      if (!response.ok) {
        setToast({ kind: "error", text: typeof data.error === "string" ? data.error : "That didn't work — try again" });
        if (response.status === 409) await loadState().catch(() => {});
        return;
      }
      if (data.quiz) showView(data.quiz as unknown as TaskQuizView);
      if (typeof data.message === "string") setToast({ kind: "ok", text: data.message });
      done?.(data);
    } catch {
      setToast({ kind: "error", text: NO_CONNECTION });
    } finally {
      setBusy(null);
    }
  }

  const afterNewItems = (source: QuizSource) => () => { setTab(source); setReplaceAgreed(false); };

  function pickLesson(lessonNumber: number) {
    void run("lesson", (confirmReplace) => post("/api/task-quiz/lesson", { lessonNumber, confirmReplace }), false, () => {
      afterNewItems("provided")();
      callbacks.current.onLessonPicked?.(lessonNumber);
    });
  }

  /** Provided swaps straight away. The other two swap when their items arrive, so a failure leaves this quiz in place. */
  function chooseSource(source: QuizSource) {
    if (!view || view.locked) return;
    if (source === "provided") {
      if (view.source === "provided") { afterNewItems("provided")(); return; }
      void run("source", (confirmReplace) => post("/api/task-quiz/source", { source, confirmReplace }), false, afterNewItems("provided"));
      return;
    }
    if (view.source !== source && view.reviewedCount > 0 && !replaceAgreed && view.replacePrompt) {
      setPrompt({ text: view.replacePrompt, proceed: () => { setReplaceAgreed(true); setTab(source); } });
      return;
    }
    setTab(source);
  }

  function uploadFile(file: File) {
    setToast(null);
    if (file.size > MAX_FILE_BYTES) { setToast({ kind: "error", text: TOO_LARGE }); return; }
    void run("upload", (confirmReplace) => scopedTaskFetch(
      scope,
      `/api/task-quiz/upload?${query}&fileName=${encodeURIComponent(file.name)}${confirmReplace ? "&confirmReplace=1" : ""}`,
      { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file },
    ), replaceAgreed, afterNewItems("uploaded"));
  }

  function importLink(url: string) {
    void run("link", (confirmReplace) => post("/api/task-quiz/link", { url, confirmReplace }), replaceAgreed, afterNewItems("uploaded"));
  }

  function createItems(settings: CreateSettings) {
    void run("create", (confirmReplace) => post("/api/task-quiz/create", { ...settings, confirmReplace }), replaceAgreed, afterNewItems("ai"));
  }

  function matchAll() {
    void run("match", () => post("/api/task-quiz/match", {}), false);
  }

  function changeItem(itemId: string, change: ItemChange) {
    void run("item", () => post("/api/task-quiz/item", { itemId, ...change }), false);
  }

  /** Quietly saved when the teacher leaves the box. */
  async function saveAnchoring(text: string) {
    try {
      const response = await post("/api/task-quiz/anchoring", { anchoringPhenomenon: text });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Couldn't save the anchoring phenomenon — try again");
      if (data.quiz) showView(data.quiz as unknown as TaskQuizView);
    } catch (reason) {
      setToast({ kind: "error", text: reason instanceof Error && reason.name !== "TypeError" ? reason.message : NO_CONNECTION });
    }
  }

  function publish() {
    if (!view?.lesson) return;
    const lessonNumber = view.lesson.number;
    void run("publish", () => post("/api/task-quiz/publish", { revision: view.revision }), false, (data) => {
      setPublishedBar((data.publishedBar as PublishedBar | undefined) ?? null);
      callbacks.current.onPublished?.(lessonNumber);
    });
  }

  async function openPreview() {
    setBusy("preview");
    setToast(null);
    try {
      const response = await scopedTaskFetch(scope, `/api/task-quiz/preview?${query}`, { cache: "no-store" });
      const data = await readJson(response);
      if (!response.ok) { setToast({ kind: "error", text: typeof data.error === "string" ? data.error : "The preview could not be loaded." }); return; }
      setPreview({ heading: String(data.heading), items: data.items as unknown as QuizItem[] });
    } catch {
      setToast({ kind: "error", text: NO_CONNECTION });
    } finally {
      setBusy(null);
    }
  }

  /** The file the items came from, so the teacher can check them against it. */
  async function openSourceFile() {
    try {
      const response = await scopedTaskFetch(scope, `/api/task-quiz/source-file?${query}`, { cache: "no-store" });
      const data = await readJson(response);
      if (!response.ok || typeof data.url !== "string") throw new Error();
      window.open(data.url, "_blank", "noopener");
    } catch {
      setToast({ kind: "error", text: "Couldn't open that file — try again" });
    }
  }

  const reload = useCallback(() => load(), [load]);

  return {
    enabled, view, lessons, firstCard, publishedBar, legacyStatus, loadError, busy, toast, prompt, preview,
    /** Published the old way, so the older Step 1 stays in charge of it. */
    legacy: enabled && view?.status !== "published" && (legacyStatus === "published" || legacyStatus === "closed"),
    tab: view?.locked ? view.source ?? "provided" : tab ?? view?.source ?? "provided",
    replaceAgreed,
    reload, pickLesson, chooseSource, uploadFile, importLink, createItems, matchAll, changeItem, saveAnchoring, publish, openPreview, openSourceFile,
    closePreview: () => setPreview(null),
    closeToast: () => setToast(null),
    closePrompt: () => setPrompt(null),
  };
}

export type TaskQuizController = ReturnType<typeof useTaskQuiz>;
