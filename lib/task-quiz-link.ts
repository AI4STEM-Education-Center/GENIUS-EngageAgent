/**
 * Reading quiz questions from a link a teacher pastes (#177).
 *
 * This fetches a URL someone else chose from inside our network, so it must not
 * become a way to reach private services. The rules:
 * - http and https only, ports 80 and 443 only, no credentials in the URL.
 * - Addresses are checked when the connection is made, by the `lookup` the
 *   socket itself uses. There is no gap between checking a name and using it,
 *   so a name that changes its answer (DNS rebinding) can't slip through.
 * - Every address a name resolves to must be public.
 * - Each redirect is checked again from scratch, and only a few are followed.
 * - There is one time limit for the whole chain and a cap on the response size.
 * - Only text-like responses are read, and no cookies or sign-in details are sent.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";

export const BAD_LINK_MESSAGE = "Paste a full link starting with https://";
const BLOCKED_MESSAGE = "This link can't be read. Use a public web address.";
const UNREACHABLE_MESSAGE = "We couldn't reach this link. Check it and try again.";
const TOO_SLOW_MESSAGE = "This link took too long to respond. Try again, or upload the quiz as a file.";
const NO_QUESTIONS_MESSAGE = "No multiple-choice questions found on this page.";
const MICROSOFT_FORMS_MESSAGE = "Microsoft Forms doesn't show its questions to a link reader. Copy them into a Word file and upload that instead.";

const MAX_LINK_LENGTH = 2_000;
export const MAX_REDIRECTS = 5;
export const LINK_TIMEOUT_MS = 15_000;
export const MAX_LINK_BYTES = 3 * 1024 * 1024;

/** Why a link can't be used, in words a teacher can act on. The quiz stays as it was. */
export class QuizLinkError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}

/* ------------------------------------------------------------------ */
/*  Which addresses are off limits                                     */
/* ------------------------------------------------------------------ */

const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(network, prefix, "ipv4");

// IPv6 is an allow-list: only global unicast, minus the parts of it with special uses.
// That rules out ::1, ::, fe80::/10, fc00::/7 (with fd00:ec2::254), ff00::/8, 64:ff9b::/96,
// and every IPv4-mapped or -compatible form of a private address such as ::ffff:127.0.0.1.
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
for (const [network, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) blockedV6.addSubnet(network, prefix, "ipv6");

/** True only for an address anyone on the internet could reach. Anything it can't make sense of is false. */
export function isPublicAddress(address: string) {
  const bare = address.replace(/^\[|\]$/gu, "");
  try {
    const family = isIP(bare);
    if (family === 4) return !blockedV4.check(bare, "ipv4");
    if (family === 6) return globalV6.check(bare, "ipv6") && !blockedV6.check(bare, "ipv6");
  } catch {
    return false;
  }
  return false;
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/u;

/** Throws unless this URL is allowed to be fetched. Names are checked again at connection time by `publicOnlyLookup`. */
export function assertPublicUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new QuizLinkError(BAD_LINK_MESSAGE);
  if (url.username || url.password) throw new QuizLinkError(BLOCKED_MESSAGE);
  if (url.port && url.port !== "80" && url.port !== "443") throw new QuizLinkError(BLOCKED_MESSAGE);
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  const bare = host.replace(/^\[|\]$/gu, "");
  if (isIP(bare)) {
    if (!isPublicAddress(bare)) throw new QuizLinkError(BLOCKED_MESSAGE);
    return;
  }
  if (!host.includes(".") || LOCAL_NAME.test(host)) throw new QuizLinkError(BLOCKED_MESSAGE);
}

class BlockedAddressError extends Error {
  code = "EBLOCKEDADDRESS";
}

/** Used by the socket in place of the normal name lookup, so only checked addresses can ever be connected to. */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true, family: options.family ?? 0 }, (error, addresses) => {
    if (error) { callback(error, "", 0); return; }
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      callback(new BlockedAddressError("Blocked address"), "", 0);
      return;
    }
    if (options.all) (callback as unknown as (e: null, list: dns.LookupAddress[]) => void)(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

/* ------------------------------------------------------------------ */
/*  Fetching                                                           */
/* ------------------------------------------------------------------ */

export type LinkResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: Readable };
export type LinkTransport = (url: URL, signal: AbortSignal) => Promise<LinkResponse>;

