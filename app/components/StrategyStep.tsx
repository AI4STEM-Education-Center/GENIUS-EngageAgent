"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Calculator, Check, CircleHelp, Info, Users } from "lucide-react";
import { scopedClientAuthHeaders } from "@/lib/client-auth";
import { engagementStrategies, getEngagementStrategyLabel } from "@/lib/engagement-strategies";
import {
  buildRecommendationReason,
  LESSON_ANALOGY_CORE_IDEAS,
  type ClassQuizCounts,
  type StrategyRecommendation,
} from "@/lib/strategy-recommendation";
import {
  classQuizCounts,
  defaultStrategyFocus,
  focusKind,
  lessonCoreIdeas,
  lessonFocusMisconceptions,
  MAX_FOCUS_ITEMS,
  type StrategyFocus,
} from "@/lib/strategy-focus";
import type { TaskInterests } from "@/lib/task-interests";
import type { StudentAnswer } from "@/lib/types";

type Props = {
  classId: string;
  assignmentId: string;
  lessonNumber: number | null;
  quizPublished: boolean;
  /** This lesson's submitted quiz answers, polled by the page. */
  answers: StudentAnswer[];
  answersError: string | null;
  onRetryAnswers: () => void;
  /** Students in the class, when known (EngageAgent classes only). */
  classSize?: number;
  recommendation: StrategyRecommendation | null;
  onAnalyze: () => void;
  busy: boolean;
  pick: string | null;
  onPick: (strategy: string) => void;
  focus: StrategyFocus;
  onFocusChange: (focus: StrategyFocus) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  onUse: () => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
};

/** When each strategy fits, in the words of the recommendation rule. */
const FITS_WHEN: Record<string, string> = {
  "cognitive conflict": "One misconception is behind more than a quarter of the wrong answers.",
  analogy: "The lesson's core ideas are mostly hard to see directly.",
  "experience bridging": "The lesson's core ideas are things students see in everyday life.",
  "engaged critiquing": "More than 70% of the answers are already correct.",
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const card = "rounded-xl border border-line bg-white p-5";
const pill = "rounded-full bg-line-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2";
const eyebrow = "text-xs font-bold uppercase tracking-[0.08em] text-faint";

function StrategyTip({ strategy }: { strategy: string }) {
  const label = getEngagementStrategyLabel(strategy);
  const description = engagementStrategies.find((s) => s.id === strategy)?.description;
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label={`About ${label}`} onClick={(event) => event.preventDefault()}
        className="grid h-6 w-6 place-items-center rounded-full text-mute hover:bg-ai-light hover:text-ai focus-visible:bg-ai-light focus-visible:text-ai">
        <Info size={15} />
      </button>
      <span role="tooltip"
        className="invisible absolute left-1/2 top-full z-20 mt-1.5 w-64 -translate-x-1/2 rounded-lg bg-ink p-3 text-left text-xs font-normal leading-5 text-white opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <b className="block">{label}</b>
        <span className="mt-1 block">{description}</span>
        <span className="mt-2 block font-semibold text-ai-mid">Fits when</span>
        {FITS_WHEN[strategy]}
      </span>
    </span>
  );
}

