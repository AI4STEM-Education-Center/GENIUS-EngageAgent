"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { canUseAskEngageAgent, MAX_ASK_HISTORY, MAX_ASK_MESSAGE, type AskMessage, type AskPage } from "@/lib/ask-engageagent";
import { scopedTaskFetch } from "@/lib/client-auth";
import type { UserContext } from "@/lib/auth";

type Props = {
  role: UserContext["role"];
  classId: string;
  assignmentId: string;
  page: AskPage;
  /** Shown as "Helping with: …". It comes from the page's own label, so a renamed step follows. */
  pageLabel: string;
  lessonNumber: number | null;
};

type Entry = { id: number; kind: "question" | "answer" | "error"; text: string };

const SUGGESTIONS: Record<AskPage, string[]> = {
  assessment: ["How do the quiz answers help choose a strategy?", "What does Match all items do?", "How do I upload my own quiz?"],
  strategy: ["How is the strategy recommended?", "What would Experience Bridging look like here?", "Can I choose a different strategy?"],
  materials: ["What does Check slides look for?", "Share to Gallery or Send to students: what's the difference?", "Should I choose slides or video?"],
  discussion: ["Which questions are best for discussion?", "What does the Class Question Board do?", "When do students get their reports?"],
  dashboard: ["Where can I see who has submitted?", "What does the cohort recommendation mean?"],
  gallery: ["What happens when I open a shared material?", "How do I share my own material?"],
};

const FALLBACK_ERROR = "EngageAgent couldn't answer right now. Please try again.";

/** Each answered question and its answer. A question that failed isn't sent again as context. */
const historyOf = (thread: Entry[]): AskMessage[] => thread.flatMap((entry, index) => entry.kind === "answer"
  ? [{ role: "user" as const, content: thread[index - 1].text }, { role: "assistant" as const, content: entry.text }]
  : []).slice(-MAX_ASK_HISTORY);

/** The round icon at the bottom right of the teacher pages and the chat panel it opens (#198). */
export default function AskEngageAgent({ role, classId, assignmentId, page, pageLabel, lessonNumber }: Props) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const nextId = useRef(0);
  const request = useRef<AbortController | null>(null);
  const wasOpen = useRef(false);
  const iconRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Focus moves into the panel when it opens and back to the icon when it closes.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) iconRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [open, thread, sending]);

  useEffect(() => () => request.current?.abort(), []);

  if (!canUseAskEngageAgent(role) || !classId || !assignmentId) return null;

  const add = (kind: Entry["kind"], text: string) => {
    const id = nextId.current++;
    setThread(current => [...current, { id, kind, text }]);
  };

  async function send(text: string) {
    const message = text.trim();
    // The ref also stops a second send in the same tick, before `sending` has re-rendered.
    if (!message || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setDraft("");
    add("question", message);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await scopedTaskFetch({ classId, assignmentId }, "/api/ask-engageagent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ classId, assignmentId, page, lessonNumber, message, history: historyOf(thread) }),
      });
      const data = (await response.json().catch(() => ({}))) as { answer?: unknown; error?: unknown };
      if (response.ok && typeof data.answer === "string") add("answer", data.answer);
      else add("error", typeof data.error === "string" ? data.error : FALLBACK_ERROR);
    } catch {
      add("error", FALLBACK_ERROR);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button ref={iconRef} type="button" onClick={() => setOpen(true)} aria-label="Ask EngageAgent" aria-haspopup="dialog" title="Ask EngageAgent"
        className="fixed bottom-4 right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-lg transition hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:bottom-6 sm:right-6">
        <MessageCircle size={24} aria-hidden="true" />
      </button>
    );
  }

  return (
    // Not modal: the teacher can keep using the page, and the scope follows it.
    <div role="dialog" aria-label="Ask EngageAgent" tabIndex={-1} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}
      className="fixed inset-x-4 bottom-4 z-40 flex h-[600px] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-line bg-white text-ink shadow-2xl outline-none sm:left-auto sm:right-6 sm:bottom-6 sm:w-[400px]">
      <div className="flex items-center gap-2 border-b border-line-2 px-4 py-3">
        <MessageCircle size={18} aria-hidden="true" className="text-brand" />
        <h2 className="font-semibold">Ask EngageAgent</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close Ask EngageAgent"
          className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-mute transition hover:bg-canvas hover:text-ink">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="border-b border-line-2 bg-canvas px-4 py-2 text-[13px] text-ink-2">Helping with: <b>{pageLabel}</b></p>

      <div ref={threadRef} role="log" aria-live="polite" aria-label="Conversation" tabIndex={0} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4 text-sm leading-6">
        {thread.length === 0 && <p className="text-mute">Ask about this page or any other part of EngageAgent.</p>}
        {thread.map(entry => (
          <p key={entry.id} className={`whitespace-pre-wrap break-words rounded-xl px-3 py-2 ${
            entry.kind === "question" ? "ml-8 self-end bg-brand-light"
              : entry.kind === "answer" ? "mr-4 self-start bg-canvas"
                : "mr-4 self-start bg-bad-light text-bad"}`}>
            <span className="sr-only">{entry.kind === "question" ? "You: " : "EngageAgent: "}</span>{entry.text}
          </p>
        ))}
        {sending && <p className="self-start px-3 py-2 text-mute">Thinking…</p>}
      </div>

      <div role="group" aria-label="Suggested questions" className="flex max-h-[30%] flex-wrap gap-1.5 overflow-y-auto border-t border-line-2 px-4 py-3">
        {SUGGESTIONS[page].map(question => (
          <button key={question} type="button" disabled={sending} onClick={() => { void send(question); inputRef.current?.focus(); }}
            className="min-h-8 rounded-full border border-line px-3 py-1 text-left text-xs font-medium text-ink-2 transition hover:border-faint hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50">
            {question}
          </button>
        ))}
      </div>

      <form className="border-t border-line-2 px-4 pb-3 pt-3" onSubmit={(event: FormEvent) => { event.preventDefault(); void send(draft); }}>
        <div className="flex gap-2">
          <input ref={inputRef} type="text" aria-label="Your question" placeholder="Ask a question…" maxLength={MAX_ASK_MESSAGE} value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }}
            className="min-h-10 min-w-0 flex-1 rounded-lg border border-line px-3 text-base text-ink focus:border-brand focus:outline-none sm:text-sm" />
          <button type="submit" aria-label="Send question" disabled={sending || !draft.trim()}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45">
            <Send size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-xs text-mute">AI answers can be wrong. Please don&apos;t include student names.</p>
      </form>
    </div>
  );
}
