import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SignJWT, jwtVerify } from "jose";

const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/octet-stream", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]);
const TICKET_SECONDS = 600;
const localOrigin = () => new URL(process.env.ENGAGE_APP_URL || "").origin;

/** Explicit local-only backend; a conflicting AWS configuration must fail closed. */
export function localMaterialStorageEnabled() {
  if (process.env.ENGAGE_LOCAL_MATERIAL_STORAGE !== "1") return false;
  if (process.env.NODE_ENV === "production" || process.env.DYNAMODB_TABLE || process.env.ENGAGE_S3_BUCKET) {
    throw new Error("Local material storage requires development mode without AWS storage.");
  }
  const origin = new URL(localOrigin());
  if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || !["http:", "https:"].includes(origin.protocol)) {
    throw new Error("Local material storage requires a loopback EngageAgent origin.");
  }
  return true;
}

function key() {
  const secret = process.env.SSO_SECRET;
  if (!secret) throw new Error("SSO_SECRET is required for local material URLs.");
  return createHash("sha256").update(`engageagent-local-material-v1\0${secret}`).digest();
}
function assetFile(id: string) {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error("Invalid local material ID.");
  return path.join(process.env.ENGAGE_LOCAL_DATA_DIR || path.join(process.cwd(), "data"), "material-assets", `${id}.bin`);
}
const assetId = (storageKey: string) => createHash("sha256").update(storageKey).digest("hex");

/** Called only after the existing teacher authorization and file/image validation. */
export async function storeLocalMaterial(storageKey: string, bytes: Buffer) {
  if (!localMaterialStorageEnabled()) throw new Error("Local material storage is disabled.");
  key(); // Fail before storing if future signed reads cannot be served.
  const file = assetFile(assetId(storageKey));
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try { await fs.writeFile(file, bytes, { mode: 0o600, flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await fs.readFile(file)).equals(bytes)) throw error;
  }
}

/** Same short-lived capability model as private S3 signed URLs, issued after authorization. */
export async function localMaterialUrl(storageKey: string, mime: string, fileName?: string) {
  if (!localMaterialStorageEnabled() || !MIME_TYPES.has(mime)) throw new Error("Unsupported local material.");
  if (fileName && (fileName.length > 180 || /[\u0000-\u001f\u007f"/\\]/u.test(fileName))) throw new Error("Invalid local material filename.");
  const ticket = await new SignJWT({ id: assetId(storageKey), mime, ...(fileName ? { fileName } : {}) })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("engageagent-local-material").setAudience(localOrigin())
    .setIssuedAt().setExpirationTime(`${TICKET_SECONDS}s`).sign(key());
  return `/api/local-material-assets?ticket=${ticket}`;
}

export async function readLocalMaterial(request: Request) {
  if (!localMaterialStorageEnabled() || new URL(request.url).origin !== localOrigin()) throw new Error("Local material storage is disabled.");
  const params = new URL(request.url).searchParams;
  const ticket = params.get("ticket");
  if (!ticket || ticket.length > 4096 || [...params.keys()].some(name => name !== "ticket") || params.getAll("ticket").length !== 1) throw new Error("Invalid local material URL.");
  const { payload } = await jwtVerify(ticket, key(), { issuer: "engageagent-local-material", audience: localOrigin(), algorithms: ["HS256"], requiredClaims: ["exp", "iat"] });
  if (typeof payload.id !== "string" || typeof payload.mime !== "string" || !MIME_TYPES.has(payload.mime)
    || (payload.fileName !== undefined && (typeof payload.fileName !== "string" || payload.fileName.length > 180 || /[\u0000-\u001f\u007f"/\\]/u.test(payload.fileName)))) throw new Error("Invalid local material ticket.");
  const bytes = await fs.readFile(assetFile(payload.id));
  return { bytes, mime: payload.mime, fileName: payload.fileName as string | undefined };
}
