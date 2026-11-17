"use client";
import { useState } from "react";
import { slideVideo } from "@/lib/slides/video";

export default function SlideVideoField({ value, onChange, disabled }: { value?: string; onChange(value: string | undefined): void; disabled?: boolean }) {
  const [url, setUrl] = useState(value || "");
  const [error, setError] = useState("");
  function save() {
    const video = slideVideo(url);
    if (!video) { setError("Use a YouTube, Vimeo, or public HTTPS MP4/WebM video link."); return; }
    onChange(video.url); setUrl(video.url); setError("");
  }
  return <div className="text-sm"><label className="block font-semibold text-ink-2">Video link <span className="font-normal text-mute">(optional)</span>
    <div className="mt-1.5 flex flex-wrap gap-2"><input aria-label="Slide video link" type="url" value={url} maxLength={2000} disabled={disabled} onChange={event => { setUrl(event.target.value); setError(""); }}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); save(); } }} placeholder="https://www.youtube.com/watch?v=…" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 font-normal" />
      <button type="button" disabled={disabled} onClick={save} className="rounded-lg border border-line px-3 py-2">{value ? "Update" : "Add"}</button>
      {value && <button type="button" disabled={disabled} onClick={() => { onChange(undefined); setUrl(""); setError(""); }} className="rounded-lg border border-line px-3 py-2">Remove</button>}
    </div></label>
    {error && <p role="alert" className="mt-1 text-bad">{error}</p>}
    <p className="mt-1 text-xs text-mute">Plays on the slide. Downloaded PowerPoint includes a link to open the video.</p>
  </div>;
}
