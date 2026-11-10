"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { LESSON_IMAGE_ACCEPT } from "@/lib/lesson-images";
import {
  CONFIDENCE_STEM, emptyDraftQuizItem, MAX_CORE_IDEAS, MAX_QUIZ_ITEMS, OPTION_LETTERS,
  type DraftQuizItem, type LessonDraftContent, type LessonProblem, type OptionLetter,
} from "@/lib/lessons";
import { listMisconceptions, MISCONCEPTION_TEXT, type MisconceptionId } from "@/lib/misconceptions";
import { LessonImagePreview, ui } from "./lesson-ui";

/** The form's copy of a draft. Core ideas are plain text, so each gets a key to keep its box while the list is reordered. */
export type LessonFormState = Omit<LessonDraftContent, "coreIdeas"> & { ideas: { key: string; text: string }[] };

let ideaKeys = 0;
const newIdea = (text: string) => ({ key: `idea-${++ideaKeys}`, text });

export const formFromContent = ({ coreIdeas, ...rest }: LessonDraftContent): LessonFormState => ({ ...rest, ideas: coreIdeas.map(newIdea) });
export const contentFromForm = ({ ideas, ...rest }: LessonFormState): LessonDraftContent => ({ ...rest, coreIdeas: ideas.map((idea) => idea.text) });

