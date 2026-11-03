import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CopyObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SignJWT, jwtVerify } from "jose";
import { appOrigin } from "./session";
import { SlideRequestError } from "./slides/server";

export type GalleryBlob = { key: string; mime: string; digest: string; bytes: number; width?: number; height?: number };
const localFile = (key: string) => path.join(process.env.ENGAGE_LOCAL_DATA_DIR || path.join(process.cwd(), "data"), "material-gallery-assets", `${createHash("sha256").update(key).digest("hex")}.bin`);
function backend() {
  const bucket = process.env.ENGAGE_S3_BUCKET?.trim();
  if (!bucket) {
    if (process.env.NODE_ENV === "production" || process.env.DYNAMODB_TABLE) throw new SlideRequestError("The material library needs private cloud storage. Please try again after storage is configured.", 503);
    return null;
  }
  return { bucket, client: new S3Client({ region: process.env.ENGAGE_AWS_REGION || process.env.AWS_REGION || "us-east-2", maxAttempts: 1,
    ...(process.env.ENGAGE_AWS_ACCESS_KEY_ID && process.env.ENGAGE_AWS_SECRET_ACCESS_KEY ? { credentials: {
      accessKeyId: process.env.ENGAGE_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.ENGAGE_AWS_SECRET_ACCESS_KEY,
    } } : {}) }) };
}
export function assertGalleryStorage() { backend()?.client.destroy(); }

export async function storeGalleryBlob(key: string, bytes: Buffer, mime: string): Promise<GalleryBlob> {
  const store = backend();
  try {
    if (store) await store.client.send(new PutObjectCommand({ Bucket: store.bucket, Key: key, Body: bytes,
      ContentType: mime, ContentLength: bytes.length, CacheControl: "private, no-store" }), { abortSignal: AbortSignal.timeout(20_000) });
    else {
      const file = localFile(key); await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      try { await fs.writeFile(file, bytes, { mode: 0o600, flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await fs.readFile(file)).equals(bytes)) throw error; }
    }
  } finally { store?.client.destroy(); }
  return { key, mime, digest: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

/** Only call with an S3 key obtained from the already-authorized task's media record. */
export async function copyGalleryBlob(key: string, source: { bucket: string; key: string; mime: string }): Promise<GalleryBlob> {
  const store = backend();
  if (!store || source.bucket !== store.bucket) { store?.client.destroy(); throw new SlideRequestError("This video is not in the project's saved media storage. Save or regenerate it before sharing.", 422); }
  try {
    await store.client.send(new CopyObjectCommand({ Bucket: store.bucket, Key: key,
      CopySource: `${source.bucket}/${source.key.split("/").map(encodeURIComponent).join("/")}`,
      ContentType: source.mime, CacheControl: "private, no-store", MetadataDirective: "REPLACE" }), { abortSignal: AbortSignal.timeout(25_000) });
    return { key, mime: source.mime, digest: createHash("sha256").update(key).digest("hex"), bytes: 0 };
  } finally { store.client.destroy(); }
}

/** Copy an immutable Gallery asset when a teacher shares their adapted copy. */
export async function duplicateGalleryBlob(key: string, source: GalleryBlob) {
  const store = backend();
  if (store) {
    const bucket = store.bucket; store.client.destroy();
    return copyGalleryBlob(key, { bucket, key: source.key, mime: source.mime });
  }
  return storeGalleryBlob(key, await fs.readFile(localFile(source.key)), source.mime);
}

export async function readGalleryBlob(blob: GalleryBlob) {
  const store = backend();
  try {
    if (!store) return fs.readFile(localFile(blob.key));
    const response = await store.client.send(new GetObjectCommand({ Bucket: store.bucket, Key: blob.key }), { abortSignal: AbortSignal.timeout(20_000) });
    if ((response.ContentLength ?? 0) > 4_400_000) throw new Error("Saved material image is too large.");
    if (!response.Body) throw new Error("Saved material asset is missing.");
    return Buffer.from(await response.Body.transformToByteArray());
  } finally { store?.client.destroy(); }
}

function ticketKey() {
  if (!process.env.SSO_SECRET) throw new SlideRequestError("Material storage is not configured.", 503);
  return createHash("sha256").update(`engageagent-gallery-media-v1\0${process.env.SSO_SECRET}`).digest();
}
export async function galleryBlobUrl(blob: GalleryBlob) {
  const store = backend();
  if (store) {
    try { return await getSignedUrl(store.client, new GetObjectCommand({ Bucket: store.bucket, Key: blob.key,
      ResponseContentType: blob.mime, ResponseCacheControl: "private, no-store" }), { expiresIn: 900 }); }
    finally { store.client.destroy(); }
  }
  const ticket = await new SignJWT({ key: blob.key, mime: blob.mime }).setProtectedHeader({ alg: "HS256" })
    .setIssuer("engageagent-gallery-media").setAudience(appOrigin()).setIssuedAt().setExpirationTime("15m").sign(ticketKey());
  return `/api/material-gallery/media?ticket=${ticket}`;
}

export async function readGalleryMediaTicket(request: Request) {
  const store = backend();
  if (store) { store.client.destroy(); throw new SlideRequestError("Local media is unavailable.", 404); }
  const params = new URL(request.url).searchParams;
  if (params.size !== 1 || params.getAll("ticket").length !== 1 || (params.get("ticket")?.length ?? 0) > 2048) throw new SlideRequestError("Invalid media ticket.", 401);
  const { payload } = await jwtVerify(params.get("ticket") || "", ticketKey(), { issuer: "engageagent-gallery-media", audience: appOrigin(), algorithms: ["HS256"], requiredClaims: ["exp", "iat"] });
  if (typeof payload.key !== "string" || !/^material-gallery\/[a-f0-9-]+\/[a-z0-9_-]+-[a-f0-9]+$/u.test(payload.key)
    || typeof payload.mime !== "string" || !["video/mp4", "image/png", "image/jpeg", "image/webp"].includes(payload.mime)) throw new SlideRequestError("Invalid media ticket.", 401);
  return { bytes: await fs.readFile(localFile(payload.key)), mime: payload.mime };
}
