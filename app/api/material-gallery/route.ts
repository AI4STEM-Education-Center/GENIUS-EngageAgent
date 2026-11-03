import { readSlideBody, slideFailure, slideJson, SlideRequestError } from "@/lib/slides/server";
import { galleryGet, galleryPost } from "@/lib/material-gallery-server";
import { WorkspaceError } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;
function galleryFailure(error: unknown) {
  if (error instanceof SlideRequestError || error instanceof WorkspaceError) return slideFailure(error);
  console.warn("Material Gallery request failed.");
  return slideJson({ error: "The material library is temporarily unavailable. Please try again shortly." }, 503);
}
export async function GET(request: Request) {
  try { return slideJson(await galleryGet(request)); } catch (error) { return galleryFailure(error); }
}
export async function POST(request: Request) {
  try { return slideJson(await galleryPost(request, await readSlideBody(request, 4_400_000))); } catch (error) { return galleryFailure(error); }
}
