"use client";
import { useEffect, useRef, useState } from "react";
import { updateGalleryMetadata } from "@/lib/material-gallery-client";
import type { GalleryMaterial, GalleryScope } from "@/lib/material-gallery";
import { GRADE_BANDS, QUIZ_BANDS, canonicalGrade } from "@/lib/material-teaching-context";
import ShareTagPreview from "./ShareTagPreview";

export default function GalleryMetadataEditor({ material, scope, onSaved, onClose }: { material: GalleryMaterial; scope: GalleryScope; onSaved(value: GalleryMaterial): void; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const [title, setTitle] = useState(material.title);
  const [topic, setTopic] = useState(material.promptTags?.TOPIC || "");
  const [gradeBand, setGrade] = useState(canonicalGrade(material.gradeBand));
  const [quizPattern, setQuiz] = useState(material.quizPattern);
  const [experienceContext, setExperience] = useState(material.experienceContext);
  const [keywords, setKeywords] = useState(material.promptTags?.KEYWORDS || "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = "mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 font-normal";
  async function save() {
    setBusy(true); setError("");
    try {
      const value = await updateGalleryMetadata(scope, material.id, material.metadataRevision || 0, { title: title.trim(), topic: topic.trim(), description: material.description,
        gradeBand, quizPattern, experienceContext: experienceContext.trim(), keywords: keywords.split(",").map(x => x.trim()).filter(Boolean),
        ...(material.focus ? { focus: material.focus } : {}), sharingConfirmed: true });
      onSaved(value);
    } catch (e) { setError(e instanceof Error ? e.message : "Details could not be saved."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} aria-label="Edit Gallery details" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} className="fixed inset-0 m-auto max-h-[94vh] w-[calc(100%_-_32px)] max-w-xl border-0 bg-transparent p-0 backdrop:bg-ink/50">
    <section className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6">
      <h3 className="text-xl font-semibold">Complete material details</h3><p className="mt-2 text-sm text-mute">Describe the material’s suitability. This updates Gallery labels, preserves its content and records who confirmed the details.</p>
      <fieldset disabled={busy} onChange={() => setConfirmed(false)} className="mt-4 grid gap-3 text-sm font-semibold">
        <label>Title<input className={input} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label>Topic<input className={input} maxLength={160} value={topic} onChange={e => setTopic(e.target.value)} /></label>
        <label>Grade<select className={input} value={gradeBand} onChange={e => setGrade(e.target.value)}><option value="">Not supplied</option>{gradeBand && !(GRADE_BANDS as readonly string[]).includes(gradeBand) && <option>{gradeBand}</option>}{GRADE_BANDS.map(g => <option key={g}>{g}</option>)}</select></label>
        <label>Prior quiz<select className={input} value={quizPattern} onChange={e => setQuiz(e.target.value)}><option value="">Not supplied</option>{quizPattern && !(QUIZ_BANDS as readonly string[]).includes(quizPattern) && <option>{quizPattern}</option>}{QUIZ_BANDS.map(q => <option key={q}>{q}</option>)}</select></label>
        <label>Experience<input className={input} maxLength={200} value={experienceContext} onChange={e => setExperience(e.target.value)} /></label>
        <label>Keywords<input className={input} maxLength={490} value={keywords} onChange={e => setKeywords(e.target.value)} /></label>
      </fieldset>
      <div className="mt-4"><ShareTagPreview lessonNumber={material.lessonNumber} strategy={material.strategy} focus={material.focus} grade={gradeBand} quiz={quizPattern} experience={experienceContext} format={material.format} generation={material.generation} /></div>
      <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed these public labels and removed class and student details.</label>
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-line px-4 py-2">Cancel</button><button type="button" disabled={busy || !confirmed || !title.trim()} onClick={() => void save()} className="rounded-lg bg-brand px-4 py-2 text-white disabled:opacity-50">{busy ? "Saving…" : "Save details"}</button></div>
    </section>
  </dialog>;
}