const nodeTransport: LinkTransport = (url, signal) => new Promise((resolve, reject) => {
  const client = url.protocol === "https:" ? https : http;
  const request = client.request(url, {
    method: "GET", lookup: publicOnlyLookup, signal, agent: false,
    headers: { "User-Agent": "EngageAgent-QuizImport/1.0", Accept: "text/html,text/plain;q=0.9,*/*;q=0.1", "Accept-Encoding": "identity" },
  }, (response) => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response }));
  request.on("error", reject);
  request.end();
});

const header = (response: LinkResponse, name: string) => {
  const value = response.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
};

const unzipperFor = (encoding: string) => {
  if (encoding === "gzip" || encoding === "x-gzip") return zlib.createGunzip();
  if (encoding === "br") return zlib.createBrotliDecompress();
  if (encoding === "deflate") return zlib.createInflate();
  return null;
};

/** Reads the body up to the cap, counting after decompression so a small compressed reply can't unpack to something huge. */
async function readBody(response: LinkResponse) {
  const tooLarge = new QuizLinkError("This page is too large to read. Upload the quiz as a file instead.");
  if (Number(header(response, "content-length")) > MAX_LINK_BYTES) { response.body.destroy(); throw tooLarge; }
  const encoding = header(response, "content-encoding").toLowerCase();
  const unzipper = encoding && encoding !== "identity" ? unzipperFor(encoding) : null;
  if (encoding && encoding !== "identity" && !unzipper) { response.body.destroy(); throw new QuizLinkError(UNREACHABLE_MESSAGE); }
  const stream: Readable = unzipper ? response.body.pipe(unzipper) : response.body;
  if (unzipper) response.body.on("error", (error) => unzipper.destroy(error));
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      bytes += chunk.length;
      if (bytes > MAX_LINK_BYTES) throw tooLarge;
      chunks.push(chunk);
    }
  } finally {
    response.body.destroy();
    unzipper?.destroy();
  }
  return Buffer.concat(chunks, bytes);
}