function Bar({ value, grey }: { value: number; grey?: boolean }) {
  return (
    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line-2">
      <div className={`h-full rounded-full ${grey ? "bg-line" : "bg-brand"}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function QuizEvidence({ counts, lessonNumber }: { counts: ClassQuizCounts | null; lessonNumber: number }) {
  if (!counts) {
    return <><h3 className="flex items-center gap-2 font-semibold"><CircleHelp size={17} />From the quiz</h3>
      <p className="mt-2 text-sm text-mute">No responses yet</p></>;
  }
  const ids = new Map(lessonFocusMisconceptions(lessonNumber).map((m) => [m.code, m.id]));
  const shown = counts.misconceptions.filter((m) => m.count > 0).sort((a, b) => b.count - a.count);
  return (
    <>
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><CircleHelp size={17} />From the quiz</h3>
        <span className={`ml-auto ${pill}`}>{plural(counts.students, "student")}</span>
      </div>
      <p className="mt-2 text-sm text-mute">
        {counts.correct} of {counts.responses} answers correct ({pct(counts.correct, counts.responses)}%)
        {counts.incorrect > 0 ? " · incorrect answers by misconception" : ""}
      </p>
      {counts.incorrect === 0 && <p className="mt-3 text-sm text-ink-2">Every answer was correct.</p>}
      <ul aria-label="Incorrect answers by misconception">
        {shown.map((m) => (
          <li key={m.id} className="mt-4">
            <div className="flex gap-3 text-sm">
              <span className="min-w-0 flex-1">{m.statement}
                {ids.get(m.id) && <span className="mt-0.5 block font-mono text-[11px] tracking-wide text-faint">{ids.get(m.id)}</span>}
              </span>
              <b className="shrink-0 tabular-nums">{m.count} of {counts.incorrect}</b>
            </div>
            <Bar value={pct(m.count, counts.incorrect)} />
          </li>
        ))}
        {counts.unlinked > 0 && (
          <li className="mt-4">
            <div className="flex gap-3 text-sm">
              <span className="min-w-0 flex-1 text-mute">Not tied to a listed misconception</span>
              <b className="shrink-0 tabular-nums">{counts.unlinked} of {counts.incorrect}</b>
            </div>
            <Bar value={pct(counts.unlinked, counts.incorrect)} grey />
          </li>
        )}
      </ul>
    </>
  );
}

const RANKS = ["Most common", "Second most common"];

function CheckInEvidence({ classId, assignmentId }: { classId: string; assignmentId: string }) {
  const [interests, setInterests] = useState<TaskInterests | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/survey-analysis?${new URLSearchParams({ classId, assignmentId })}`, { headers: scopedClientAuthHeaders({ classId, assignmentId }), cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { interests?: TaskInterests | null; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Check-in responses could not be analyzed right now.");
      setInterests(data.interests ?? null);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check-in responses could not be analyzed right now.");
      setState("error");
    }
  }, [classId, assignmentId]);

  useEffect(() => { void load(); }, [load]);

  const title = <h3 className="flex items-center gap-2 font-semibold"><Users size={17} />From the experience check-in</h3>;
  if (state === "loading") return <>{title}<p role="status" className="mt-2 text-sm text-mute">Loading check-in responses…</p></>;
  if (state === "error") {
    return <>{title}<p role="alert" className="mt-2 text-sm text-bad">{error}</p>
      <button type="button" onClick={() => void load()} className="mt-2 text-sm font-semibold text-ink-2 underline">Try again</button></>;
  }
  if (!interests || interests.responseCount === 0) return <>{title}<p className="mt-2 text-sm text-mute">No responses yet</p></>;
  const others = interests.activities.filter((a) => !interests.top.includes(a) && !interests.top.some((t) => t.activity === a.activity));
  return (
    <>
      <div className="flex items-center gap-2">{title}<span className={`ml-auto ${pill}`}>{plural(interests.responseCount, "response")}</span></div>
      {!interests.enoughResponses && <p className="mt-2 text-sm text-mute">Common experiences appear after 3 responses.</p>}
      {interests.top.map((activity, rank) => (
        <div key={activity.activity} className="mt-3 rounded-lg border border-line-2 p-3.5">
          <div className="flex items-center gap-2"><span className={eyebrow}>{RANKS[rank]}</span><span className={pill}>{activity.category}</span></div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <b className="text-[15.5px]">{activity.activity}</b>
            <span className="ml-auto text-sm text-mute">
              {plural(activity.studentCount, "student")} · {activity.doCount} do it{activity.watchedCount ? ` · ${activity.watchedCount} watched` : ""}
            </span>
          </div>
          {activity.objects.length > 0 && <p className="mt-1 text-xs text-mute">Objects: {activity.objects.join(", ")}</p>}
          {activity.incidents[0] && <p className="mt-1 text-sm text-ink-2">“{activity.incidents[0]}”</p>}
        </div>
      ))}
      {(others.length > 0 || interests.unclassifiedCount > 0) && (
        <p className="mt-3 text-xs text-mute">
          {others.length > 0 && `Also mentioned: ${others.slice(0, 5).map((a) => `${a.activity.toLowerCase()} (${a.studentCount})`).join(", ")}`}
          {others.length > 0 && interests.unclassifiedCount > 0 && " · "}
          {interests.unclassifiedCount > 0 && `${interests.unclassifiedCount} with no clear activity`}
        </p>
      )}
    </>
  );
}

function HowWeChose({ recommendation }: { recommendation: StrategyRecommendation }) {
  const { counts, decidedAtStep } = recommendation;
  const top = Math.max(0, ...counts.misconceptions.map((m) => m.count));
  const ideas = LESSON_ANALOGY_CORE_IDEAS[recommendation.lessonNumber];
  const label = (strategy: string) => getEngagementStrategyLabel(strategy);
  const rows: { question: string; answer: ReactNode }[] = [
    {
      question: "More than 70% of answers correct?",
      answer: <><b>{pct(counts.correct, counts.responses)}%</b> <span className="text-mute">({counts.correct} of {counts.responses})</span> · <b>{decidedAtStep === 1 ? `Yes → ${label("engaged critiquing")}` : "No"}</b></>,
    },
    {
      question: "One misconception behind more than a quarter of wrong answers?",
      answer: <><b>{pct(top, counts.incorrect)}%</b> <span className="text-mute">({top} of {counts.incorrect})</span> · <b>{decidedAtStep === 2 ? `Yes → ${label("cognitive conflict")}` : "No"}</b></>,
    },
    {
      question: "Are most of the lesson’s core ideas hard to see?",
      answer: <>{ideas && <span className="text-mute">({ideas.recommend.length} of {ideas.recommend.length + ideas.notRecommend.length}) </span>}
        <b>{recommendation.strategy === "analogy" ? `Yes → ${label("analogy")}` : `${ideas ? "No" : "Not rated yet"} → ${label("experience bridging")}`}</b></>,
    },
  ];
  return (
    <ol aria-label="How we chose" className="mt-2 overflow-hidden rounded-lg border border-line">
      {rows.map((row, index) => {
        const step = index + 1;
        const decided = step === decidedAtStep;
        const skipped = step > decidedAtStep;
        return (
          <li key={row.question} aria-current={decided ? "step" : undefined}
            className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-sm first:border-t-0 ${decided ? "bg-brand-light" : ""} ${skipped ? "text-faint" : ""}`}>
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${decided ? "bg-brand text-white" : "bg-line-2 text-mute"}`}>{step}</span>
            <span className="min-w-0 flex-1">{row.question}</span>
            <span className="ml-auto">{skipped ? "Not needed" : row.answer}</span>
          </li>
        );
      })}
    </ol>
  );
}

