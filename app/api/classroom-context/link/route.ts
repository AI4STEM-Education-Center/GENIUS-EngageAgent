import { authorizeSlides, readSlideBody, slideJson, slideFailure, SlideRequestError } from "@/lib/slides/server";
import { GeniusContextError, linkGeniusClass, linkedGeniusClass, listGeniusClasses } from "@/lib/genius-context-client";
export const runtime = "nodejs";
function failure(error: unknown) {
  if (error instanceof GeniusContextError) return slideJson({ error: error.message }, [401, 403].includes(error.status) ? 403 : 503);
  return slideFailure(error);
}
export async function GET(request: Request) {
  try {
    const scope = await authorizeSlides(request, Object.fromEntries(new URL(request.url).searchParams));
    if (!scope.classId.startsWith("ea-class-")) throw new SlideRequestError("GENIUS classes are connected automatically.");
    return slideJson({ classes: await listGeniusClasses(scope.userId), selected: await linkedGeniusClass(scope) });
  } catch (e) { return failure(e); }
}
export async function PUT(request: Request) {
  try {
    const body = await readSlideBody(request, 4000);
    const scope = await authorizeSlides(request, body);
    if (body.geniusClassId !== null && typeof body.geniusClassId !== "string") throw new SlideRequestError("Choose a GENIUS class.");
    await linkGeniusClass(scope, body.geniusClassId as string | null);
    return slideJson({ saved: true });
  } catch (e) { return failure(e); }
}
