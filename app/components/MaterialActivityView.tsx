"use client";

import { useEffect, useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { MaterialActivity } from "@/lib/material-activities";

type Props = {
  activity: MaterialActivity;
  media?: { image?: string; video?: string };
  preview?: boolean;
  questionInput?: boolean;
  /** Session-only key scoped by the caller to learner, class, task and material. */
  predictionKey?: string;
  onVideoError?: (url: string) => void;
};

function readPrediction(key?: string): { draft: string; recorded: string } {
  try {
    const saved = key ? JSON.parse(sessionStorage.getItem(key) ?? "null") : null;
    return {
      draft: typeof saved?.draft === "string" && saved.draft.length <= 2000 ? saved.draft : "",
      recorded: typeof saved?.recorded === "string" && saved.recorded.trim() && saved.recorded.length <= 2000 ? saved.recorded : "",
    };
  } catch { return { draft: "", recorded: "" }; }
}

function ActivityReader({ activity, media, preview = false, questionInput = true, predictionKey, onVideoError }: Props) {
  const storageKey = !preview && activity.stages.some(stage => stage.id === "prediction") ? predictionKey : undefined;
  const [initialPrediction] = useState(() => readPrediction(storageKey));
  const [visibleCount, setVisibleCount] = useState(1);
  const [prediction, setPrediction] = useState(initialPrediction.draft);
  const [recordedPrediction, setRecordedPrediction] = useState(initialPrediction.recorded);
  const [question, setQuestion] = useState("");
  const fieldId = useId();
  const count = preview ? activity.stages.length : visibleCount;
  const currentStage = activity.stages[count - 1];
  const canAdvance = currentStage.id !== "prediction" || (recordedPrediction || prediction).trim().length > 0;

  useEffect(() => {
    if (!storageKey) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ draft: prediction, recorded: recordedPrediction })); }
    catch { /* Keep the active reader usable when browser storage is blocked. */ }
  }, [storageKey, prediction, recordedPrediction]);

  function advance() {
    if (!canAdvance) return;
    if (currentStage.id === "prediction" && !recordedPrediction) setRecordedPrediction(prediction.trim());
    setVisibleCount(count + 1);
  }

  return (
    <section className="mt-3 min-w-0 space-y-4" aria-label="Inquiry activity">
      {activity.stages.slice(0, count).map((stage, index) => {
        const panelIndex = activity.mappingDepth && activity.image.panels?.length === 2 && index < 2 ? index : undefined;
        const panel = panelIndex === undefined ? undefined : activity.image.panels?.[panelIndex];
        const showImage = panel || index === activity.image.revealAt;
        return (
        <section key={stage.id} aria-label={stage.title} className="min-w-0 border-l-2 border-slate-200 pl-3">
          <h4 className="break-words text-sm font-semibold text-slate-900">{stage.title}</h4>
          {!preview && stage.id === "compare" && recordedPrediction && (
            <div className="mt-3 text-sm text-slate-700"><p className="font-semibold">Your prediction</p><p className="whitespace-pre-wrap break-words">{recordedPrediction}</p></div>
          )}
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-slate-700">{stage.text}</p>
          {showImage && media?.image && (
            <figure className="mt-3">
              {panel ? (
                <div className="relative aspect-[3/4] w-full max-w-72 overflow-hidden rounded-md border border-slate-200">
                  <img src={media.image} alt={panel.alt} className="absolute top-0 h-full" style={{ width: "200%", maxWidth: "none", left: panelIndex === 0 ? 0 : "-100%" }} />
                </div>
              ) : (
                <img src={media.image} alt={activity.image.panels?.map(value => value.alt).join(" ") ?? activity.image.scene} className="aspect-[3/2] w-full max-w-xl rounded-md border border-slate-200 object-contain" />
              )}
              <figcaption className="mt-1 max-w-xl text-xs text-slate-500">
                {panel ? panel.caption : activity.image.panels?.map(value => value.caption).join(" / ")}
                <span className="block">Schematic illustration, not experimental measurements.</span>
              </figcaption>
            </figure>
          )}
          {index === activity.image.revealAt && media?.video && <video src={media.video} controls playsInline preload="metadata" aria-label="Activity video" className="mt-3 aspect-square w-full max-w-md rounded-md bg-black" onError={event => onVideoError?.(event.currentTarget.getAttribute("src") ?? "")} />}
          {!preview && stage.id === "question" && !questionInput && <p className="mt-3 text-sm font-medium text-slate-700">Record your scientific question in Your questions below.</p>}
          {!preview && (stage.id === "prediction" || (stage.id === "question" && questionInput)) && (
            <div className="mt-3">
              <label htmlFor={`${fieldId}-${stage.id}`} className="text-sm font-medium text-slate-700">{stage.id === "prediction" ? "Your prediction" : "Your scientific question"}</label>
              <textarea id={`${fieldId}-${stage.id}`} value={stage.id === "prediction" ? recordedPrediction || prediction : question} maxLength={2000} rows={3}
                readOnly={stage.id === "prediction" && !!recordedPrediction}
                onChange={event => { if (stage.id === "prediction") { if (!recordedPrediction) setPrediction(event.target.value); } else setQuestion(event.target.value); }}
                className="mt-1 block w-full resize-y rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:outline-rose-600 read-only:bg-slate-50" />
            </div>
          )}
        </section>
      ); })}
      {!preview && count < activity.stages.length && (
        <button type="button" title={!canAdvance ? "Write your prediction first" : "Continue"} disabled={!canAdvance} onClick={advance}
          className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:text-slate-400">
          Continue <ChevronRight size={18} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

export default function MaterialActivityView(props: Props) {
  if (props.preview && props.media?.video) return <section aria-label="Inquiry activity" className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div className="min-w-0"><video src={props.media.video} poster={props.media.image} controls playsInline preload="metadata" aria-label="Activity video" className="aspect-video w-full rounded-xl bg-black" />
      <p className="mt-2 text-xs text-mute">Preview the video and the student activity together.</p>
      {props.media.image && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Accompanying illustration</summary><img src={props.media.image} alt={props.activity.image.scene} className="mt-2 max-h-72 w-full rounded-lg object-contain" /></details>}</div>
    <div className="min-w-0 space-y-4">{props.activity.stages.map((stage, index) => <section key={stage.id} aria-label={stage.title} className="rounded-xl border border-line bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-mute">Step {index + 1}</p><h4 className="mt-1 font-semibold">{stage.title}</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{stage.text}</p></section>)}</div>
  </section>;
  // Polling may replace the activity object. Reset only when its learner scope
  // or preview mode changes, so predictions never cross accounts or materials.
  return <ActivityReader key={JSON.stringify([props.predictionKey, !!props.preview])} {...props} />;
}
