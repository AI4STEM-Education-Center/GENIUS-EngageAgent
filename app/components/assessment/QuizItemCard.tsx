"use client";

import { useState } from "react";
import { Check, Plus, Sparkles, X } from "lucide-react";
import type { ItemChange, TaskQuizView } from "@/lib/task-quiz";
import type { MisconceptionId } from "@/lib/misconceptions";

type Item = TaskQuizView["items"][number];
type Option = Item["options"][number];
type Listed = { id: string; text: string };

type Props = {
  item: Item;
  misconceptions: Listed[];
  locked: boolean;
  busy: boolean;
  onChange: (change: ItemChange) => void;
};

const NO_MISCONCEPTION = "__none";

export const pillClass = {
  ok: "bg-ok-light text-ok",
  warn: "bg-warn-light text-warn",
  bad: "bg-bad-light text-bad",
  ai: "bg-ai-light text-ai",
};
export const pill = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold";
const chip = "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs leading-snug";
const smallButton = "inline-flex min-h-8 items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const aiButton = `${smallButton} border-ai-mid bg-ai-light text-ai hover:border-ai`;
const plainButton = `${smallButton} border-line bg-white text-ink-2 hover:bg-canvas`;
const letterBadge = "grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-bold";

function OptionsEditor({ item, busy, onSave, onCancel }: { item: Item; busy: boolean; onSave: (options: string[]) => void; onCancel: () => void }) {
  const [texts, setTexts] = useState(item.options.map((option) => option.text));
  const ready = texts.length >= 2 && texts.every((text) => text.trim());
  return (
    <div className="mt-3 grid gap-2 rounded-xl border border-line bg-canvas p-3">
      {texts.map((text, index) => (
        <div key={index} className="flex items-center gap-2">
          <input aria-label={`Option ${index + 1} text`} value={text} onChange={(event) => setTexts(texts.map((value, at) => (at === index ? event.target.value : value)))}
            className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none" />
          <button type="button" aria-label={`Remove option ${index + 1}`} onClick={() => setTexts(texts.filter((_, at) => at !== index))} className={plainButton}><X size={14} /></button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setTexts([...texts, ""])} className={plainButton}><Plus size={14} />Add option</button>
        <span className="flex-1" />
        <button type="button" onClick={onCancel} className={plainButton}>Cancel</button>
        <button type="button" disabled={!ready || busy} onClick={() => onSave(texts)} className={`${smallButton} border-brand bg-brand text-white`}>Save options</button>
      </div>
    </div>
  );
}

function MatchSlot({ item, option, misconceptions, locked, busy, onChange }: Props & { option: Option }) {
  const [editing, setEditing] = useState(false);
  const { match, letter } = option;
  const suggestedAnswer = item.answerSuggestion?.letter === letter;
  if (!match || suggestedAnswer) return <span className="text-xs text-mute">—</span>;
  // After confirming, a match is the teacher's, however it started.
  const asSuggestion = match.setBy === "ai" && !item.confirmed;
  const chipColor = asSuggestion ? "border-ai-mid bg-ai-light text-ai" : "border-line bg-white text-ink-2";
  const available = misconceptions.filter((entry) => !match.ids.includes(entry.id as MisconceptionId));
  const setIds = (ids: MisconceptionId[]) => onChange({ action: "setMatch", letter, ids, noMisconception: false });
  const choose = (value: string) => {
    setEditing(false);
    if (value === NO_MISCONCEPTION) onChange({ action: "setMatch", letter, ids: [], noMisconception: true });
    else if (value) setIds([...match.ids, value as MisconceptionId]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {match.chips.map((entry) => (
        <span key={entry.id} className={`${chip} ${chipColor}`}>
          {asSuggestion && <Sparkles size={12} className="shrink-0" aria-label="AI suggestion" />}
          <span className="min-w-0 break-words"><b className="font-mono font-semibold">{entry.id}</b> · {entry.text}</span>
          {!locked && (
            <button type="button" disabled={busy} aria-label={`Remove ${entry.id} from option ${letter}`} onClick={() => setIds(match.ids.filter((id) => id !== entry.id))}
              className="ml-0.5 grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-line-2 disabled:opacity-50"><X size={12} /></button>
          )}
        </span>
      ))}
      {match.state === "no_misconception" && (
        <span className={`${chip} ${chipColor}`}>{asSuggestion && <Sparkles size={12} className="shrink-0" aria-label="AI suggestion" />}{match.label}</span>
      )}
      {match.state === "not_matched" && <span className={`${chip} border-dashed border-warn/40 bg-warn-light text-warn`}>{match.label}</span>}
      {!locked && (editing
        ? (
          <select autoFocus aria-label={`Misconception for option ${letter}`} defaultValue="" disabled={busy} onBlur={() => setEditing(false)} onChange={(event) => choose(event.target.value)}
            className="max-w-full rounded-lg border border-line bg-white px-2 py-1 text-xs text-ink">
            <option value="">Choose…</option>
            {available.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · {entry.text}</option>)}
            <option value={NO_MISCONCEPTION}>No misconception</option>
          </select>
        )
        : <button type="button" disabled={busy} onClick={() => setEditing(true)} aria-label={`${match.state === "no_misconception" ? "Change" : "+ Add / change"} option ${letter}`}
          className="min-h-8 rounded-lg px-1.5 text-xs font-semibold text-brand underline-offset-2 hover:underline disabled:opacity-50">
          {match.state === "no_misconception" ? "Change" : "+ Add / change"}
        </button>)}
      {asSuggestion && match.aiLine && <p className="basis-full text-xs leading-snug text-ai">{match.aiLine}</p>}
      {!locked && !item.confirmed && option.possibleNew.map((entry) => (
        <div key={entry.id} className="basis-full rounded-lg border border-ai-mid bg-ai-light p-2.5 text-xs text-ai">
          <p className="flex items-start gap-1.5 font-semibold"><Sparkles size={12} className="mt-0.5 shrink-0" />{entry.label}</p>
          <p className="mt-1 leading-snug">AI · {entry.confidence} confidence. {entry.reason}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => onChange({ action: "addPossibleNew", letter, id: entry.id })} className={aiButton}>Add to lesson list and use</button>
            <button type="button" disabled={busy} onClick={() => onChange({ action: "dismissPossibleNew", letter, id: entry.id })} className={plainButton}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** One quiz item: its origin, question and options, each wrong option's misconceptions, and "Confirm item". */
export default function QuizItemCard(props: Props) {
  const { item, locked, busy, onChange } = props;
  const [editingOptions, setEditingOptions] = useState(false);
  return (
    <article aria-label={`Item ${item.number}`} className={`rounded-2xl border bg-white ${item.confirmed ? "border-line" : "border-warn/40"}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line-2 px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-line-2 text-[13px] font-bold text-ink-2">{item.number}</span>
        <span className="text-sm text-mute">{item.origin}</span>
        {item.noAnswerKey && <span className={`${pill} ${pillClass.bad}`}>{item.noAnswerKey}</span>}
        <span className="flex-1" />
        <span className={`${pill} ${item.confirmed ? pillClass.ok : pillClass.warn}`}>{item.confirmed && <Check size={12} />}{item.pill}</span>
      </header>
      <div className="px-4 py-4">
        <p className="whitespace-pre-line text-[15px] font-semibold leading-snug text-ink">{item.stem}</p>
        {item.image && (
          // eslint-disable-next-line @next/next/no-img-element -- lesson images can be data URLs, as in the student quiz
          <img src={item.image} alt={`Visual reference for question ${item.number}`} loading="lazy" decoding="async"
            className="mt-3 h-auto max-h-64 w-full max-w-md rounded-xl border border-line bg-white object-contain" />
        )}
        <div className="mt-3 hidden grid-cols-[minmax(0,1fr)_minmax(0,320px)] gap-4 text-xs text-mute md:grid">
          <span className="pl-10">Option</span><span>Misconception</span>
        </div>
        <ul className="mt-1 grid gap-3">
          {item.options.map((option) => {
            const suggestion = item.answerSuggestion?.letter === option.letter ? item.answerSuggestion : null;
            return (
              <li key={option.letter} className="grid gap-2 border-t border-line-2 pt-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)] md:gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  {item.answer || locked
                    ? <span className={`${letterBadge} ${option.isCorrect ? "bg-ok text-white" : "bg-line-2 text-ink-2"}`}>{option.letter}</span>
                    : <button type="button" disabled={busy} aria-label={`Set ${option.letter} as the correct answer`} title={`Set ${option.letter} as the correct answer`} onClick={() => onChange({ action: "setAnswer", letter: option.letter })}
                      className={`${letterBadge} border border-dashed border-faint bg-white text-ink-2 hover:border-ok hover:text-ok disabled:opacity-50`}>{option.letter}</button>}
                  <div className="min-w-0 flex-1 pt-0.5 text-sm text-ink">
                    <span className="break-words">{option.text}</span>
                    {option.tag && <span className={`${pill} ${pillClass.ok} ml-2`}>{option.tag}</span>}
                    {suggestion && !locked && (
                      <div className="mt-2 grid gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`${chip} border-ai-mid bg-ai-light text-ai`}><Sparkles size={12} className="shrink-0" />{suggestion.label}</span>
                          <button type="button" disabled={busy} onClick={() => onChange({ action: "setAnswer", letter: option.letter })} className={aiButton}>Set as answer</button>
                        </div>
                        <p className="text-xs leading-snug text-ai">AI · {suggestion.confidence} confidence. {suggestion.reason}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="min-w-0 pl-10 md:pl-0"><MatchSlot {...props} option={option} /></div>
              </li>
            );
          })}
        </ul>
        {!locked && item.options.length !== 4 && (editingOptions
          ? <OptionsEditor item={item} busy={busy} onCancel={() => setEditingOptions(false)} onSave={(options) => { setEditingOptions(false); onChange({ action: "setOptions", options }); }} />
          : <button type="button" onClick={() => setEditingOptions(true)} className={`${plainButton} mt-3`}>Edit options</button>)}
      </div>
      {!item.confirmed && !locked && (
        <footer className="flex flex-wrap items-center gap-3 border-t border-line-2 px-4 py-3">
          <ul className="min-w-0 flex-1 text-xs text-mute">
            {item.confirmProblems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
          <button type="button" disabled={!item.canConfirm || busy} onClick={() => onChange({ action: "confirm" })}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-mute">
            <Check size={15} />Confirm item
          </button>
        </footer>
      )}
    </article>
  );
}
