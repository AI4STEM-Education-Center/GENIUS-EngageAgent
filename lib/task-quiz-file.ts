/**
 * Uploaded quiz files (#177): checking what a file really is, reading its text,
 * and keeping it with the task so the teacher can see where the items came from.
 *
 * Word and PowerPoint files are zip archives, so a small file can unpack to
 * something huge. Only the parts holding text are unpacked, and unpacking stops
 * as soon as it goes over the limit. Nothing here reads anything but those parts,
 * and the text is only ever handed on as data.
 */
import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import JSZip from "jszip";
import { localMaterialStorageEnabled, localMaterialUrl, storeLocalMaterial } from "./local-material-storage";
import type { QuizDocument } from "./task-quiz-ai";

export const MAX_QUIZ_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TOO_LARGE_MESSAGE = "Files up to 10 MB";
const MAX_ZIP_ENTRIES = 5_000;
/** The most a file can claim to unpack to, and the most we actually unpack from its text parts. */
const MAX_DECLARED_UNZIPPED_BYTES = 300 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 40 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;
const SOURCE_URL_SECONDS = 600;
const STORAGE_TIMEOUT_MS = 20_000;

export const QUIZ_FILE_KINDS = ["docx", "pdf", "pptx"] as const;
export type QuizFileKind = (typeof QUIZ_FILE_KINDS)[number];

const CONTENT_TYPES: Record<QuizFileKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const MAIN_PART_TYPE = {
  docx: `${CONTENT_TYPES.docx}.main+xml`,
  pptx: `${CONTENT_TYPES.pptx}.main+xml`,
};
const MAIN_PART = { docx: "word/document.xml", pptx: "ppt/presentation.xml" };

/** The file isn't one we can read, for any reason. The teacher sees "No multiple-choice items found in {file}". */
export class UnsupportedQuizFile extends Error {}
export class QuizFileTooLarge extends Error {}

/** Reads the upload, stopping as soon as it goes over the limit, whatever its Content-Length said. */
export async function readQuizUpload(request: Request): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_QUIZ_FILE_BYTES)) throw new QuizFileTooLarge(FILE_TOO_LARGE_MESSAGE);
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_QUIZ_FILE_BYTES) {
        await reader.cancel();
        throw new QuizFileTooLarge(FILE_TOO_LARGE_MESSAGE);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

/** The name as the teacher knows it, or null if it isn't usable. Paths and control characters are never allowed. */
export function cleanQuizFileName(value: string | null): string | null {
  const name = value?.trim();
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f/\\]/u.test(name)) return null;
  return name;
}

const fileExtension = (name: string) => /\.([a-z0-9]+)$/iu.exec(name)?.[1].toLowerCase() ?? "";

