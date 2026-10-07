"use client";

import { useEffect, useState } from "react";
import { buildPublishedContentState, type PublishedItemResponse } from "@/lib/published-content";
import { getEngagementStrategyLabel } from "@/lib/engagement-strategies";
import type { ContentItem } from "@/lib/types";
import PublishedSlidesReader from "./PublishedSlidesReader";
import { scopedClientAuthHeaders } from "@/lib/client-auth";

export default function PublishedSlidesList({ classId, assignmentId, refreshVersion }: {
  classId: string; assignmentId: string; refreshVersion: number;
}) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams({ classId, assignmentId });
        const response = await fetch(`/api/content-publish?${query}`, { headers: scopedClientAuthHeaders({ classId, assignmentId }), cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Published slides could not be loaded.");
        const data = await response.json() as { items?: PublishedItemResponse[] };
        if (controller.signal.aborted) return;
        setItems(buildPublishedContentState(data.items ?? [], []).contentItems.filter((item) => Boolean(item.slides)));
        setError("");
      } catch {
        if (!controller.signal.aborted) setError("Published slides could not be loaded. Please try again.");
      }
    }
    void load();
    return () => controller.abort();
  }, [classId, assignmentId, refreshVersion, retry]);

  if (!items.length && !error) return null;
  return <section aria-label="Published slides" className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 sm:p-6">
    <div>
      <h3 className="text-lg font-semibold text-slate-900">Published slides</h3>
      <p className="mt-1 text-sm text-slate-600">Students can read these slides in this task. Open a deck to read the published version.</p>
    </div>
    {error && <p role="alert" className="text-sm text-red-800">{error} <button type="button" onClick={() => setRetry((value) => value + 1)} className="font-semibold underline">Retry</button></p>}
    {items.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-900">{item.title}</h4>
          <p className="text-sm text-slate-600">{getEngagementStrategyLabel(item.strategy)} · {item.slides!.slideCount} slides</p>
        </div>
        <button type="button" aria-expanded={opened === item.id} onClick={() => setOpened((current) => current === item.id ? null : item.id)}
          className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          {opened === item.id ? "Close slides" : "Read slides"}
        </button>
      </div>
      {opened === item.id && <div className="mt-4"><PublishedSlidesReader classId={classId} assignmentId={assignmentId}
        publicationId={item.slides!.publicationId} audience="teacher" /></div>}
    </article>)}
  </section>;
}
