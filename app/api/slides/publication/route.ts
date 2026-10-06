import { readSlidePublication, writeSlidePublication, MAX_SLIDE_PUBLICATION_BYTES } from "@/lib/slides/publish-server";
import { readSlideBody, slideJson, SlideRequestError } from "@/lib/slides/server";
import { WorkspaceError } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 30;
function failure(error: unknown) {
  if (error instanceof SlideRequestError || error instanceof WorkspaceError) return slideJson({ error: error.message }, error.status);
  console.error("Slide publication failed", { type: error instanceof Error ? error.name : "Unknown" });
  return slideJson({ error: "Slide publishing or reading is unavailable. Your draft is unchanged. Please try again." }, 503);
}
export async function POST(request: Request) {
  try { return slideJson(await writeSlidePublication(request, await readSlideBody(request, MAX_SLIDE_PUBLICATION_BYTES))); }
  catch (error) { return failure(error); }
}
export async function GET(request: Request) {
  try { return slideJson(await readSlidePublication(request)); }
  catch (error) { return failure(error); }
}
