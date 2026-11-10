"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, ArrowRight, Check, X } from "lucide-react";
import type { QuizItem } from "@/lib/types";
import type { QuizPreview, TaskQuizController } from "./useTaskQuiz";

const primary = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-mute";
const secondary = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50";

/** Closes on Escape and moves focus in, then back to where it was. */
function useDialogFocus(onClose: () => void) {
  const first = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); before?.focus?.(); };
  }, []);
  return first;
}

function PreviewQuestion({ item, confidence, number }: { item: QuizItem; confidence?: QuizItem; number: number }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-start gap-3.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-line-2 text-[13px] font-bold text-ink-2">{number}</span>
        <div className="min-w-0 flex-1">
          <p className="pt-0.5 text-[15px] font-semibold leading-snug text-ink">{item.stem}</p>
          {item.image && (
            // eslint-disable-next-line @next/next/no-img-element -- lesson images can be data URLs, as in the student quiz
            <img src={item.image} alt={`Visual reference for question ${number}`} className="mt-4 h-auto max-h-[28rem] w-full max-w-md rounded-xl border border-line bg-white object-contain" />
          )}
          <div className="mt-4 grid gap-2.5">
            {Object.entries(item.options).map(([key, value]) => (
              <div key={key} className="flex items-center gap-3.5 rounded-xl border border-line bg-white px-4 py-3 text-[15px] text-ink">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-line-2 text-xs font-bold text-ink-2">{key}</span>
                <span className="min-w-0 break-words">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {confidence && (
        <div className="mt-5 border-t border-dashed border-line pt-4 sm:ml-[42px]">
          <p className="text-sm text-mute">{confidence.stem}</p>
          <div className="mt-2.5 grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-line">
            {Object.entries(confidence.options).map(([key, value]) => (
              <span key={key} className="min-h-12 min-w-0 break-words border-r border-line px-1 py-3 text-center text-[11px] font-medium sm:text-xs leading-snug text-ink-2 last:border-r-0">{value}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PreviewDialog({ preview, onClose }: { preview: QuizPreview; onClose: () => void }) {
  const closeButton = useDialogFocus(onClose);
  const confidence = new Map(preview.items.filter((item) => item.type === "confidence_check").map((item) => [item.item_id, item]));
  const questions = preview.items.filter((item) => item.type === "multiple_choice");
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="task-quiz-preview-title" className="flex w-full max-w-2xl flex-col gap-4 rounded-2xl bg-canvas p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">Student preview</p>
            <h2 id="task-quiz-preview-title" className="mt-1 text-xl font-bold tracking-tight text-ink">{preview.heading}</h2>
          </div>
          <button ref={closeButton} type="button" aria-label="Close preview" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-white text-ink hover:bg-canvas"><X size={16} /></button>
        </div>
        {questions.map((item, index) => <PreviewQuestion key={item.item_id} item={item} confidence={confidence.get(`${item.item_id}_confidence`)} number={item.question_number ?? index + 1} />)}
      </div>
    </div>
  );
}

function ReplaceDialog({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) {
  const keep = useDialogFocus(onNo);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="task-quiz-replace-title" className="w-full max-w-md rounded-2xl bg-white p-5">
        <h2 id="task-quiz-replace-title" className="text-base font-semibold text-ink">{text}</h2>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={keep} type="button" onClick={onNo} className={secondary}>Keep them</button>
          <button type="button" onClick={onYes} className={primary}>Replace</button>
        </div>
      </div>
    </div>
  );
}

/** The bar at the bottom of Step 1, with what it opens: preview, the replace question, and messages (UC 4.5). */
export default function TaskQuizPublishBar({ quiz, onGoToStep2 }: { quiz: TaskQuizController; onGoToStep2: () => void }) {
  const { view, toast, prompt, preview, publishedBar } = quiz;
  if (!view) return null;
  const previewButton = (
    <button type="button" disabled={!view.items.length || Boolean(quiz.busy)} onClick={() => void quiz.openPreview()} className={secondary}>Preview as student</button>
  );
  return (
    <>
      <div role="region" aria-label="Publish" className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 sm:flex-row sm:items-center">
        {view.locked ? (
          <>
            <Check size={18} className="hidden shrink-0 text-ok sm:block" />
            <p className="min-w-0 flex-1 text-sm text-ink">
              <b className="font-semibold">{publishedBar?.published ?? "Task published."}</b>{" "}
              {publishedBar && <span className="text-mute">{publishedBar.progress}</span>}
            </p>
            {previewButton}
            {publishedBar?.canGoToStep2 && <button type="button" onClick={onGoToStep2} className={primary}>Go to Step 2<ArrowRight size={15} /></button>}
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1 text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-ink">
                {view.canPublish ? <Check size={15} className="text-ok" /> : <AlertTriangle size={15} className="text-warn" />}
                {view.publishBarCount}
              </p>
              {!view.items.length && view.publishProblems[0] && <p className="mt-0.5 text-xs text-mute">{view.publishProblems[0]}</p>}
            </div>
            {previewButton}
            <button type="button" disabled={!view.canPublish || Boolean(quiz.busy)} onClick={quiz.publish} className={primary}>{quiz.busy === "publish" ? "Publishing…" : "Publish task"}</button>
          </>
        )}
      </div>
      {preview && <PreviewDialog preview={preview} onClose={quiz.closePreview} />}
      {prompt && <ReplaceDialog text={prompt.text} onNo={quiz.closePrompt} onYes={() => { quiz.closePrompt(); prompt.proceed(); }} />}
      {toast && (
        <div role={toast.kind === "error" ? "alert" : "status"} className={`fixed bottom-4 left-1/2 z-50 flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${toast.kind === "error" ? "bg-bad text-white" : "bg-ink text-white"}`}>
          <span className="min-w-0">{toast.text}</span>
          <button type="button" aria-label="Close message" onClick={quiz.closeToast} className="grid h-7 w-7 shrink-0 place-items-center rounded hover:bg-white/20"><X size={14} /></button>
        </div>
      )}
    </>
  );
}
