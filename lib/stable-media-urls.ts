import type { SharedContentMedia } from "./published-content";

// Refresh on a poll before the URL expires, including a margin for clock skew
// and the media player's later range requests. Polling runs every 15 seconds.
const RENEWAL_MARGIN_MS = 60_000;
const SIGNING_PARAMETERS = new Set([
  "x-amz-algorithm", "x-amz-credential", "x-amz-date", "x-amz-expires",
  "x-amz-signature", "x-amz-signedheaders", "x-amz-security-token", "x-amz-content-sha256",
]);
type SignedResource = { identity: string; expiresAt: number };

function awsResource(url: URL): SignedResource | undefined {
  if (url.protocol !== "https:" || url.username || url.password) return;
  const params = url.searchParams;
  const signedAt = params.get("X-Amz-Date");
  const duration = params.get("X-Amz-Expires");
  if (params.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256"
    || !/^[a-f0-9]{64}$/iu.test(params.get("X-Amz-Signature") ?? "")
    || !signedAt || !/^\d{8}T\d{6}Z$/u.test(signedAt)
    || !duration || !/^\d+$/u.test(duration)) return;
  const seconds = Number(duration);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 604_800) return;
  const date = new Date(`${signedAt.slice(0, 4)}-${signedAt.slice(4, 6)}-${signedAt.slice(6, 8)}T${signedAt.slice(9, 11)}:${signedAt.slice(11, 13)}:${signedAt.slice(13, 15)}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().replace(/[-:]/gu, "").replace(".000", "") !== signedAt) return;
  const resourceParams = new URLSearchParams();
  for (const [name, value] of params) {
    // Keep versionId and every non-signing parameter: these may select different
    // bytes or response behavior even when the object path is unchanged.
    if (!SIGNING_PARAMETERS.has(name.toLowerCase())) resourceParams.append(name, value);
  }
  resourceParams.sort();
  return { identity: JSON.stringify([url.origin, url.pathname, resourceParams.toString(), url.hash]), expiresAt: date.getTime() + seconds * 1000 };
}

function localResource(value: string): SignedResource | undefined {
  // The local backends return relative URLs with a single signed JWT ticket.
  // Decode only to compare resource/expiry hints; the media route still verifies
  // its signature, audience and authorization before serving any bytes.
  if (!value.startsWith("/api/material-gallery/media?") && !value.startsWith("/api/local-material-assets?")) return;
  const url = new URL(value, "https://local-material.invalid");
  if (url.searchParams.size !== 1 || url.hash) return;
  const ticket = url.searchParams.get("ticket");
  if (!ticket || ticket.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(ticket)) return;
  const payload = ticket.split(".")[1];
  const decoded = atob(payload.replace(/-/gu, "+").replace(/_/gu, "/"));
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, character => character.charCodeAt(0))));
  const gallery = url.pathname === "/api/material-gallery/media";
  const resource = gallery ? claims.key : claims.id;
  if (claims.iss !== (gallery ? "engageagent-gallery-media" : "engageagent-local-material")
    || typeof resource !== "string" || !resource || resource.length > 2000
    || typeof claims.mime !== "string" || typeof claims.aud !== "string"
    || !Number.isSafeInteger(claims.exp) || claims.exp <= 0 || !Number.isSafeInteger(claims.exp * 1000)) return;
  return { identity: JSON.stringify([url.pathname, claims.iss, claims.aud, resource, claims.mime, claims.fileName ?? null]), expiresAt: claims.exp * 1000 };
}

function signedResource(value: string): SignedResource | undefined {
  try {
    if (value.startsWith("/")) return localResource(value);
    return awsResource(new URL(value));
  } catch { return undefined; }
}

/** Compare media/version identity even after a signature expires. This is only
 * a UI update guard; media endpoints still verify every access credential. */
export function sameMediaResource(current: string, incoming: string): boolean {
  if (current === incoming) return true;
  const previous = signedResource(current);
  const next = signedResource(incoming);
  return !!previous && !!next && previous.identity === next.identity;
}

/** Keep a playing URL stable when only its signature changed. This is a UI
 * optimization, never an authorization check or a cache of media bytes. */
export function stableMediaUrl(current: string | undefined, incoming: string | undefined, now = Date.now()): string | undefined {
  if (!current || !incoming || current === incoming) return incoming;
  const previous = signedResource(current);
  const next = signedResource(incoming);
  if (!previous || !next || previous.identity !== next.identity) return incoming;
  if (previous.expiresAt > now + RENEWAL_MARGIN_MS) return current;
  // A stale response must not shorten the lifetime of a still-usable URL.
  if (previous.expiresAt > now && next.expiresAt <= previous.expiresAt) return current;
  return incoming;
}

/** Call only with state belonging to the same learner/class/task. Missing items
 * and media kinds are removed, so withdrawn material is never kept alive. */
export function stableContentMedia(
  current: Record<string, SharedContentMedia>,
  incoming: Record<string, SharedContentMedia>,
  now = Date.now(),
): Record<string, SharedContentMedia> {
  return Object.fromEntries(Object.entries(incoming).map(([id, media]) => {
    // Images have no playback position to preserve. Adopt fresh capabilities
    // normally, including when signing credentials expire before nominal TTL.
    const image = media.image;
    const video = stableMediaUrl(current[id]?.video, media.video, now);
    return [id, { ...(image ? { image } : {}), ...(video ? { video } : {}) }];
  }));
}