function FocusCard({ strategy, lessonNumber, focus, counts, onChange }: {
  strategy: string; lessonNumber: number; focus: StrategyFocus; counts: ClassQuizCounts | null; onChange: (focus: StrategyFocus) => void;
}) {
  const kind = focusKind(strategy);
  if (!kind) return null;
  const legend = {
    "cognitive conflict": "Misconception to target",
    "engaged critiquing": "Misconception to turn into a claim",
    analogy: "Core idea to explain",
    "experience bridging": "Core idea to connect to",
  }[strategy];
  const chosen: (string | number)[] = focus[kind];
  const full = chosen.length >= MAX_FOCUS_ITEMS;
  const answers = new Map(counts?.misconceptions.map((m) => [m.id, m.count]));
  const options = kind === "misconceptions"
    ? lessonFocusMisconceptions(lessonNumber).map((m) => ({ value: m.code as string | number, text: m.statement, code: m.id, count: answers.get(m.code) }))
    : lessonCoreIdeas(lessonNumber).map((text, index) => ({ value: index as string | number, text: `${index + 1}. ${text}`, code: undefined, count: undefined }));
  const toggle = (value: string | number) => {
    const next = chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value];
    onChange({ ...focus, [kind]: next });
  };
  return (
    <section aria-labelledby="strategy-focus" className={`${card} mt-4`}>
      <h3 id="strategy-focus" className="font-semibold">Focus · {getEngagementStrategyLabel(strategy)}</h3>
      <fieldset className="mt-3">
        <legend className="text-sm font-semibold text-ink-2">{legend} <span className="font-medium text-mute">(choose one or two)</span></legend>
        <div className="mt-2 grid gap-2">
          {options.map((option) => {
            const checked = chosen.includes(option.value);
            return (
              <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${checked ? "border-brand bg-brand-light/50" : "border-line-2"} ${!checked && full ? "cursor-not-allowed opacity-60" : ""}`}>
                <input type="checkbox" className="mt-0.5 accent-brand" checked={checked} disabled={!checked && full} onChange={() => toggle(option.value)} />
                <span className="min-w-0">
                  {option.text}
                  {option.count !== undefined && counts && <span className="text-mute"> · {plural(option.count, "answer")}</span>}
                  {option.code && <span className="mt-0.5 block font-mono text-[11px] tracking-wide text-faint">{option.code}</span>}
                </span>
              </label>
            );
          })}
        </div>
        {chosen.length === 0 && <p className="mt-2 text-sm text-warn">Choose at least one to continue.</p>}
      </fieldset>
    </section>
  );
}

// Step 2 in the v8.3 layout (#178): quiz and check-in evidence side by side,
// the existing recommendation rule on request, then the teacher's choice and focus.
export default function StrategyStep(props: Props) {
  const { lessonNumber, answers, recommendation, pick, focus, onFocusChange } = props;
  const counts = useMemo(
    () => (lessonNumber ? classQuizCounts(lessonNumber, answers.map((answer) => answer.answers)) : null),
    [lessonNumber, answers],
  );
  const recommended = recommendation?.strategy ?? null;
  const differs = Boolean(recommended && pick && pick !== recommended);
  const kind = pick ? focusKind(pick) : null;
  const focusMissing = Boolean(kind && focus[kind].length === 0);

  const choose = (strategy: string) => {
    props.onPick(strategy);
    const next = focusKind(strategy);
    if (next && lessonNumber && focus[next].length === 0) {
      onFocusChange({ ...focus, [next]: defaultStrategyFocus(lessonNumber, counts)[next] });
    }
  };

  if (!lessonNumber) {
    return <div className={card}><p className="text-sm text-mute">Choose a lesson in Step 1 first.</p></div>;
  }

  return (
    <div>
      <p className={eyebrow}>Step 2</p>
      <h1 className="mt-1 text-[28px] font-bold tracking-tight">Engagement strategy</h1>

      {answers.length === 0 && !props.answersError && (
        <div role="status" className="mt-4 flex items-center gap-2.5 rounded-lg border border-info/20 bg-info-light px-4 py-3 text-sm text-info">
          <Info size={17} />
          {!props.quizPublished ? "Task not published yet" : props.classSize ? `0 of ${props.classSize} submitted` : "No students have submitted yet"}
        </div>
      )}
      {props.answersError && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-2.5 rounded-lg border border-bad/20 bg-bad-light px-4 py-3 text-sm text-bad">
          {props.answersError}{answers.length > 0 ? " Showing previously loaded responses." : ""}
          <button type="button" onClick={props.onRetryAnswers} className="ml-auto font-semibold underline">Try again</button>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section aria-label="From the quiz" className={card}><QuizEvidence counts={counts} lessonNumber={lessonNumber} /></section>
        <section aria-label="From the experience check-in" className={card}>
          <CheckInEvidence classId={props.classId} assignmentId={props.assignmentId} />
        </section>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={props.onAnalyze} disabled={props.busy || answers.length === 0 || Boolean(props.answersError)}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50">
          <Calculator size={16} />
          {recommendation ? "Recalculate" : `Analyze ${plural(answers.length, "response")} and recommend`}
        </button>
        <span className="text-sm text-mute">
          {recommendation ? `Based on ${plural(recommendation.counts.students, "response")}.` : "Uses the quiz answers to recommend one strategy for the whole class."}
        </span>
      </div>

      {recommendation && (
        <section aria-label="Recommended strategy" className="mt-4 rounded-xl border border-brand-mid bg-white p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-semibold text-brand-dark">Recommended</span>
            <h2 className="text-xl font-bold">{getEngagementStrategyLabel(recommendation.strategy)}</h2>
            <StrategyTip strategy={recommendation.strategy} />
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">{buildRecommendationReason(recommendation)}</p>
          <p className={`mt-4 ${eyebrow}`}>How we chose</p>
          <HowWeChose recommendation={recommendation} />
          <p className="mt-3 text-sm text-mute">You know your class best, so feel free to choose a different strategy.</p>
        </section>
      )}

      <h2 className="mt-7 text-xl font-bold">Your choice</h2>
      <div role="radiogroup" aria-label="Strategy" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {engagementStrategies.map((strategy) => {
          const on = pick === strategy.id;
          return (
            <label key={strategy.id}
              className={`relative flex cursor-pointer flex-col gap-1.5 rounded-xl border-[1.5px] bg-white p-4 ${on ? "border-brand shadow-[0_0_0_3px_rgba(186,12,47,.12)]" : "border-line hover:border-faint"} ${props.busy ? "cursor-not-allowed opacity-60" : ""}`}>
              <input type="radio" name="strategy" value={strategy.id} aria-label={strategy.label} checked={on} disabled={props.busy} onChange={() => choose(strategy.id)} className="peer sr-only" />
              <span aria-hidden="true" className={`absolute right-3.5 top-3.5 h-[18px] w-[18px] rounded-full border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${on ? "border-brand bg-[radial-gradient(circle,var(--color-brand)_45%,#fff_50%)]" : "border-faint"}`} />
              <span className="flex items-center gap-1 pr-6 text-[15px] font-semibold">{strategy.label}<StrategyTip strategy={strategy.id} /></span>
              {strategy.id === recommended && <span className="self-start rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-semibold text-brand-dark">Recommended</span>}
            </label>
          );
        })}
      </div>

      {pick && <FocusCard strategy={pick} lessonNumber={lessonNumber} focus={focus} counts={counts} onChange={onFocusChange} />}

      {differs && (
        <label className="mt-4 block text-sm font-semibold text-ink-2">
          Why a different strategy? <span className="font-medium text-mute">(optional)</span>
          <textarea value={props.reason} onChange={(event) => props.onReasonChange(event.target.value)} maxLength={2000} rows={3}
            placeholder="e.g. We did a demo like this last week; I want to connect to their soccer experiences instead."
            className="mt-1.5 block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm font-normal text-ink focus:border-brand focus:outline-none" />
        </label>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={props.onUse} disabled={!pick || focusMissing || props.busy || props.saveStatus === "saving"}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-3 text-[15px] font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45">
          {props.saveStatus === "saving" ? "Saving…" : <>Use {pick ? getEngagementStrategyLabel(pick) : "this strategy"} <ArrowRight size={16} /></>}
        </button>
        {props.saveStatus === "saved" && pick && (
          <span role="status" className="flex items-center gap-1.5 text-sm text-mute">
            <Check size={15} className="text-ok" />Saved: {getEngagementStrategyLabel(pick)}
            {recommended ? (pick === recommended ? " (agreed with recommendation)" : ` (instead of ${getEngagementStrategyLabel(recommended)})`) : ""}
          </span>
        )}
        {props.saveStatus === "error" && props.saveError && <span role="alert" className="text-sm text-bad">{props.saveError}</span>}
      </div>
    </div>
  );
}
