import { pollSlideJob } from "@/lib/slides/jobs";
import { readSlideBody, slideFailure } from "@/lib/slides/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try { return await pollSlideJob(request, await readSlideBody(request, 2000)); }
  catch (error) { return slideFailure(error); }
}
