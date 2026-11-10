import type { UserContext } from "./auth";

/**
 * Ask EngageAgent (#198), the chatbot in the corner of the teacher pages.
 * This file is what the chat panel and its API route share, so it stays free of
 * server-only imports. The prompt and request checks are in ask-engageagent-server.ts.
 */

/**
 * Who may use the chatbot. Teachers only for now, which is an open question for
 * Samaneh. The panel and the route both ask this function, so this is the one line
 * to change. Opening it to students would also need
 * /api/ask-engageagent on the student allow-list in guardWorkspaceRequest.
 */
export const canUseAskEngageAgent = (role: UserContext["role"]) => role === "teacher";

export const ASK_PAGES = ["assessment", "strategy", "materials", "discussion", "dashboard", "gallery"] as const;
export type AskPage = (typeof ASK_PAGES)[number];

/** The page for each numbered teacher step, in step order. */
export const ASK_STEP_PAGES: readonly AskPage[] = ["assessment", "strategy", "materials", "discussion"];

export type AskMessage = { role: "user" | "assistant"; content: string };

export const MAX_ASK_MESSAGE = 1_000;
/** Earlier messages sent with each question: the last six questions and answers. */
export const MAX_ASK_HISTORY = 12;
/** Answers are cut to this length, so one can always be sent back as history. */
export const MAX_ASK_ANSWER = 4_000;
