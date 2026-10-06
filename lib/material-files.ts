import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import JSZip from "jszip";
import { authorizeSlides, SlideRequestError } from "./slides/server";

export const MAX_MATERIAL_FILE_BYTES = 4_400_000;
export const MATERIAL_FILE_URL_SECONDS = 600;
export const PPTX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

async function readFileBytes(request: Request): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_MATERIAL_FILE_BYTES)) {
    throw new SlideRequestError("The file exceeds the 4.4 MB hosted-download limit. Use the local save link.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SlideRequestError("Provide the prepared material file.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_MATERIAL_FILE_BYTES) {
        await reader.cancel();
        throw new SlideRequestError("The file exceeds the 4.4 MB hosted-download limit. Use the local save link.", 413);
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  if (!bytes) throw new SlideRequestError("The prepared material file is empty.", 422);
  return Buffer.concat(chunks, bytes);
}

async function validateFile(bytes: Buffer, kind: "pptx" | "html") {
  if (kind === "pptx") {
    if (bytes.length < 4 || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new SlideRequestError("Provide a generated PowerPoint file.", 422);
    }
    try {
      // Inspect the ZIP directory only; do not inflate arbitrary uploaded parts.
      const zip = await JSZip.loadAsync(bytes);
      if (Object.keys(zip.files).length > 500 || ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/slides/slide1.xml"].some(part => !zip.file(part))
        || Object.keys(zip.files).some(part => /vbaProject\.bin$/iu.test(part))) throw new Error("Not a supported presentation package");
    } catch { throw new SlideRequestError("The file is not a complete generated PowerPoint package.", 422); }
    return;
  }
  let html: string;
  try { html = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new SlideRequestError("Provide a UTF-8 EngageAgent material file.", 422); }
  // Recognize our export wrapper. This is not a claim to sanitize arbitrary HTML:
  // hosted HTML is always served as an octet-stream attachment from private S3.
  if (!html.startsWith('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">')
    || !html.includes('<p class="hint">EngageAgent · Explore and ask</p>') || !html.endsWith("</body></html>")) {
    throw new SlideRequestError("Provide an HTML material file prepared by EngageAgent.", 422);
  }
}

/** Store the exact prepared bytes; users cannot choose an upstream URL, bucket, or object key. */
export async function hostMaterialFile(request: Request): Promise<{ url: string; fileName: string }> {
  const params = new URL(request.url).searchParams;
  const context = { classId: params.get("classId"), assignmentId: params.get("assignmentId") };
  const authorized = await authorizeSlides(request, context);
  const allowed = ["classId", "assignmentId", "fileName"];
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw new SlideRequestError("Invalid material-file parameters.");
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const kind = type === PPTX_CONTENT_TYPE ? "pptx" : type === "text/html" ? "html" : undefined;
  if (!kind || (request.headers.get("content-encoding") && request.headers.get("content-encoding") !== "identity")) {
    throw new SlideRequestError("Upload a prepared PPTX or HTML file as a binary request.", 415);
  }
  const name = params.get("fileName");
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f/\\]/u.test(name) || !name.toLowerCase().endsWith(`.${kind}`)) {
    throw new SlideRequestError("Choose a valid material filename matching its file type.");
  }
  const fileName = name.replace(/[^A-Za-z0-9._ -]/gu, "-").replace(/^[. ]+/u, "").trim();
  if (fileName.length <= kind.length + 1) throw new SlideRequestError("Choose a valid material filename.");
  const bytes = await readFileBytes(request);
  await validateFile(bytes, kind);
  const bucket = process.env.ENGAGE_S3_BUCKET?.trim();
  if (!bucket) throw new SlideRequestError("File hosting is unavailable. Use the local save link.", 503);
  const client = new S3Client({ region: process.env.ENGAGE_AWS_REGION || process.env.AWS_REGION || "us-east-2", maxAttempts: 1,
    ...(process.env.ENGAGE_AWS_ACCESS_KEY_ID && process.env.ENGAGE_AWS_SECRET_ACCESS_KEY ? { credentials: {
      accessKeyId: process.env.ENGAGE_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.ENGAGE_AWS_SECRET_ACCESS_KEY,
    } } : {}) });
  const scope = createHash("sha256").update(JSON.stringify([authorized.classId, authorized.assignmentId])).digest("hex");
  const key = `material-files/${scope}/${randomUUID()}.${kind}`;
  const contentType = kind === "html" ? "application/octet-stream" : PPTX_CONTENT_TYPE;
  const disposition = `attachment; filename="${fileName}"`;
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.length,
      ContentType: contentType, ContentDisposition: disposition, CacheControl: "private, no-store" }),
    { abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]) });
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key,
      ResponseContentType: contentType, ResponseContentDisposition: disposition, ResponseCacheControl: "private, no-store" }), { expiresIn: MATERIAL_FILE_URL_SECONDS });
    if (new URL(url).protocol !== "https:") throw new Error("Invalid hosted download URL");
    return { url, fileName };
  } finally { client.destroy(); }
}
