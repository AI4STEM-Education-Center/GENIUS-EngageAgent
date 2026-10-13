"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../components/AuthContext";
import { scopedClientAuthHeaders } from "@/lib/client-auth";

type GalleryItem = {
  media_id: string;
  content_item_id: string;
  media_type: "image" | "video";
  mime_type: string;
  url: string;
  class_id: string;
  assignment_id: string;
  student_id: string;
  created_at: string;
  s3_key?: string;
};

const PAGE_SIZE = 12;

export default function CommunityGallery() {
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [focusItem, setFocusItem] = useState<GalleryItem | null>(null);
  const [page, setPage] = useState(1);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const downloadRef = useRef<HTMLAnchorElement>(null);

  const fetchPage = useCallback(
    async (pageCursor: string | null, pageNumber: number) => {
      if (authLoading) return;
      if (user?.role !== "teacher") {
        setItems([]); setHasMore(false); setLoading(false); setError("Sign in as a teacher to view your class materials."); return;
      }
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          type: mediaType,
          limit: String(PAGE_SIZE),
        });
        if (search) params.set("search", search);
        if (pageCursor) params.set("cursor", pageCursor);
        if (user.classId && user.assignmentId) { params.set("classId", user.classId); params.set("assignmentId", user.assignmentId); }

        const res = await fetch(`/api/gallery?${params}`, { headers: scopedClientAuthHeaders(user), cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as Record<string, string>)?.error ??
              `Gallery request failed (${res.status}).`,
          );
        }
        const data = await res.json();

        const newItems: GalleryItem[] = data.items ?? [];
        setItems(newItems);
        setHasMore(Boolean(data.nextCursor) && newItems.length > 0);
        setPage(pageNumber);

        setCursorHistory((prev) => {
          const next = prev.slice(0, pageNumber);
          next[pageNumber] = data.nextCursor ?? null;
          return next;
        });
      } catch (err) {
        console.error("Gallery fetch error:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load gallery.",
        );
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [search, mediaType, authLoading, user],
  );

  // Reset and fetch page 1 whenever search or mediaType changes (including mount)
  useEffect(() => {
    setItems([]);
    setFocusItem(null);
    setHasMore(true);
    setPage(1);
    setCursorHistory([null]);
    fetchPage(null, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, mediaType, authLoading, user]);

  const goToPage = (targetPage: number) => {
    const pageCursor = cursorHistory[targetPage - 1] ?? null;
    fetchPage(pageCursor, targetPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  const downloadFile = (url: string, filename: string) => {
    const anchor = downloadRef.current;
    if (!anchor) return;

    if (url.startsWith("data:")) {
      const [header, base64] = url.split(",");
      const mime = header.match(/:(.*?);/)?.[1] ?? "application/octet-stream";
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      anchor.href = blobUrl;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } else {
      anchor.href = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
      anchor.download = filename;
      anchor.click();
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-slate-700"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back
          </Link>
          <div className="h-4 w-px bg-slate-200" />
          <h1 className="text-sm font-bold tracking-tight text-slate-900">
            Class Media Gallery
          </h1>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Teacher Dashboard
            </Link>
            <div className="flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setMediaType("image")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  mediaType === "image"
                    ? "bg-slate-900 text-white"
                    : "text-slate-400 hover:text-slate-700"
                }`}
              >
                Images
              </button>
              <button
                type="button"
                onClick={() => setMediaType("video")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  mediaType === "video"
                    ? "bg-slate-900 text-white"
                    : "text-slate-400 hover:text-slate-700"
                }`}
              >
                Videos
              </button>
            </div>
            <form onSubmit={handleSearch} className="relative">
              <svg
                className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search..."
                className="w-44 rounded-full border border-slate-200 bg-white py-1.5 pl-9 pr-8 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-400 sm:w-56"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </form>
          </div>
        </div>
      </header>

      {/* Gallery */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        {loading && (
          <div className="flex items-center justify-center py-32">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
          </div>
        )}

        {!loading && error && (
          <div className="mx-auto max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700">
            <p className="font-semibold">Something went wrong</p>
            <p className="mt-1 text-rose-500">{error}</p>
            <button
              type="button"
              onClick={() => goToPage(page)}
              className="mt-3 rounded-full border border-rose-200 bg-white px-4 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-32 text-slate-400">
            <svg
              className="h-12 w-12 text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="text-sm font-medium">
              {search
                ? `No ${mediaType}s found for "${search}"`
                : `No ${mediaType}s generated yet`}
            </p>
            <p className="text-xs text-slate-300">
              Generate content from the main workflow to populate the gallery.
            </p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((item, index) => (
                <div key={`${item.media_id}-${index}`} className="group">
                  <button
                    type="button"
                    onClick={() => setFocusItem(item)}
                    className="relative aspect-square w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-400"
                  >
                    {!item.url ? (
                      <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-300">
                        <svg
                          className="h-8 w-8"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                      </div>
                    ) : item.media_type === "image" ? (
                      <img
                        src={item.url}
                        alt={item.content_item_id}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <video
                        src={item.url}
                        className="h-full w-full object-cover"
                        muted
                        autoPlay
                        playsInline
                        loop
                      />
                    )}
                    <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition group-hover:opacity-100">
                      <div className="p-3">
                        <p className="truncate text-xs font-semibold text-white">
                          {item.content_item_id.replace(/-/g, " ")}
                        </p>
                        <p className="text-[10px] text-white/60">
                          {formatDate(item.created_at)}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-center gap-3 pt-10">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => goToPage(page - 1)}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:shadow-none"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Previous
              </button>
              <span className="rounded-full bg-slate-900 px-4 py-2 text-xs font-bold tabular-nums text-white">
                {page}
              </span>
              <button
                type="button"
                disabled={!hasMore || loading}
                onClick={() => goToPage(page + 1)}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:shadow-none"
              >
                Next
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          </>
        )}
      </main>

      {/* Lightbox */}
      {focusItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setFocusItem(null)}
        >
          <div
            className="relative flex max-h-[90vh] max-w-3xl flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setFocusItem(null)}
              className="absolute -right-2 -top-2 z-10 rounded-full bg-white p-2 text-slate-500 shadow-md transition hover:text-slate-800"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            {focusItem.media_type === "image" ? (
              <img
                src={focusItem.url}
                alt={focusItem.content_item_id}
                className="max-h-[75vh] rounded-2xl bg-white object-contain shadow-2xl"
              />
            ) : (
              <video
                src={focusItem.url}
                className="max-h-[75vh] rounded-2xl shadow-2xl"
                controls
                autoPlay
                playsInline
              />
            )}

            <div className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {focusItem.content_item_id.replace(/-/g, " ")}
                </p>
                <p className="text-xs text-slate-400">
                  {focusItem.student_id} · {focusItem.class_id} ·{" "}
                  {focusItem.assignment_id} · {formatDate(focusItem.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const ext = focusItem.media_type === "image" ? "webp" : "mp4";
                  downloadFile(
                    focusItem.url,
                    `${focusItem.content_item_id}-${focusItem.media_type}.${ext}`,
                  );
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3"
                  />
                </svg>
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      <a ref={downloadRef} className="hidden" />
    </div>
  );
}
