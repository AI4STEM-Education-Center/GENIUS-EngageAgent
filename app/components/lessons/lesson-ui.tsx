"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, LayoutGrid } from "lucide-react";
import type { LessonProblem } from "@/lib/lessons";
import { useAuth } from "../AuthContext";
import GeniusSignIn from "../GeniusSignIn";
import AppFrame from "../layout/AppFrame";
import AppHeader from "../layout/AppHeader";

export const LESSONS_HOME = "/teacher/lessons";
export const editHref = (lessonNumber: number) => `${LESSONS_HOME}/${lessonNumber}/edit`;
export const historyHref = (lessonNumber: number) => `${LESSONS_HOME}/${lessonNumber}/history`;

/**
 * A full page load, not a client-side one. The editor always opens this way, so
 * the browser's Back button leaves a real page and its unsaved-changes warning runs.
 */
export const goTo = (href: string) => window.location.assign(href);

export const ui = {
  card: "rounded-xl border border-line bg-white p-5",
  eyebrow: "text-xs font-bold uppercase tracking-[0.08em] text-faint",
  label: "text-sm font-semibold text-ink",
  hint: "text-sm text-mute",
  input: "min-h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-2 focus:outline-brand-mid aria-invalid:border-bad",
  primary: "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50",
  secondary: "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-2 hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50",
  danger: "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-bad bg-white px-4 py-2 text-sm font-semibold text-bad hover:bg-bad-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad disabled:cursor-not-allowed disabled:opacity-50",
  dangerSolid: "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-bad px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad disabled:cursor-not-allowed disabled:opacity-50",
  icon: "grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line bg-white text-ink-2 hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40",
  pill: "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
  textLink: "inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-dark hover:underline",
};

export class LessonApiError extends Error {
  constructor(message: string, public status: number, public problems: LessonProblem[] = []) { super(message); }
}

/** Calls a lessons route. Anything but success throws a LessonApiError with a message safe to show. */
export async function lessonFetch<T>(url: string, init: Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit } = {}): Promise<T> {
  const { json, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store", ...rest,
      ...(json === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new LessonApiError("Couldn't reach EngageAgent. Check your connection and try again.", 0);
  }
  const body = await response.json().catch(() => null) as { error?: unknown; problems?: LessonProblem[] } | null;
  if (!response.ok) {
    const message = typeof body?.error === "string" && body.error ? body.error : "Something went wrong. Please try again.";
    throw new LessonApiError(message, response.status, Array.isArray(body?.problems) ? body.problems : []);
  }
  return body as T;
}

export const messageOf = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";

function dateWith(iso: string | null | undefined, options: Intl.DateTimeFormatOptions) {
  const date = new Date(iso ?? "");
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, options).format(date);
}
export const formatDay = (iso: string | null | undefined) => dateWith(iso, { dateStyle: "medium" });
export const formatMoment = (iso: string | null | undefined) => dateWith(iso, { dateStyle: "medium", timeStyle: "short" });

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The frame every lesson page shares, and who may see one. Pages inside it load nothing until it's a teacher. */
export function LessonsFrame({ children, beforeNavigate }: { children: ReactNode; beforeNavigate?: (proceed: () => void) => void }) {
  const auth = useAuth();
  const router = useRouter();
  const role = auth.user?.role;
  const sendHome = !auth.loading && !auth.error && Boolean(role) && role !== "teacher";
  useEffect(() => { if (sendHome) router.replace("/student/classes"); }, [sendHome, router]);

  if (auth.loading) return <p role="status" className="p-8 text-sm">Checking your session...</p>;
  if (!auth.user || auth.error) return <GeniusSignIn error={auth.error} />;
  if (sendHome) return <p role="status" className="p-8 text-sm">Taking you to your classes...</p>;
  // A GENIUS launch token can't manage lessons; these pages need a sign-in to EngageAgent itself.
  if (auth.isGeniusEmbed) return <GeniusSignIn />;
  return (
    <AppFrame header={<AppHeader userName={auth.user.name} homeHref="/teacher/classes" canSignOut beforeNavigate={beforeNavigate}
      actions={[
        { label: "Lessons", icon: <BookOpen size={15} />, href: LESSONS_HOME, active: true },
        { label: "Gallery", icon: <LayoutGrid size={15} />, href: "/teacher/classes?view=gallery" },
      ]} />}>
      {children}
    </AppFrame>
  );
}

const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

/** A dialog on the page: keeps keyboard focus inside it, closes on Escape, and hands focus back afterwards. */
export function LessonDialog({ title, onClose, closeLocked, children, footer, wide }: {
  title: string; onClose: () => void; closeLocked?: boolean; children: ReactNode; footer: ReactNode; wide?: boolean;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const locked = useRef(closeLocked);
  useEffect(() => { close.current = onClose; locked.current = closeLocked; });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && !locked.current) { event.stopPropagation(); close.current(); return; }
    if (event.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (event.shiftKey && (active === first || active === box.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8">
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}
        className={`w-full min-w-0 ${wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl bg-white shadow-2xl outline-none`}>
        <h2 id={titleId} className="border-b border-line-2 px-5 py-4 text-lg font-semibold text-ink sm:px-6">{title}</h2>
        <div className="grid gap-4 px-5 py-5 sm:px-6">{children}</div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line-2 px-5 py-4 sm:px-6">{footer}</div>
      </div>
    </div>
  );
}

export function LessonImagePreview({ src, alt }: { src: string; alt: string }) {
  // Same plain tag students' quiz uses: these are served by the app, in any size a teacher uploaded.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" decoding="async" className="h-auto max-h-64 w-full max-w-sm rounded-lg border border-line bg-white object-contain" />;
}

/** Something's wrong loading a page: says so plainly, with a way to try again. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-bad bg-bad-light p-4 text-sm text-bad">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className={`${ui.secondary} mt-3`}>Try again</button>
    </div>
  );
}

/** A short message at the bottom of the screen that goes away by itself. */
export function useLessonToast() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);
  const element = (
    <div role="alert" className="pointer-events-none fixed inset-x-4 bottom-24 z-40 flex justify-center">
      {toast && (
        <p className="pointer-events-auto flex max-w-xl items-start gap-3 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg">
          <span className="min-w-0">{toast}</span>
          <button type="button" onClick={() => setToast(null)} className="shrink-0 font-semibold underline">Dismiss</button>
        </p>
      )}
    </div>
  );
  return { showToast: setToast, toastElement: element };
}
