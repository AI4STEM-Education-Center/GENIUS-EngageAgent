import { lessonImageKey, lessonImageNameType, lessonImageType } from "@/lib/lesson-images";
import { readGalleryBlob } from "@/lib/material-gallery-storage";

export const runtime = "nodejs";

const NOSNIFF = { "X-Content-Type-Options": "nosniff" };
const refuse = (message: string, status: number) => Response.json({ error: message }, { status, headers: { ...NOSNIFF, "Cache-Control": "no-store" } });

const isMissing = (error: unknown) => {
  const { name, code } = error as { name?: string; code?: string };
  return code === "ENOENT" || name === "NoSuchKey" || name === "NotFound";
};

/**
 * One quiz picture. Open to anyone with the link, like /quiz-images, because
 * students' browsers load it from an <img> inside GENIUS, which can't send a
 * sign-in. Names are 128 random bits, so they can't be guessed or listed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  // The name has to be one the server would have made, so no path tricks reach storage.
  const type = lessonImageNameType(name);
  if (!type) return refuse("Image not found.", 404);
  try {
    const bytes = await readGalleryBlob({ key: lessonImageKey(name), mime: type, digest: "", bytes: 0 });
    if (lessonImageType(bytes) !== type) return refuse("Image not found.", 404);
    return new Response(new Uint8Array(bytes), {
      headers: { ...NOSNIFF, "Content-Type": type, "Content-Length": String(bytes.length), "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch (error) {
    if (isMissing(error)) return refuse("Image not found.", 404);
    console.error("Lesson image read failed", { type: error instanceof Error ? error.name : "Unknown" });
    return refuse("The image is unavailable right now.", 503);
  }
}