function decodeText(bytes: Buffer, contentType: string) {
  const charset = /charset=["']?([^"';\s]+)/iu.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

const TEXT_TYPES = /^(text\/[a-z0-9.+-]+|application\/xhtml\+xml)$/u;
const SIGN_IN_HOSTS = new Set(["accounts.google.com", "login.microsoftonline.com", "login.microsoft.com", "login.live.com"]);
const isSignInPage = (url: URL) => SIGN_IN_HOSTS.has(url.hostname.toLowerCase()) || /\/(log-?in|sign-?in|sso)(\/|$)/iu.test(url.pathname);

type LinkKind = "form" | "document" | "page";

const needsSignIn = (kind: LinkKind) => new QuizLinkError(
  kind === "form" ? "This form isn't public — share it as 'Anyone with the link'"
    : kind === "document" ? "This document isn't public — share it as 'Anyone with the link'"
      : "This page needs sign-in, so it can't be read.",
);

export type FetchedPage = { url: URL; contentType: string; text: string };

/** Fetches a page under every rule at the top of this file. `transport` is only swapped out by tests. */
export async function fetchPublicText(start: URL, kind: LinkKind = "page", transport: LinkTransport = nodeTransport, timeoutMs = LINK_TIMEOUT_MS): Promise<FetchedPage> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = start;
  try {
    for (let hop = 0; ; hop++) {
      assertPublicUrl(url);
      if (isSignInPage(url)) throw needsSignIn(kind);
      const response = await transport(url, signal);
      const { status } = response;
      if (status >= 300 && status < 400 && status !== 304) {
        response.body.destroy();
        if (hop >= MAX_REDIRECTS) throw new QuizLinkError("This link redirects too many times, so it can't be read.");
        try {
          url = new URL(header(response, "location"), url);
        } catch {
          throw new QuizLinkError(UNREACHABLE_MESSAGE);
        }
        continue;
      }
      if (status === 401 || status === 403) { response.body.destroy(); throw needsSignIn(kind); }
      if (status === 404 || status === 410) { response.body.destroy(); throw new QuizLinkError("We couldn't find this page. Check the link and try again."); }
      if (status < 200 || status >= 300) { response.body.destroy(); throw new QuizLinkError(UNREACHABLE_MESSAGE); }
      const contentType = header(response, "content-type").toLowerCase();
      if (!TEXT_TYPES.test(contentType.split(";")[0].trim())) {
        response.body.destroy();
        throw new QuizLinkError("This link isn't a web page we can read. If it's a file, download it and upload it here.");
      }
      return { url, contentType, text: decodeText(await readBody(response), contentType) };
    }
  } catch (error) {
    if (error instanceof QuizLinkError) throw error;
    const code = (error as { code?: string; name?: string }).code;
    const name = (error as { name?: string }).name;
    if (code === "EBLOCKEDADDRESS") throw new QuizLinkError(BLOCKED_MESSAGE);
    if (signal.aborted || code === "ABORT_ERR" || name === "AbortError" || name === "TimeoutError") throw new QuizLinkError(TOO_SLOW_MESSAGE);
    throw new QuizLinkError(UNREACHABLE_MESSAGE);
  }
}

/* ------------------------------------------------------------------ */
/*  Turning a page into text                                           */
/* ------------------------------------------------------------------ */

const SKIPPED_TAGS = new Set(["script", "style", "noscript", "head", "svg", "template", "iframe", "object", "embed", "canvas", "math"]);
const LINE_TAGS = new Set(["p", "div", "li", "ul", "ol", "br", "hr", "tr", "td", "th", "table", "section", "article", "header", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "label", "form", "fieldset", "legend", "option", "select", "blockquote", "pre", "dd", "dt", "dl", "main", "aside", "nav"]);

const decodeHtmlEntities = (value: string) => value.replace(/&(nbsp|amp|lt|gt|quot|apos|#39|#\d{1,7}|#x[0-9a-f]{1,6});/giu, (whole, code: string) => {
  const named: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  if (named[code.toLowerCase()]) return named[code.toLowerCase()];
  const point = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
});

/**
 * The visible text of a page. It walks the page once from start to end, because
 * the page is someone else's: a regular expression could be made to run for
 * minutes on a page built to break it.
 */
export function htmlToText(html: string) {
  // Only A to Z, so positions in this copy still line up with the page.
  const lower = html.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
  const parts: string[] = [];
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open < 0) { parts.push(html.slice(at)); break; }
    parts.push(html.slice(at, open));
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      at = end < 0 ? html.length : end + 3;
      continue;
    }
    const close = html.indexOf(">", open + 1);
    if (close < 0) break;
    const name = /^<\/?([a-z][a-z0-9-]*)/u.exec(lower.slice(open, Math.min(open + 32, close + 1)))?.[1];
    at = close + 1;
    if (!name) continue;
    if (SKIPPED_TAGS.has(name) && lower[open + 1] !== "/") {
      const end = lower.indexOf(`</${name}`, close);
      const after = end < 0 ? -1 : lower.indexOf(">", end);
      at = after < 0 ? html.length : after + 1;
      continue;
    }
    if (LINE_TAGS.has(name)) parts.push("\n");
  }
  return decodeHtmlEntities(parts.join(""))
    .split("\n").map((line) => line.replace(/[ \t\r\f\v ]+/gu, " ").trim()).filter(Boolean).join("\n");
}

/**
 * A public Google Form keeps its questions in a script variable. Google doesn't
 * document this, so anything unexpected returns null and the visible text is used.
 */
