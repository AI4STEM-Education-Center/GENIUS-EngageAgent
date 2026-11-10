import OpenAI from "openai";
import { NextResponse } from "next/server";
import { canUseAskEngageAgent, MAX_ASK_ANSWER } from "@/lib/ask-engageagent";
import { askMessages, askModel, parseAskRequest, takeAskSlot } from "@/lib/ask-engageagent-server";
import { enterLessonScope, loadTaskLessons } from "@/lib/lesson-scope";
import { guardWorkspaceRequest, workspaceRequestUser } from "@/lib/workspace-access";

/**
 * The Ask EngageAgent chatbot (#198). POST { classId, assignmentId, page, lessonNumber,
 * message, history } → { answer }. Teachers only: the guard keeps this path off the
 * student allow-list, and canUseAskEngageAgent says so explicitly as well. The prompt is
 * built here from the page and lesson; no class or student data is read or sent to OpenAI.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_OUTPUT_TOKENS = 500;
const TIMEOUT_MS = 25_000;

const reply = (body: { answer: string } | { error: string }, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const user = await workspaceRequestUser(request).catch(() => null);
  if (!user || !canUseAskEngageAgent(user.role)) return reply({ error: "Teacher access required." }, 403);

  const body = await request.json();
  // The lesson this task reads (#175), so a lesson made in the app, or a task's
  // pinned version, is the one the bot is told about.
  try {
    enterLessonScope(await loadTaskLessons({ classId: String(body.classId), assignmentId: String(body.assignmentId) }, body.lessonNumber));
  } catch {
    return reply({ error: "EngageAgent couldn't answer right now. Please try again." }, 503);
  }
  const ask = parseAskRequest(body);
  if (typeof ask === "string") return reply({ error: ask }, 400);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return reply({ error: "Ask EngageAgent isn't set up on this server yet." }, 503);
  if (!takeAskSlot(user.geniusId)) return reply({ error: "That's a lot of questions at once. Please wait a minute and try again." }, 429);

  try {
    const completion = await new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 }).chat.completions.create({
      model: askModel(),
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      messages: askMessages(ask),
    });
    const choice = completion.choices[0];
    const text = choice?.message?.content?.trim();
    if (!text) throw new Error("The reply was empty.");
    const answer = choice.finish_reason === "length" ? `${text}…` : text;
    return reply({ answer: answer.slice(0, MAX_ASK_ANSWER) });
  } catch (error) {
    // Only the status: a provider message can quote the key, and the question stays private.
    console.error("ask-engageagent: OpenAI request failed", { status: (error as { status?: unknown }).status });
    return reply({ error: "EngageAgent couldn't answer right now. Please try again." }, 502);
  }
}