/** A short random id, which stays with the question across versions. */
export function newQuizItemId() {
  return `q${Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Where a problem's field lives on the page: "quizItems.2.correct" is its Q3 "Correct answer". */
export const fieldDomId = (field: string) => `lesson-field-${field.replaceAll(".", "-")}`;
const problemDomId = (field: string) => `${fieldDomId(field)}-problem`;

const moved = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
};
const listOf = (numbers: number[]) => numbers.map((number) => `Q${number}`).join(", ");

function FieldProblems({ field, problems }: { field: string; problems: LessonProblem[] }) {
  const here = problems.filter((problem) => problem.field === field);
  if (!here.length) return null;
  return (
    <div id={problemDomId(field)} className="grid gap-0.5 text-sm font-medium text-bad">
      {here.map((problem) => <p key={problem.message}>{problem.message}</p>)}
    </div>
  );
}

/** Marks a box as having a problem, for screen readers as well as by eye. */
const invalidProps = (field: string, problems: LessonProblem[], hintId?: string) => {
  const invalid = problems.some((problem) => problem.field === field);
  const describedBy = [hintId, invalid ? problemDomId(field) : ""].filter(Boolean).join(" ");
  return { ...(invalid ? { "aria-invalid": true as const } : {}), ...(describedBy ? { "aria-describedby": describedBy } : {}) };
};

function TextField({ field, label, value, onChange, problems, rows, maxLength, hint }: {
  field: string; label: string; value: string; onChange: (value: string) => void; problems: LessonProblem[]; rows?: number; maxLength: number; hint?: string;
}) {
  const id = fieldDomId(field), hintId = useId();
  const shared = { id, value, maxLength, className: ui.input, ...invalidProps(field, problems, hint ? hintId : undefined) };
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className={ui.label}>{label}</label>
      {hint && <p id={hintId} className={ui.hint}>{hint}</p>}
      {rows
        ? <textarea rows={rows} {...shared} onChange={(event) => onChange(event.target.value)} />
        : <input type="text" {...shared} onChange={(event) => onChange(event.target.value)} />}
      <FieldProblems field={field} problems={problems} />
    </div>
  );
}

function Section({ title, description, field, problems, children }: { title: string; description?: ReactNode; field?: string; problems: LessonProblem[]; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`${ui.card} grid min-w-0 gap-4`} {...(field ? { id: fieldDomId(field), tabIndex: -1 } : {})}>
      <div className="grid gap-1">
        <h2 id={headingId} className="text-lg font-semibold text-ink">{title}</h2>
        {description && <p className={ui.hint}>{description}</p>}
        {field && <FieldProblems field={field} problems={problems} />}
      </div>
      {children}
    </section>
  );
}

function MoveButtons({ id, label, index, count, onMove }: { id: string; label: string; index: number; count: number; onMove: (to: number) => void }) {
  return (
    <>
      <button type="button" id={`${id}-up`} aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(index - 1)} className={ui.icon}><ArrowUp size={16} aria-hidden="true" /></button>
      <button type="button" id={`${id}-down`} aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(index + 1)} className={ui.icon}><ArrowDown size={16} aria-hidden="true" /></button>
    </>
  );
}

const ALL_MISCONCEPTIONS = listMisconceptions();

function MisconceptionsSection({ picked, usedBy, problems, onChange }: {
  picked: MisconceptionId[]; usedBy: (id: MisconceptionId) => number[]; problems: LessonProblem[]; onChange: (next: MisconceptionId[]) => void;
}) {
  const [search, setSearch] = useState("");
  const searchId = useId();
  const query = search.trim().toLowerCase();
  const matches = ALL_MISCONCEPTIONS.filter(({ id, text }) => !query || id.toLowerCase().includes(query) || text.toLowerCase().includes(query));
  const toggle = (id: MisconceptionId) => onChange(picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id]);
  // Still used by a question but no longer on this lesson. Nothing is cleared, so adding it back restores every link.
  const orphans = ALL_MISCONCEPTIONS.map(({ id }) => ({ id, questions: usedBy(id) })).filter(({ id, questions }) => questions.length > 0 && !picked.includes(id));

  return (
    <Section title="Misconceptions" description="Pick the ideas this lesson's quiz can reveal." field="misconceptions" problems={problems}>
      {picked.length > 0 && (
        <ul aria-label="Misconceptions in this lesson" className="grid gap-2">
          {picked.map((id) => {
            const questions = usedBy(id);
            return (
              <li key={id} className="flex items-start justify-between gap-2 rounded-lg border border-line-2 bg-canvas p-3 text-sm">
                <span className="min-w-0 break-words">
                  <b className="font-semibold text-ink">{id}</b> <span className="text-ink-2">{MISCONCEPTION_TEXT[id]}</span>
                  {questions.length > 0 && <span className="mt-0.5 block text-xs text-mute">Used by {listOf(questions)}</span>}
                </span>
                <button type="button" aria-label={`Remove ${id} from this lesson`} onClick={() => toggle(id)} className={ui.icon}><X size={16} aria-hidden="true" /></button>
              </li>
            );
          })}
        </ul>
      )}
      <div role="status" className="empty:hidden grid gap-2">
        {orphans.map(({ id, questions }) => (
          <div key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn bg-warn-light p-3 text-sm text-warn">
            <p className="min-w-0 break-words">{id} isn’t in this lesson any more, but {listOf(questions)} still {questions.length === 1 ? "uses" : "use"} it. Choose something else on {questions.length === 1 ? "that question" : "those questions"}, or add it back.</p>
            <button type="button" onClick={() => toggle(id)} className={ui.secondary}>Add {id} back</button>
          </div>
        ))}
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={searchId} className={ui.label}>Search misconceptions</label>
        <input id={searchId} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by ID or words" className={ui.input} />
        <p role="status" className="sr-only">{matches.length === 1 ? "1 misconception" : `${matches.length} misconceptions`} found</p>
      </div>
      <div role="group" aria-label="All misconceptions" className="max-h-72 overflow-y-auto rounded-lg border border-line">
        {!matches.length && <p className={`p-3 ${ui.hint}`}>No misconceptions match that search.</p>}
        {matches.map(({ id, text }) => (
          <label key={id} className="flex cursor-pointer items-start gap-3 border-b border-line-2 p-3 text-sm last:border-b-0 hover:bg-canvas">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand" checked={picked.includes(id)} onChange={() => toggle(id)} />
            <span className="min-w-0 break-words"><b className="font-semibold text-ink">{id}</b> <span className="text-ink-2">{text}</span></span>
          </label>
        ))}
      </div>
    </Section>
  );
}

function OptionMisconceptions({ item, index, letter, lessonIds, problems, onChange }: {
  item: DraftQuizItem; index: number; letter: OptionLetter; lessonIds: MisconceptionId[]; problems: LessonProblem[]; onChange: (patch: Partial<DraftQuizItem>) => void;
}) {
  const field = `quizItems.${index}.wrongOptionMisconceptions.${letter}`;
  const picked = item.wrongOptionMisconceptions[letter] ?? [];
  const isCorrect = item.correct === letter;
  // The correct answer has none, unless it was a wrong answer until just now; then they need unticking.
  if (isCorrect && !picked.length) return null;
  const stale = picked.filter((id) => !lessonIds.includes(id));
  const flagged = problems.some((problem) => problem.field === field);
  const toggle = (id: MisconceptionId) => {
    const next = picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id];
    // Letters stay in order, so unticking and re-ticking isn't counted as a change.
    const map: DraftQuizItem["wrongOptionMisconceptions"] = {};
    for (const each of OPTION_LETTERS) {
      const ids = each === letter ? next : item.wrongOptionMisconceptions[each];
      if (ids?.length) map[each] = ids;
    }
    onChange({ wrongOptionMisconceptions: map });
  };
  return (
    <div id={fieldDomId(field)} tabIndex={-1} className="grid gap-1.5">
      <details open={flagged || stale.length > 0 || isCorrect || undefined} className="rounded-lg border border-line-2 bg-canvas">
        <summary className="cursor-pointer break-words px-3 py-2 text-sm text-ink-2">Misconceptions for option {letter}: <b className="font-semibold">{picked.join(", ") || "none"}</b></summary>
        <div role="group" aria-label={`Misconceptions for option ${letter}`} className="grid gap-1 border-t border-line-2 p-2">
          {!lessonIds.length && !stale.length && <p className={`p-1 ${ui.hint}`}>Add misconceptions to this lesson first.</p>}
          {[...lessonIds, ...stale].map((id) => (
            <label key={id} className="flex cursor-pointer items-start gap-2.5 rounded p-1.5 text-sm hover:bg-white">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand" checked={picked.includes(id)} onChange={() => toggle(id)} />
              <span className="min-w-0 break-words"><b className="font-semibold text-ink">{id}</b> <span className="text-ink-2">{MISCONCEPTION_TEXT[id]}</span></span>
            </label>
          ))}
        </div>
      </details>
      <FieldProblems field={field} problems={problems} />
      {!flagged && isCorrect && <p className="text-sm font-medium text-warn">This is the correct answer, so it can’t have misconceptions. Untick them.</p>}
      {!flagged && stale.length > 0 && <p className="text-sm font-medium text-warn">{stale.join(", ")} {stale.length === 1 ? "isn’t" : "aren’t"} in this lesson any more. Untick {stale.length === 1 ? "it" : "them"}, or add {stale.length === 1 ? "it" : "them"} back above.</p>}
    </div>
  );
}

function QuizItemCard({ item, index, count, lessonIds, problems, uploading, onChange, onMove, onRemove, onImage }: {
  item: DraftQuizItem; index: number; count: number; lessonIds: MisconceptionId[]; problems: LessonProblem[]; uploading: boolean;
  onChange: (patch: Partial<DraftQuizItem>) => void; onMove: (to: number) => void; onRemove: () => void; onImage: (file: File) => void;
}) {
  const q = `Q${index + 1}`;
  const at = (name: string) => `quizItems.${index}.${name}`;
  const headingId = useId(), imageHintId = useId();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const keepButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirmingRemove) keepButton.current?.focus(); }, [confirmingRemove]);

  const matched = item.matchedMisconception;
  const matchedStale = matched !== null && !lessonIds.includes(matched);
  const matchedField = at("matchedMisconception");
  const correctField = at("correct");
  const hasContent = Boolean(item.stem.trim() || item.explanation.trim() || item.image || OPTION_LETTERS.some((letter) => item.options[letter].trim()));

  return (
    <li id={`lesson-quiz-item-${item.id}`} tabIndex={-1} className="min-w-0 rounded-xl border border-line bg-white p-4 outline-none sm:p-5">
      <section aria-labelledby={headingId} className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={headingId} className="text-base font-semibold text-ink">{q}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <MoveButtons id={`lesson-move-${item.id}`} label={q} index={index} count={count} onMove={onMove} />
            <button type="button" aria-label={`Remove ${q}`} onClick={() => hasContent ? setConfirmingRemove(true) : onRemove()} className={ui.icon}><Trash2 size={16} aria-hidden="true" /></button>
          </div>
        </div>
        {confirmingRemove && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bad bg-bad-light p-3 text-sm text-bad">
            <p className="min-w-0">Remove {q} and everything in it?</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" ref={keepButton} onClick={() => setConfirmingRemove(false)} className={ui.secondary}>Keep {q}</button>
              <button type="button" onClick={onRemove} className={ui.dangerSolid}>Remove {q}</button>
            </div>
          </div>
        )}

        <TextField field={at("stem")} label="Question" value={item.stem} rows={2} maxLength={2000} problems={problems} onChange={(stem) => onChange({ stem })} />

        <div className="grid gap-2">
          <p className={ui.label}>Image</p>
          {item.image && <LessonImagePreview src={item.image} alt={`Picture for ${q}`} />}
          <div className="flex flex-wrap gap-2">
            <label className={`${ui.secondary} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand ${uploading ? "cursor-wait opacity-50" : ""}`}>
              <ImagePlus size={15} aria-hidden="true" />
              {uploading ? "Uploading..." : item.image ? "Replace image" : "Add image"}<span className="sr-only"> for {q}</span>
              <input type="file" accept={LESSON_IMAGE_ACCEPT} className="sr-only" disabled={uploading} aria-describedby={imageHintId}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = ""; // So picking the same file again still counts.
                  if (file) onImage(file);
                }} />
            </label>
            {item.image && <button type="button" onClick={() => onChange({ image: null })} className={ui.secondary}>Remove image<span className="sr-only"> from {q}</span></button>}
          </div>
          <p id={imageHintId} className={ui.hint}>Optional. PNG, JPEG, or WebP, up to 4 MB.</p>
        </div>

        <div id={fieldDomId(at("options"))} tabIndex={-1} className="grid gap-3">
          {OPTION_LETTERS.map((letter) => (
            <div key={letter} className="grid min-w-0 gap-1.5">
              <TextField field={at(`options.${letter}`)} label={`Option ${letter}`} value={item.options[letter]} maxLength={1000} problems={problems}
                onChange={(text) => onChange({ options: { ...item.options, [letter]: text } })} />
              <OptionMisconceptions item={item} index={index} letter={letter} lessonIds={lessonIds} problems={problems} onChange={onChange} />
            </div>
          ))}
          <FieldProblems field={at("options")} problems={problems} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 content-start gap-1.5">
            <label htmlFor={fieldDomId(correctField)} className={ui.label}>Correct answer</label>
            <select id={fieldDomId(correctField)} value={item.correct ?? ""} className={ui.input} {...invalidProps(correctField, problems)}
              onChange={(event) => onChange({ correct: (event.target.value || null) as OptionLetter | null })}>
              <option value="">Choose A, B, C, or D</option>
              {OPTION_LETTERS.map((letter) => <option key={letter} value={letter}>{letter}</option>)}
            </select>
            <FieldProblems field={correctField} problems={problems} />
          </div>
          <div className="grid min-w-0 content-start gap-1.5">
            <label htmlFor={fieldDomId(matchedField)} className={ui.label}>Matched misconception</label>
            <select id={fieldDomId(matchedField)} value={matched ?? ""} className={ui.input} {...invalidProps(matchedField, problems)}
              onChange={(event) => onChange({ matchedMisconception: (event.target.value || null) as MisconceptionId | null })}>
              <option value="">Choose a misconception</option>
              {lessonIds.map((id) => <option key={id} value={id}>{id}: {MISCONCEPTION_TEXT[id]}</option>)}
              {matchedStale && <option value={matched}>{matched} (not in this lesson any more)</option>}
            </select>
            {matched && !matchedStale && <p className={`break-words ${ui.hint}`}>{MISCONCEPTION_TEXT[matched]}</p>}
            {!lessonIds.length && !matched && <p className={ui.hint}>Add misconceptions to this lesson first.</p>}
            <FieldProblems field={matchedField} problems={problems} />
            {matchedStale && !problems.some((problem) => problem.field === matchedField) && (
              <p className="text-sm font-medium text-warn">{matched} isn’t in this lesson any more. Choose another, or add it back above.</p>
            )}
          </div>
        </div>

        <TextField field={at("explanation")} label="Explanation" hint="Shown to students in feedback." value={item.explanation} rows={3} maxLength={4000} problems={problems}
          onChange={(explanation) => onChange({ explanation })} />
      </section>
    </li>
  );
}

type Props = {
  form: LessonFormState;
  onChange: (update: (form: LessonFormState) => LessonFormState) => void;
  problems: LessonProblem[];
  uploading: Record<string, boolean>;
  onImage: (itemId: string, file: File) => void;
  /** Says something to screen readers, such as where a moved item ended up. */
  announce: (message: string) => void;
};

/** The whole lesson form (UC 2.1 step 3). Holds no lesson data itself. */
export default function LessonForm({ form, onChange, problems, uploading, onImage, announce }: Props) {
  const focusNext = useRef<string | null>(null);
  // Reordering or removing can take away the button that had focus, so hand it on once the list has updated.
  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const set = (patch: Partial<LessonFormState>) => onChange((current) => ({ ...current, ...patch }));
  const usedBy = useMemo(() => {
    const map = new Map<MisconceptionId, number[]>();
    form.quizItems.forEach((item, index) => {
      const ids = new Set([...(item.matchedMisconception ? [item.matchedMisconception] : []), ...OPTION_LETTERS.flatMap((letter) => item.wrongOptionMisconceptions[letter] ?? [])]);
      for (const id of ids) map.set(id, [...(map.get(id) ?? []), index + 1]);
    });
    return (id: MisconceptionId) => map.get(id) ?? [];
  }, [form.quizItems]);

  /** After moving, keep focus on the same arrow, or the other one if this end of the list has no further to go. */
  const moveFocus = (id: string, from: number, to: number, count: number) => {
    const goingUp = to < from, atEnd = goingUp ? to === 0 : to === count - 1;
    focusNext.current = `${id}-${goingUp === atEnd ? "down" : "up"}`;
  };

  function moveIdea(from: number, to: number) {
    moveFocus(`lesson-idea-move-${form.ideas[from].key}`, from, to, form.ideas.length);
    onChange((current) => ({ ...current, ideas: moved(current.ideas, from, to) }));
    announce(`Core idea moved to position ${to + 1}.`);
  }
  function addIdea() {
    const idea = newIdea("");
    focusNext.current = `lesson-idea-${idea.key}`;
    onChange((current) => ({ ...current, ideas: [...current.ideas, idea] }));
  }
  function removeIdea(index: number) {
    const after = form.ideas[index + 1] ?? form.ideas[index - 1];
    focusNext.current = after ? `lesson-idea-${after.key}` : "lesson-add-idea";
    onChange((current) => ({ ...current, ideas: current.ideas.filter((_, at) => at !== index) }));
    announce(`Core idea ${index + 1} removed.`);
  }

  const patchItem = (id: string, patch: Partial<DraftQuizItem>) =>
    onChange((current) => ({ ...current, quizItems: current.quizItems.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  function moveItem(from: number, to: number) {
    moveFocus(`lesson-move-${form.quizItems[from].id}`, from, to, form.quizItems.length);
    onChange((current) => ({ ...current, quizItems: moved(current.quizItems, from, to) }));
    announce(`Quiz item moved to position ${to + 1}. It is now Q${to + 1}.`);
  }
  function addItem() {
    const item = emptyDraftQuizItem(newQuizItemId());
    focusNext.current = fieldDomId(`quizItems.${form.quizItems.length}.stem`);
    onChange((current) => ({ ...current, quizItems: [...current.quizItems, item] }));
  }
  function removeItem(index: number) {
    const after = form.quizItems[index + 1] ?? form.quizItems[index - 1];
    focusNext.current = after ? `lesson-quiz-item-${after.id}` : "lesson-add-item";
    onChange((current) => ({ ...current, quizItems: current.quizItems.filter((_, at) => at !== index) }));
    announce(`Q${index + 1} removed.`);
  }

  return (
    <div className="grid min-w-0 gap-5">
      <Section title="Basics" problems={problems}>
        <TextField field="title" label="Lesson title" value={form.title} maxLength={200} problems={problems} onChange={(title) => set({ title })} />
        <TextField field="objective" label="Learning objective" value={form.objective} rows={2} maxLength={2000} problems={problems} onChange={(objective) => set({ objective })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField field="topic" label="Topic" value={form.topic} maxLength={300} problems={problems} onChange={(topic) => set({ topic })} />
          <TextField field="targetConcept" label="Target concept" value={form.targetConcept} maxLength={300} problems={problems} onChange={(targetConcept) => set({ targetConcept })} />
        </div>
      </Section>

      <Section title="Core ideas" description="Students' materials are built around these, in this order." field="coreIdeas" problems={problems}>
        {form.ideas.length > 0 && (
          <ol aria-label="Core ideas" className="grid gap-3">
            {form.ideas.map((idea, index) => (
              <li key={idea.key} className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
                <div className="grid min-w-0 flex-1 gap-1">
                  <label htmlFor={`lesson-idea-${idea.key}`} className={ui.label}>Core idea {index + 1}</label>
                  <textarea id={`lesson-idea-${idea.key}`} rows={2} maxLength={1000} value={idea.text} className={ui.input}
                    onChange={(event) => { const text = event.target.value; onChange((current) => ({ ...current, ideas: current.ideas.map((other) => other.key === idea.key ? { ...other, text } : other) })); }} />
                </div>
                <div className="flex gap-2 sm:mt-6">
                  <MoveButtons id={`lesson-idea-move-${idea.key}`} label={`core idea ${index + 1}`} index={index} count={form.ideas.length} onMove={(to) => moveIdea(index, to)} />
                  <button type="button" aria-label={`Remove core idea ${index + 1}`} onClick={() => removeIdea(index)} className={ui.icon}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div><button type="button" id="lesson-add-idea" onClick={addIdea} disabled={form.ideas.length >= MAX_CORE_IDEAS} className={ui.secondary}><Plus size={15} aria-hidden="true" />Add core idea</button></div>
      </Section>

      <MisconceptionsSection picked={form.misconceptions} usedBy={usedBy} problems={problems} onChange={(misconceptions) => set({ misconceptions })} />

      <Section title="Quiz items" field="quizItems" problems={problems}
        description={<>After each question, students also answer “{CONFIDENCE_STEM}” It’s added automatically, so there’s nothing to fill in. A lesson needs at least four quiz items.</>}>
        {form.quizItems.length > 0 && (
          <ol aria-label="Quiz items" className="grid gap-4">
            {form.quizItems.map((item, index) => (
              <QuizItemCard key={item.id} item={item} index={index} count={form.quizItems.length} lessonIds={form.misconceptions} problems={problems}
                uploading={Boolean(uploading[item.id])} onChange={(patch) => patchItem(item.id, patch)} onMove={(to) => moveItem(index, to)}
                onRemove={() => removeItem(index)} onImage={(file) => onImage(item.id, file)} />
            ))}
          </ol>
        )}
        <div><button type="button" id="lesson-add-item" onClick={addItem} disabled={form.quizItems.length >= MAX_QUIZ_ITEMS} className={ui.secondary}><Plus size={15} aria-hidden="true" />Add quiz item</button></div>
      </Section>
    </div>
  );
}
