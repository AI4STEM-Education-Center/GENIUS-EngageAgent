"use client";

import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { MaterialActivity } from "@/lib/material-activities";

type Props = {
  activity: MaterialActivity;
  media?: { image?: string; video?: string };
  preview?: boolean;
  questionInput?: boolean;
};

export default function MaterialActivityView({ activity, media, preview = false, questionInput = true }: Props) {
  const [visibleCount, setVisibleCount] = useState(1);
  const [prediction, setPrediction] = useState("");
  const [question, setQuestion] = useState("");
  const fieldId = useId();
  const count = preview ? activity.stages.length : visibleCount;
  const currentStage = activity.stages[count - 1];
  const canAdvance = currentStage.id !== "prediction" || prediction.trim().length > 0;

  return (
    <section className="mt-3 min-w-0 space-y-4" aria-label="Inquiry activity">
      {activity.stages.slice(0, count).map((stage, index) => {
        const panelIndex = activity.mappingDepth && activity.image.panels?.length === 2 && index < 2 ? index : undefined;
        const panel = panelIndex === undefined ? undefined : activity.image.panels?.[panelIndex];
        const showImage = panel || index === activity.image.revealAt;
        return (
        <section key={stage.id} aria-label={stage.title} className="min-w-0 border-l-2 border-slate-200 pl-3">
          <h4 className="break-words text-sm font-semibold text-slate-900">{stage.title}</h4>
          {!preview && stage.id === "compare" && prediction && (
            <div className="mt-3 text-sm text-slate-700"><p className="font-semibold">Your prediction</p><p className="whitespace-pre-wrap break-words">{prediction}</p></div>
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
          {index === activity.image.revealAt && media?.video && <video src={media.video} controls playsInline preload="metadata" aria-label="Activity video" className="mt-3 aspect-square w-full max-w-md rounded-md bg-black" />}
          {!preview && stage.id === "question" && !questionInput && <p className="mt-3 text-sm font-medium text-slate-700">Record your scientific question in Your questions below.</p>}
          {!preview && (stage.id === "prediction" || (stage.id === "question" && questionInput)) && (
            <div className="mt-3">
              <label htmlFor={`${fieldId}-${stage.id}`} className="text-sm font-medium text-slate-700">{stage.id === "prediction" ? "Your prediction" : "Your scientific question"}</label>
              <textarea id={`${fieldId}-${stage.id}`} value={stage.id === "prediction" ? prediction : question} maxLength={2000} rows={3}
                readOnly={stage.id === "prediction" && count > index + 1}
                onChange={event => stage.id === "prediction" ? setPrediction(event.target.value) : setQuestion(event.target.value)}
                className="mt-1 block w-full resize-y rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:outline-rose-600 read-only:bg-slate-50" />
            </div>
          )}
        </section>
      ); })}
      {!preview && count < activity.stages.length && (
        <button type="button" title={!canAdvance ? "Write your prediction first" : "Continue"} disabled={!canAdvance} onClick={() => setVisibleCount(count + 1)}
          className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:text-slate-400">
          Continue <ChevronRight size={18} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
