import { randomBytes } from "node:crypto";
import { LESSON_IMAGE_PATH, LESSON_IMAGE_TOO_LARGE, LESSON_IMAGE_WRONG_TYPE, MAX_LESSON_IMAGE_BYTES, lessonImageKey, lessonImageName, lessonImageType } from "@/lib/lesson-images";
import { lessonJson } from "@/lib/lessons-api";
import { storeGalleryBlob } from "@/lib/material-gallery-storage";
import { guardTeacherSessionRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";

/** Room for the form's own wrapping around the file. */
const MAX_REQUEST_BYTES = MAX_LESSON_IMAGE_BYTES + 64_000;

/** Reads the body, stopping as soon as it passes the limit. Null means it was too big. */
async function readUpTo(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

/** Stores a quiz item's picture under a name the server makes up, and returns where to find it. */
export async function POST(request: Request) {
  const denied = await guardTeacherSessionRequest(request);
  if (denied) return denied;
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return lessonJson({ error: "Send the image as a file upload." }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) return lessonJson({ error: LESSON_IMAGE_TOO_LARGE }, 413);
  try {
    const body = await readUpTo(request, MAX_REQUEST_BYTES);
    if (!body) return lessonJson({ error: LESSON_IMAGE_TOO_LARGE }, 413);
    const form = await new Response(new Uint8Array(body), { headers: { "Content-Type": contentType } }).formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob) || !file.size) return lessonJson({ error: "Choose an image to upload." }, 400);
    if (file.size > MAX_LESSON_IMAGE_BYTES) return lessonJson({ error: LESSON_IMAGE_TOO_LARGE }, 413);
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = lessonImageType(bytes);
    if (!type) return lessonJson({ error: LESSON_IMAGE_WRONG_TYPE }, 415);
    const name = lessonImageName(type, randomBytes(16).toString("hex"));
    await storeGalleryBlob(lessonImageKey(name), bytes, type);
    return lessonJson({ url: `${LESSON_IMAGE_PATH}/${name}` }, 201);
  } catch (error) {
    console.error("Lesson image upload failed", { type: error instanceof Error ? error.name : "Unknown" });
    return lessonJson({ error: "The image couldn't be stored. Please try again." }, 503);
  }
}
