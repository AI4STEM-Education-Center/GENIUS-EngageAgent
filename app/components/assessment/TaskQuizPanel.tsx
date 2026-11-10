"use client";

import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BookOpen, FileText, Link2, Lock, Sparkles, Upload } from "lucide-react";
import { ITEM_COUNTS, READING_LEVELS, type QuizSource } from "@/lib/task-quiz";
import QuizItemCard, { pill, pillClass } from "./QuizItemCard";
import type { LessonCardData, TaskQuizController } from "./useTaskQuiz";

const fieldLabel = "text-xs font-semibold uppercase tracking-wide text-mute";
const field = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:bg-canvas disabled:text-ink-2";
const primary = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-mute";
const secondary = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50";
const aiPrimary = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-ai px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

function LessonCard({ quiz, disabled }: { quiz: TaskQuizController; disabled?: boolean }) {
  const view = quiz.view!;
  const card: LessonCardData | null = view.lesson ?? quiz.firstCard;
  const locked = view.locked;
  const busy = Boolean(quiz.busy) || Boolean(disabled);
  const [anchoring, setAnchoring] = useState<string | null>(null);
  const anchoringValue = anchoring ?? view.anchoringPhenomenon;
  return (
    <section aria-label="Lesson details" className="flex flex-col gap-6 rounded-2xl border border-line bg-white p-5 md:flex-row">
      <div className="md:w-64 md:shrink-0">
        <label htmlFor="task-quiz-lesson" className={fieldLabel}>Lesson</label>
        <select id="task-quiz-lesson" value={card?.number ?? ""} disabled={locked || busy || !quiz.lessons.length} onChange={(event) => quiz.pickLesson(Number(event.target.value))} className={`${field} mt-1.5`}>
          {quiz.lessons.map((lesson) => <option key={lesson.lessonNumber} value={lesson.lessonNumber}>{lesson.title}</option>)}
        </select>
        {view.lockedLabel && <p className="mt-1.5 flex items-center gap-1 text-xs text-mute"><Lock size={12} />{view.lockedLabel}</p>}
        {!view.lesson && card && (
          <button type="button" disabled={busy} onClick={() => quiz.pickLesson(card.number)} className={`${primary} mt-3 w-full`}>Use this lesson</button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {card ? (
          <>
            <p className={fieldLabel}>Learning objective</p>
            <p className="mt-1.5 text-sm leading-6 text-ink-2">{card.objective}</p>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <div className="min-w-0">
                <p className={fieldLabel}>Core ideas</p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-ink-2">{card.coreIdeas.map((idea, index) => <li key={index}>{idea}</li>)}</ol>
              </div>
              <div className="min-w-0">
                <p className={fieldLabel}>Common misconceptions</p>
                <ul className="mt-1.5 grid gap-1.5 text-sm text-ink-2">
                  {card.misconceptions.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-2">
                      <span className="shrink-0 rounded bg-line-2 px-1.5 py-0.5 font-mono text-xs font-semibold text-ink-2">{entry.id}</span>
                      <span className="min-w-0">{entry.text}{entry.addedByYou && <span className={`${pill} ${pillClass.ai} ml-2`}>Added by you</span>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : <p className="text-sm text-mute">No lesson has a published version yet.</p>}
        <div className="mt-4">
          <label htmlFor="task-quiz-anchoring" className={fieldLabel}>Anchoring phenomenon <span className="font-medium normal-case tracking-normal">(optional)</span></label>
          <input id="task-quiz-anchoring" type="text" value={anchoringValue} maxLength={2000} disabled={locked} onChange={(event) => setAnchoring(event.target.value)}
            onBlur={() => { if (anchoring !== null && anchoring.trim() !== view.anchoringPhenomenon) void quiz.saveAnchoring(anchoring); }} className={`${field} mt-1.5`} />
        </div>
      </div>
    </section>
  );
}

function SourceButtons({ quiz }: { quiz: TaskQuizController }) {
  const view = quiz.view!;
  const lessonName = `Lesson ${view.lesson?.number ?? quiz.firstCard?.number ?? ""}`.trim();
  const sources: { id: QuizSource; label: string; icon: ReactNode }[] = [
    { id: "provided", label: `Provided (${lessonName})`, icon: <BookOpen size={15} /> },
    { id: "uploaded", label: "Upload or link", icon: <Upload size={15} /> },
    { id: "ai", label: "Create with AI", icon: <Sparkles size={15} /> },
  ];
  return (
    <div role="group" aria-label="Quiz source" className="flex flex-col gap-1 rounded-xl border border-line bg-line-2 p-1 sm:inline-flex sm:w-fit sm:flex-row">
      {sources.map((source) => (
        <button key={source.id} type="button" aria-pressed={quiz.tab === source.id} disabled={view.locked || !view.lesson || Boolean(quiz.busy)} onClick={() => quiz.chooseSource(source.id)}
          className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ${quiz.tab === source.id ? "bg-white text-ink shadow-sm" : "text-mute enabled:hover:text-ink"}`}>
          {source.icon}{source.label}
        </button>
      ))}
    </div>
  );
}

function UploadOrLink({ quiz }: { quiz: TaskQuizController }) {
  const input = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const uploading = quiz.busy === "upload", linking = quiz.busy === "link";
  return (
    <div className="grid gap-4 rounded-2xl border border-dashed border-line bg-white p-5 md:grid-cols-2 md:gap-8">
      <div>
        <Upload size={20} className="text-mute" />
        <h3 className="mt-2 text-sm font-semibold text-ink">Upload a file</h3>
        <p className="mt-0.5 text-xs text-mute">Word, PDF, or PowerPoint</p>
        <input ref={input} type="file" aria-label="Upload a file" accept=".docx,.pdf,.pptx" className="sr-only" disabled={Boolean(quiz.busy)}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) quiz.uploadFile(file);
          }} />
        <button type="button" disabled={Boolean(quiz.busy)} onClick={() => input.current?.click()} className={`${secondary} mt-3`}>
          <FileText size={15} />{uploading ? "Reading…" : "Choose file"}
        </button>
      </div>
      <div className="border-t border-line pt-4 md:border-l md:border-t-0 md:pl-8 md:pt-0">
        <Link2 size={20} className="text-mute" />
        <h3 className="mt-2 text-sm font-semibold text-ink">Add a link</h3>
        <p className="mt-0.5 text-xs text-mute">Google Forms, Google Docs, Microsoft Forms, or a web page</p>
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); quiz.importLink(link.trim()); }}>
          <input type="text" inputMode="url" aria-label="Quiz link" placeholder="https://" value={link} disabled={Boolean(quiz.busy)} onChange={(event) => setLink(event.target.value)} className={`${field} min-w-0 flex-1`} />
          <button type="submit" disabled={Boolean(quiz.busy)} className={secondary}>{linking ? "Reading…" : "Import"}</button>
        </form>
      </div>
    </div>
  );
}

function CreateWithAi({ quiz }: { quiz: TaskQuizController }) {
  const coreIdeas = quiz.view?.lesson?.coreIdeas ?? [];
  const [count, setCount] = useState<number>(ITEM_COUNTS[0]);
  const [focus, setFocus] = useState<"all" | number>("all");
  const [readingLevel, setReadingLevel] = useState<string>("Grade 7");
  const writing = quiz.busy === "create";
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <h3 className="text-sm font-semibold text-ink">Create quiz items with AI</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="task-quiz-count" className={fieldLabel}>Number of items</label>
          <select id="task-quiz-count" value={count} onChange={(event) => setCount(Number(event.target.value))} className={`${field} mt-1.5`}>
            {ITEM_COUNTS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="task-quiz-focus" className={fieldLabel}>Focus</label>
          <select id="task-quiz-focus" value={focus} onChange={(event) => setFocus(event.target.value === "all" ? "all" : Number(event.target.value))} className={`${field} mt-1.5`}>
            <option value="all">All core ideas</option>
            {coreIdeas.map((_, index) => <option key={index} value={index + 1}>Core idea {index + 1}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="task-quiz-level" className={fieldLabel}>Reading level</label>
          <select id="task-quiz-level" value={readingLevel} onChange={(event) => setReadingLevel(event.target.value)} className={`${field} mt-1.5`}>
            {READING_LEVELS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
      </div>
      <button type="button" disabled={Boolean(quiz.busy)} onClick={() => quiz.createItems({ count, focus, readingLevel })} className={`${aiPrimary} mt-4`}>
        <Sparkles size={15} />{writing ? "Writing items…" : "Create items"}
      </button>
    </div>
  );
}

function SourceNote({ quiz }: { quiz: TaskQuizController }) {
  const detail = quiz.view?.sourceDetail;
  if (!detail) return null;
  if (detail.kind === "file") {
    return (
      <p className="text-xs text-mute">Items from{" "}
        <button type="button" onClick={() => void quiz.openSourceFile()} className="font-semibold text-brand underline-offset-2 hover:underline">{detail.fileName}</button>
      </p>
    );
  }
  return <p className="text-xs text-mute">Items from <a href={detail.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline-offset-2 hover:underline">{detail.site}</a></p>;
}

function ItemList({ quiz }: { quiz: TaskQuizController }) {
  const view = quiz.view!;
  const busy = Boolean(quiz.busy);
  return (
    <div className="flex flex-col gap-4">
      {!view.locked && view.unmatchedBanner && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ai-mid bg-ai-light px-4 py-3 text-sm text-ai">
          <Sparkles size={16} className="shrink-0" />
          <b className="min-w-0 flex-1 font-semibold">{view.unmatchedBanner}</b>
          <button type="button" disabled={busy} onClick={quiz.matchAll} className={`${aiPrimary} min-h-9 px-3 py-1.5`}>{quiz.busy === "match" ? "Matching…" : "Match all items"}</button>
        </div>
      )}
      {!view.locked && view.confirmationBanner && (
        <div className="flex items-center gap-3 rounded-xl border border-warn/30 bg-warn-light px-4 py-3 text-sm font-semibold text-warn">
          <AlertTriangle size={16} className="shrink-0" />{view.confirmationBanner}
        </div>
      )}
      <SourceNote quiz={quiz} />
      {view.items.map((item) => (
        <QuizItemCard key={item.id} item={item} misconceptions={view.lesson?.misconceptions ?? []} locked={view.locked} busy={busy} onChange={(change) => quiz.changeItem(item.id, change)} />
      ))}
    </div>
  );
}

function QuizBody({ quiz }: { quiz: TaskQuizController }) {
  const view = quiz.view!;
  const [replacingFile, setReplacingFile] = useState(false);
  if (!view.lesson) return <p className="text-sm text-mute">Pick a lesson to see its quiz.</p>;
  const showingCurrent = quiz.tab === view.source;
  const keptNote = !showingCurrent && view.items.length > 0 && (
    <p className="text-xs text-mute">Your current {view.items.length === 1 ? "item stays" : `${view.items.length} items stay`} in place until the new ones are ready.</p>
  );
  return (
    <div className="flex flex-col gap-4">
      {quiz.tab === "uploaded" && !view.locked && (!showingCurrent || !view.items.length || replacingFile) && <UploadOrLink quiz={quiz} />}
      {quiz.tab === "uploaded" && !view.locked && showingCurrent && view.items.length > 0 && (
        <button type="button" disabled={Boolean(quiz.busy)} onClick={() => setReplacingFile(!replacingFile)} className={`${secondary} w-fit`}>
          {replacingFile ? "Keep these items" : "Replace with another file or link"}
        </button>
      )}
      {quiz.tab === "ai" && !view.locked && <CreateWithAi quiz={quiz} />}
      {keptNote}
      {showingCurrent && <ItemList quiz={quiz} />}
    </div>
  );
}

/** Step 1's Quiz tab: the lesson card, then the quiz and where it comes from (UC 4.1 to 4.4). */
export default function TaskQuizPanel({ quiz, disabled }: { quiz: TaskQuizController; disabled?: boolean }) {
  if (quiz.loadError && !quiz.view) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-bad/20 bg-bad-light p-4 text-sm text-bad">
        <span className="min-w-0 flex-1">{quiz.loadError}</span>
        <button type="button" onClick={() => void quiz.reload()} className={secondary}>Try again</button>
      </div>
    );
  }
  if (!quiz.view) return <p className="text-sm text-mute">Loading the quiz…</p>;
  return (
    <div className="flex flex-col gap-5">
      <LessonCard quiz={quiz} disabled={disabled} />
      <SourceButtons quiz={quiz} />
      <QuizBody quiz={quiz} />
    </div>
  );
}