export function googleFormText(html: string): string | null {
  const marker = html.indexOf("FB_PUBLIC_LOAD_DATA_");
  const start = marker < 0 ? -1 : html.indexOf("[", marker);
  const end = start < 0 ? -1 : html.indexOf(";</script>", start);
  if (end < 0) return null;
  try {
    const items: unknown = JSON.parse(html.slice(start, end))?.[1]?.[1];
    if (!Array.isArray(items)) return null;
    const lines: string[] = [];
    for (const item of items) {
      const [, title, , type, fields] = item as [unknown, unknown, unknown, unknown, unknown[][] | undefined];
      // 2: multiple choice. 3: dropdown. 4: checkboxes.
      if (typeof title !== "string" || ![2, 3, 4].includes(type as number)) continue;
      const options = (fields?.[0]?.[1] as unknown[] | undefined ?? []).map((option) => (option as unknown[])?.[0]).filter((option): option is string => typeof option === "string" && Boolean(option));
      lines.push(`Question: ${title}`, ...options.map((option) => `- ${option}`));
    }
    return lines.length ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Knowing what a link is                                             */
/* ------------------------------------------------------------------ */

/** The link, or the message from UC 4.2 flow B. */
export function parseQuizLink(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim() || raw.length > MAX_LINK_LENGTH) throw new QuizLinkError(BAD_LINK_MESSAGE);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new QuizLinkError(BAD_LINK_MESSAGE);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !/^https?:\/\//iu.test(raw.trim())) throw new QuizLinkError(BAD_LINK_MESSAGE);
  return url;
}

export type QuizLinkInfo = { site: string; kind: LinkKind; microsoft: boolean; fetchUrl: URL };

/** What site this is, and the address that gives us its questions. */
export function describeQuizLink(url: URL): QuizLinkInfo {
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (host === "docs.google.com") {
    const doc = /^\/document\/d\/([A-Za-z0-9_-]+)/u.exec(url.pathname);
    // Documents published to the web have an /e/ address that's already a plain page.
    if (doc && doc[1] !== "e") return { site: "Google Docs", kind: "document", microsoft: false, fetchUrl: new URL(`https://docs.google.com/document/d/${doc[1]}/export?format=txt`) };
    const form = /^\/forms\/d\/([A-Za-z0-9_-]+)/u.exec(url.pathname);
    if (form && form[1] !== "e") return { site: "Google Forms", kind: "form", microsoft: false, fetchUrl: new URL(`https://docs.google.com/forms/d/${form[1]}/viewform`) };
    if (/^\/forms\//u.test(url.pathname)) return { site: "Google Forms", kind: "form", microsoft: false, fetchUrl: url };
    if (/^\/document\//u.test(url.pathname)) return { site: "Google Docs", kind: "document", microsoft: false, fetchUrl: url };
  }
  if (host === "forms.gle") return { site: "Google Forms", kind: "form", microsoft: false, fetchUrl: url };
  if (host === "forms.office.com" || host === "forms.microsoft.com" || host === "forms.cloud.microsoft" || host.endsWith(".forms.office.com")) {
    return { site: "Microsoft Forms", kind: "form", microsoft: true, fetchUrl: url };
  }
  return { site: host.replace(/^www\./u, ""), kind: "page", microsoft: false, fetchUrl: url };
}

/** The message when a page has been read and has no questions. */
export const noQuestionsMessage = (info: QuizLinkInfo) => (info.microsoft ? MICROSOFT_FORMS_MESSAGE : NO_QUESTIONS_MESSAGE);

const MIN_PAGE_TEXT = 20;
/** Microsoft Forms draws its questions in the browser, so what the server gets is only a shell. */
const MIN_MICROSOFT_TEXT = 400;

/** Fetches a link and returns its text. Throws a `QuizLinkError` saying why when it can't. */
export async function readQuizLink(url: URL, transport?: LinkTransport): Promise<{ info: QuizLinkInfo; text: string }> {
  // Checked before describing it, because a Google link is rewritten to a clean address.
  assertPublicUrl(url);
  const info = describeQuizLink(url);
  const page = await fetchPublicText(info.fetchUrl, info.kind, transport);
  if (/\/closedform(\/|$)/u.test(page.url.pathname)) throw new QuizLinkError("This form isn't taking responses, so its questions can't be read.");
  const isHtml = /html/u.test(page.contentType);
  const text = (isHtml ? googleFormText(page.text) ?? htmlToText(page.text) : page.text).trim();
  if (text.length < (info.microsoft ? MIN_MICROSOFT_TEXT : MIN_PAGE_TEXT)) throw new QuizLinkError(noQuestionsMessage(info));
  return { info, text };
}