/** Unpacks one part, counting what really comes out, so a part that lies about its size can't get past the limit. */
function unpackPart(part: JSZip.JSZipObject, budget: { left: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = part.nodeStream("nodebuffer");
    stream.on("data", (chunk: Buffer) => {
      budget.left -= chunk.length;
      if (budget.left < 0) {
        (stream as NodeJS.ReadableStream & { destroy: () => void }).destroy();
        reject(new UnsupportedQuizFile("The file unpacks to too much data."));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", () => reject(new UnsupportedQuizFile("A part of the file couldn't be unpacked.")));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const decodeEntities = (value: string) => value.replace(/&(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-f]{1,6});/giu, (whole, code: string) => {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  if (named[code.toLowerCase()]) return named[code.toLowerCase()];
  const point = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
});

/** The text of Office XML, one paragraph per line. It looks for text runs only, so it never expands anything the file defines. */
function officeParagraphs(xml: string, tag: "w" | "a"): string[] {
  const run = new RegExp(`<${tag}:t(?:\\s[^>]*)?>([^<]*)</${tag}:t>|<${tag}:tab/>|<${tag}:br(?:\\s[^>]*)?/>`, "gu");
  const lines: string[] = [];
  for (const paragraph of xml.split(`</${tag}:p>`)) {
    let line = "";
    for (const match of paragraph.matchAll(run)) line += match[1] === undefined ? " " : decodeEntities(match[1]);
    const clean = line.replace(/\s+/gu, " ").trim();
    // Word's automatic list letters aren't in the text, so show that this line was a list entry.
    if (clean) lines.push(tag === "w" && paragraph.includes("<w:numPr>") ? `- ${clean}` : clean);
  }
  return lines;
}

async function readPptxText(zip: JSZip, budget: { left: number }) {
  const slideNumber = (name: string) => Number(/slide(\d+)\.xml$/u.exec(name)?.[1] ?? 0);
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).sort((a, b) => slideNumber(a) - slideNumber(b));
  const lines: string[] = [];
  let length = 0;
  for (const name of slides) {
    const number = slideNumber(name);
    const start = lines.length;
    lines.push(`Slide ${number}:`, ...officeParagraphs((await unpackPart(zip.files[name], budget)).toString("utf8"), "a"));
    // Answer keys are often in the speaker notes. The slide's relationships say which notes are its own.
    const rels = zip.files[`ppt/slides/_rels/slide${number}.xml.rels`];
    const notes = rels ? /notesSlides\/(notesSlide\d+\.xml)/u.exec((await unpackPart(rels, budget)).toString("utf8"))?.[1] : undefined;
    const notesPart = notes ? zip.files[`ppt/notesSlides/${notes}`] : undefined;
    if (notesPart) lines.push(`Speaker notes for slide ${number}:`, ...officeParagraphs((await unpackPart(notesPart, budget)).toString("utf8"), "a"));
    length += lines.slice(start).join("\n").length;
    if (length > MAX_TEXT_CHARS) break;
  }
  return lines;
}

async function readOfficeFile(bytes: Buffer, kind: "docx" | "pptx"): Promise<QuizDocument> {
  if (bytes.length < 4 || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new UnsupportedQuizFile("Not a zip archive.");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new UnsupportedQuizFile("The archive couldn't be opened.");
  }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ZIP_ENTRIES) throw new UnsupportedQuizFile("The archive has too many parts.");
  // JSZip keeps each entry's claimed size here. It's only a quick early check; unpackPart counts what really comes out.
  const declared = names.reduce((sum, name) => sum + ((zip.files[name] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (declared > MAX_DECLARED_UNZIPPED_BYTES) throw new UnsupportedQuizFile("The file unpacks to too much data.");
  if (names.some((name) => /vbaProject\.bin$/iu.test(name))) throw new UnsupportedQuizFile("Files with macros aren't accepted.");
  const budget = { left: MAX_UNZIPPED_BYTES };
  const typesPart = zip.files["[Content_Types].xml"];
  if (!typesPart || !zip.files[MAIN_PART[kind]]) throw new UnsupportedQuizFile("The file isn't the kind its name says.");
  const types = (await unpackPart(typesPart, budget)).toString("utf8");
  if (!types.includes(MAIN_PART_TYPE[kind])) throw new UnsupportedQuizFile("The file isn't the kind its name says.");
  const lines = kind === "docx"
    ? officeParagraphs((await unpackPart(zip.files[MAIN_PART.docx], budget)).toString("utf8"), "w")
    : await readPptxText(zip, budget);
  const text = lines.join("\n").slice(0, MAX_TEXT_CHARS);
  // Slide labels on their own aren't anything to read.
  if (text.replace(/^(Slide|Speaker notes for slide) \d+:$/gmu, "").trim().length < 10) throw new UnsupportedQuizFile("The file has no text.");
  return { type: "text", text };
}

/**
 * Decides what the file is from its bytes, and refuses it unless that agrees
 * with its name. A PDF goes to the AI service whole, since its text can't be
 * read here without a new dependency.
 */
export async function readQuizFile(bytes: Buffer, fileName: string): Promise<{ kind: QuizFileKind; document: QuizDocument }> {
  const extension = fileExtension(fileName);
  if (!QUIZ_FILE_KINDS.includes(extension as QuizFileKind)) throw new UnsupportedQuizFile("Only .docx, .pdf and .pptx are accepted.");
  const kind = extension as QuizFileKind;
  if (kind === "pdf") {
    if (bytes.length < 8 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new UnsupportedQuizFile("Not a PDF.");
    return { kind, document: { type: "pdf", bytes } };
  }
  return { kind, document: await readOfficeFile(bytes, kind) };
}

function storageClient() {
  return new S3Client({ region: process.env.ENGAGE_AWS_REGION || process.env.AWS_REGION || "us-east-2", maxAttempts: 1,
    ...(process.env.ENGAGE_AWS_ACCESS_KEY_ID && process.env.ENGAGE_AWS_SECRET_ACCESS_KEY ? { credentials: {
      accessKeyId: process.env.ENGAGE_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.ENGAGE_AWS_SECRET_ACCESS_KEY,
    } } : {}) });
}

const attachmentName = (fileName: string) => fileName.replace(/[^A-Za-z0-9._ -]/gu, "-").replace(/^[. ]+/u, "") || "quiz-file";

/**
 * Keeps the file, private to the task. Under material-files/ because the
 * production login can already write there (docs/production-release.md). Keys
 * are never chosen by the client.
 */
export async function storeQuizFile(activity: { classId: string; assignmentId: string }, kind: QuizFileKind, fileName: string, bytes: Buffer) {
  const scope = createHash("sha256").update(JSON.stringify([activity.classId, activity.assignmentId])).digest("hex");
  const storageKey = `material-files/task-quiz/${scope}/${randomUUID()}.${kind}`;
  if (localMaterialStorageEnabled()) {
    await storeLocalMaterial(storageKey, bytes);
    return storageKey;
  }
  const bucket = process.env.ENGAGE_S3_BUCKET?.trim();
  if (!bucket) throw new Error("No file storage is configured.");
  const client = storageClient();
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: storageKey, Body: bytes, ContentLength: bytes.length, ContentType: CONTENT_TYPES[kind],
      ContentDisposition: `attachment; filename="${attachmentName(fileName)}"`, CacheControl: "private, no-store" }),
    { abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) });
  } finally {
    client.destroy();
  }
  return storageKey;
}

/** A short-lived download link for the teacher. Always a download, never shown inline. */
export async function quizFileUrl(file: { storageKey: string; fileName: string; fileKind: string }) {
  const name = attachmentName(file.fileName);
  if (localMaterialStorageEnabled()) return localMaterialUrl(file.storageKey, "application/octet-stream", name);
  const bucket = process.env.ENGAGE_S3_BUCKET?.trim();
  if (!bucket) throw new Error("No file storage is configured.");
  const client = storageClient();
  try {
    return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: file.storageKey,
      ResponseContentType: CONTENT_TYPES[file.fileKind as QuizFileKind] ?? "application/octet-stream",
      ResponseContentDisposition: `attachment; filename="${name}"`, ResponseCacheControl: "private, no-store" }), { expiresIn: SOURCE_URL_SECONDS });
  } finally {
    client.destroy();
  }
}
