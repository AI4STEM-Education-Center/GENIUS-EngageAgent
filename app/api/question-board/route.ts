import { NextResponse } from "next/server";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { getTaskDoc, putTaskDoc } from "@/lib/nosql";
import { BoardError, parseBoard, type QuestionBoard } from "@/lib/class-questions";

/**
 * The Class Question Board (#182): questions the teacher chose, shown to the
 * class without names.
 * GET ?classId&assignmentId → { board } (students and teachers)
 * PUT { classId, assignmentId, questions: [{ id, text, theme }] } → publish or update (teachers)
 * DELETE { classId, assignmentId } → unpublish (teachers)
 */
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  return json({ board: await getTaskDoc<QuestionBoard>(params.get("classId")!, params.get("assignmentId")!, "question_board") });
}

export async function PUT(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { classId, assignmentId, questions } = (await request.json()) as { classId: string; assignmentId: string; questions?: unknown };
  try {
    const board = parseBoard(questions);
    await putTaskDoc(classId, assignmentId, "question_board", board);
    return json({ board });
  } catch (error) {
    if (error instanceof BoardError) return json({ error: error.message }, 400);
    return json({ error: "The board couldn't be saved right now." }, 500);
  }
}

export async function DELETE(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { classId, assignmentId } = (await request.json()) as { classId: string; assignmentId: string };
  await putTaskDoc(classId, assignmentId, "question_board", null);
  return json({ board: null });
}
