"use client";

import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { createPrivateVideoCopy, saveGalleryCopy } from "@/lib/material-gallery-client";
import type { GalleryCopy, GalleryScope } from "@/lib/material-gallery";
import type { ContentItem } from "@/lib/types";

/** The generated task draft stays in place; its durable library copy is separate. */
export default function SaveVideoMaterial({ scope, item, lessonNumber, disabled }: { scope: GalleryScope; item: ContentItem; lessonNumber?: number; disabled?: boolean }) {
  const request = useRef<AbortController | null>(null);
  const receipt = useRef<{ copy: Extract<GalleryCopy, { format: "video" }>; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedItem, setSavedItem] = useState<ContentItem | null>(null);
  const [hasReceipt, setHasReceipt] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { receipt.current = null; setHasReceipt(false); setSavedItem(null); setBusy(false); setError(""); return () => request.current?.abort(); }, [item.id, scope.classId, scope.assignmentId]);
  async function save() {
    if (busy || disabled) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const previous = receipt.current;
      const material = item.lessonNumber === undefined ? { ...item, lessonNumber } : item;
      const copy = previous ? { ...previous.copy, item: { ...material, id: previous.copy.item.id, gallerySource: previous.copy.source } }
        : await createPrivateVideoCopy(scope, material, controller.signal);
      controller.signal.throwIfAborted();
      receipt.current = { copy, revision: previous?.revision || 0 };
      setHasReceipt(true);
      const saved = await saveGalleryCopy(scope, copy, previous?.revision || 0, controller.signal);
      controller.signal.throwIfAborted();
      receipt.current = { copy, revision: saved.revision }; setSavedItem(item);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to save this video."); }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted) setBusy(false); } }
  }
  return <div className="mt-3">
    <button type="button" disabled={disabled || busy} onClick={() => void save()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50"><Save size={16} />{busy ? "Saving…" : hasReceipt ? "Save library changes" : "Save to my materials"}</button>
    {savedItem === item && <p role="status" className="mt-2 text-sm text-ok">Saved to My saved materials. You can reopen it from Gallery in any class.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
  </div>;
}
