import { lookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable, Transform } from "node:stream";
import type { IncomingMessage } from "node:http";
import { NextRequest } from "next/server";
import { isSafeMaterialUrl } from "@/lib/material-url";
import { readLocalMaterial } from "@/lib/local-material-storage";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_REDIRECTS = 3;

class DownloadError extends Error {
  constructor(message: string, readonly status = 403) { super(message); }
}

/** Only globally routable addresses; mapped IPv6 and transition ranges fail closed. */
function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const [first, second = "0"] = address.split(":");
    const prefix = parseInt(first, 16);
    return prefix >= 0x2000 && prefix <= 0x3fff && prefix !== 0x2002
      && !(prefix === 0x2001 && (parseInt(second, 16) <= 0x1ff || parseInt(second, 16) === 0xdb8));
  }
  return false;
}

function downloadUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new DownloadError("Invalid download URL", 400); }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || host === "localhost" || /\.(?:localhost|local|internal)$/u.test(host)
    || (isIP(host) && !publicAddress(host))) {
    throw new DownloadError("Download destination is not allowed");
  }
  return url;
}

// Check the addresses in the connection's actual lookup, not a separate preflight
// lookup followed by fetch (which would allow DNS rebinding between the two).
const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
      return callback(new DownloadError("Download destination is not allowed"), "");
    }
    const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
    const usable = family ? addresses.filter(address => address.family === family) : addresses;
    if (!usable.length) return callback(new DownloadError("Download destination is not allowed"), "");
    return options.all ? callback(null, usable) : callback(null, usable[0].address, usable[0].family);
  });
};

async function openDownload(value: string, signal: AbortSignal): Promise<IncomingMessage> {
  let url = downloadUrl(value);
  for (let redirects = 0; ; redirects++) {
    const upstream = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = httpsRequest(url, { lookup: safeLookup, agent: false, signal, headers: { "Accept-Encoding": "identity" } }, resolve);
      request.on("error", reject);
      request.setTimeout(15_000, () => request.destroy(new Error("Download timed out")));
      request.end();
    });
    if ([301, 302, 303, 307, 308].includes(upstream.statusCode || 0)) {
      upstream.destroy();
      if (redirects >= MAX_REDIRECTS || !upstream.headers.location) throw new DownloadError("Invalid download redirect", 502);
      url = downloadUrl(new URL(upstream.headers.location, url).href);
      continue;
    }
    if (!upstream.statusCode || upstream.statusCode < 200 || upstream.statusCode >= 300) {
      upstream.destroy();
      throw new DownloadError("Failed to fetch file", 502);
    }
    if (Number(upstream.headers["content-length"]) > MAX_FILE_BYTES) {
      upstream.destroy();
      throw new DownloadError("File is too large", 413);
    }
    return upstream;
  }
}

function attachment(filename: string): string {
  if (!filename || filename.length > 180 || /[\u0000-\u001f\u007f"/\\]/u.test(filename)) {
    throw new DownloadError("Invalid filename", 400);
  }
  try {
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encoded}`;
  } catch { throw new DownloadError("Invalid filename", 400); }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) return new Response("Missing url parameter", { status: 400 });
  try {
    const disposition = attachment(request.nextUrl.searchParams.get("filename") ?? "download");
    const headers = { "Content-Disposition": disposition, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
    // Local signed assets are read through their verifier, never through loopback HTTP.
    if (url.startsWith("/") && isSafeMaterialUrl(url)) {
      const asset = await readLocalMaterial(new Request(new URL(url, request.nextUrl.origin)));
      return new Response(new Uint8Array(asset.bytes), { headers: { ...headers, "Content-Type": asset.mime } });
    }
    const upstream = await openDownload(url, AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]));
    let bytes = 0;
    const bounded = new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length;
      done(bytes > MAX_FILE_BYTES ? new Error("File is too large") : null, chunk);
    } });
    upstream.on("error", error => bounded.destroy(error));
    bounded.on("close", () => upstream.destroy());
    upstream.pipe(bounded);
    return new Response(Readable.toWeb(bounded) as ReadableStream<Uint8Array>, {
      headers: { ...headers, "Content-Type": upstream.headers["content-type"] ?? "application/octet-stream",
        ...(upstream.headers["content-encoding"] ? { "Content-Encoding": upstream.headers["content-encoding"] } : {}),
      },
    });
  } catch (error) {
    return new Response(error instanceof DownloadError ? error.message : "Failed to fetch file", {
      status: error instanceof DownloadError ? error.status : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
