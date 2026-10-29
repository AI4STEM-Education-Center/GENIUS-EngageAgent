import { NextResponse } from "next/server";
import { sameOriginRequest } from "@/lib/session";
import { WorkspaceError } from "@/lib/workspace";
import { agentTaskRequestUser } from "@/lib/agent-task-access";
import { archiveAgentTask, createAgentTask, linkAgentTask, listAgentTaskLinks, requireLaunchableAgentTask, requireOwnedAgentTask, updateAgentTask, type AgentTask } from "@/lib/agent-tasks";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof WorkspaceError) return json({ error: error.message }, error.status);
  console.error("Agent task request failed", { type: error instanceof Error ? error.name : "Unknown" });
  return json({ error: "EngageAgent storage is unavailable. Please try again." }, 503);
}
// Students see only what the activity is called, never who owns it.
const publicTask = (task: AgentTask) => ({ agentTaskId: task.agentTaskId, title: task.title });

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: "Invalid request origin." }, 403);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SyntaxError();
  } catch { return json({ error: "Invalid request body." }, 400); }
  try {
    const user = await agentTaskRequestUser(request);
    switch (body.action) {
      case "create": {
        const task = await createAgentTask(user, body.title);
        await linkAgentTask(task.agentTaskId, user);
        return json({ task }, 201);
      }
      case "open": {
        // /edit and /view: the owner's setup, plus this class when GENIUS signed one.
        const task = await requireOwnedAgentTask(user, body.taskId, { allowArchived: body.allowArchived === true });
        if (!task.archived) await linkAgentTask(task.agentTaskId, user);
        return json({ task, links: await listAgentTaskLinks(task.agentTaskId) });
      }
      case "update":
        return json({ task: await updateAgentTask(user, body.taskId, { title: body.title }) });
      case "archive":
        return json({ task: await archiveAgentTask(user, body.taskId) });
      case "launch":
        return json({ task: publicTask(await requireLaunchableAgentTask(user, body.taskId)) });
      default:
        return json({ error: "Invalid activity action." }, 400);
    }
  } catch (error) { return failure(error); }
}
