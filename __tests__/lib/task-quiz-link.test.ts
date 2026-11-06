import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough, Readable } from "node:stream";
import zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPublicUrl, BAD_LINK_MESSAGE, describeQuizLink, fetchPublicText, googleFormText, htmlToText, isPublicAddress, MAX_LINK_BYTES, MAX_REDIRECTS, parseQuizLink, publicOnlyLookup,
  QuizLinkError, readQuizLink, type LinkTransport,
} from "@/lib/task-quiz-link";

afterEach(() => { vi.restoreAllMocks(); });

type Page = { status?: number; headers?: Record<string, string>; body?: string | Buffer };
const HTML = { "content-type": "text/html; charset=utf-8" };
/** Answers from a table of addresses, and records every address asked for. */
function sites(table: Record<string, Page>) {
  const asked: string[] = [];
  const transport: LinkTransport = async (url) => {
    asked.push(url.href);
    const page = table[url.href];
    if (!page) throw new Error("Unexpected address");
    return { status: page.status ?? 200, headers: page.headers ?? HTML, body: Readable.from(page.body === undefined ? [] : [Buffer.from(page.body)]) };
  };
  return { transport, asked };
}
const message = (run: () => unknown) => Promise.resolve().then(run).then(() => { throw new Error("Expected a refusal"); }, (error: Error) => {
  expect(error).toBeInstanceOf(QuizLinkError);
  return error.message;
});
const redirect = (location: string): Page => ({ status: 302, headers: { location } });
const BLOCKED = "This link can't be read. Use a public web address.";

describe("what counts as a full link (UC 4.2 flow B)", () => {
  it.each(["example.com", "www.example.com/quiz", "ftp://example.com/q", "file:///etc/passwd", "javascript:alert(1)", "https:example.com", "//example.com", "", "   ", "data:text/html,hi", "gopher://x.y"])("refuses %j", (raw) => {
    expect(() => parseQuizLink(raw)).toThrow(BAD_LINK_MESSAGE);
  });
  it("refuses things that aren't text, and very long links", () => {
    for (const raw of [null, undefined, 4, {}, `https://example.com/${"x".repeat(2000)}`]) expect(() => parseQuizLink(raw)).toThrow(BAD_LINK_MESSAGE);
  });
  it("takes http and https, trimmed", () => {
    expect(parseQuizLink(" https://example.com/q ").href).toBe("https://example.com/q");
    expect(parseQuizLink("http://example.com/").protocol).toBe("http:");
  });
});

describe("which addresses are public", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.168.255.255", "169.254.169.254", "169.254.0.1",
    "0.0.0.0", "100.64.0.1", "100.127.255.255", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "febf::1", "fc00::1", "fdff::1", "fd00:ec2::254", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:192.168.0.1",
    "::127.0.0.1", "64:ff9b::7f00:1", "100::1", "2001:db8::1", "2001::1", "2002:7f00:1::1", "3fff::1",
    "not-an-ip", "", "999.1.1.1", "example.com",
  ])("%s is not", (address) => { expect(isPublicAddress(address)).toBe(false); });
  it.each(["8.8.8.8", "93.184.216.34", "172.15.255.255", "172.32.0.1", "192.167.255.255", "192.169.0.1", "100.63.255.255", "100.128.0.1", "11.0.0.1", "126.255.255.255", "128.0.0.1", "169.253.0.1", "2606:4700:4700::1111", "2a00:1450:4001::1", "[2606:4700:4700::1111]"])("%s is", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe("checking a URL", () => {
  it.each([
    "http://localhost/", "http://LOCALHOST/", "http://localhost./", "http://app.localhost/", "http://printer.local/", "http://metadata.google.internal/", "http://intranet/", "http://db.corp/", "http://router.lan/",
    "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "http://0.0.0.0/",
    "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:a9fe:a9fe]/", "http://[fd00:ec2::254]/", "http://[fe80::1]/",
    "https://example.com:8443/", "http://example.com:22/", "https://example.com:6379/", "https://user:pw@example.com/", "https://user@example.com/", "https://example.com:443@127.0.0.1/",
  ])("blocks %s", (raw) => {
    expect(() => assertPublicUrl(new URL(raw))).toThrow(BLOCKED);
  });
  it.each(["ftp://example.com/", "file:///etc/passwd"])("blocks %s as not a web link", (raw) => {
    expect(() => assertPublicUrl(new URL(raw))).toThrow(BAD_LINK_MESSAGE);
  });
  it.each(["https://example.com/", "http://example.com/", "http://example.com:80/", "https://example.com:443/", "http://example.com:443/", "https://example.com:80/", "http://8.8.8.8/", "https://[2606:4700:4700::1111]/", "https://localhost.example.com/"])("allows %s", (raw) => {
    expect(() => assertPublicUrl(new URL(raw))).not.toThrow();
  });
});

describe("the lookup the socket uses", () => {
  const answers = (...addresses: string[]) => vi.spyOn(dns, "lookup").mockImplementation(((_host: string, _options: unknown, callback: (e: Error | null, list: dns.LookupAddress[]) => void) => {
    callback(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
  }) as never);
  const look = (options: { all?: boolean } = {}) => new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) => {
    publicOnlyLookup("site.example.com", options, ((error: NodeJS.ErrnoException | null, address: unknown, family?: number) => resolve({ error, address, family })) as never);
  });
  it.each([["127.0.0.1"], ["10.1.2.3"], ["169.254.169.254"], ["::1"], ["::ffff:127.0.0.1"], ["fd00:ec2::254"]])("blocks a name resolving to %s", async (address) => {
    answers(address);
    expect((await look()).error?.code).toBe("EBLOCKEDADDRESS");
  });
  it("blocks when any one address is private, wherever it is in the list", async () => {
    answers("8.8.8.8", "10.0.0.1");
    expect((await look({ all: true })).error?.code).toBe("EBLOCKEDADDRESS");
    answers("10.0.0.1", "8.8.8.8");
    expect((await look()).error?.code).toBe("EBLOCKEDADDRESS");
  });
  it("blocks a name with no addresses", async () => {
    answers();
    expect((await look()).error?.code).toBe("EBLOCKEDADDRESS");
  });
  it("answers both ways a socket can ask", async () => {
    answers("8.8.8.8", "2606:4700:4700::1111");
    expect(await look()).toEqual({ error: null, address: "8.8.8.8", family: 4 });
    expect((await look({ all: true })).address).toEqual([{ address: "8.8.8.8", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }]);
  });
  it("passes on a failed lookup", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, callback: (e: Error) => void) => callback(Object.assign(new Error("nope"), { code: "ENOTFOUND" }))) as never);
    expect((await look()).error?.code).toBe("ENOTFOUND");
  });
  it("really stops a socket reaching a private address, on the connection itself", async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => { hits++; res.end("secret"); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const call = (lookup: typeof publicOnlyLookup | undefined) => new Promise<number | string>((resolve) => {
      const request = http.request({ hostname: lookup ? "rebind.example.com" : "127.0.0.1", port, agent: false, ...(lookup ? { lookup } : {}) }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      request.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "error"));
      request.end();
    });
    try {
      expect(await call(undefined)).toBe(200); // The server is really there.
      hits = 0;
      answers("127.0.0.1");
      expect(await call(publicOnlyLookup)).toBe("EBLOCKEDADDRESS");
      expect(hits).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("fetching", () => {
  const start = new URL("https://site.example.com/quiz");
  it("reads a page", async () => {
    const { transport } = sites({ [start.href]: { body: "<p>Hello</p>" } });
    expect(await fetchPublicText(start, "page", transport)).toMatchObject({ text: "<p>Hello</p>", contentType: "text/html; charset=utf-8" });
  });
  it("never asks for a blocked first address", async () => {
    const { transport, asked } = sites({});
    expect(await message(() => fetchPublicText(new URL("http://169.254.169.254/latest/meta-data/"), "page", transport))).toBe(BLOCKED);
    expect(asked).toEqual([]);
  });
  it.each([
    ["a private IP", "http://10.0.0.5/admin", BLOCKED], ["the metadata service", "http://169.254.169.254/latest/meta-data/", BLOCKED], ["localhost", "http://localhost/", BLOCKED],
    ["IPv6 loopback", "http://[::1]/", BLOCKED], ["a mapped IPv4", "http://[::ffff:127.0.0.1]/", BLOCKED], ["a bad port", "https://other.example.com:8443/", BLOCKED], ["credentials", "https://u:p@other.example.com/", BLOCKED],
    ["ftp", "ftp://other.example.com/", BAD_LINK_MESSAGE], ["a file", "file:///etc/passwd", BAD_LINK_MESSAGE],
  ])("refuses a redirect to %s, without following it", async (_name, location, expected) => {
    const { transport, asked } = sites({ [start.href]: redirect(location) });
    expect(await message(() => fetchPublicText(start, "page", transport))).toBe(expected);
    expect(asked).toEqual([start.href]);
  });
  it("checks every hop, not only the first", async () => {
    const { transport, asked } = sites({
      [start.href]: redirect("https://two.example.com/"), "https://two.example.com/": redirect("/three"), "https://two.example.com/three": redirect("http://192.168.0.1/"),
    });
    expect(await message(() => fetchPublicText(start, "page", transport))).toBe(BLOCKED);
    expect(asked).toHaveLength(3);
  });
  it("follows the allowed number of redirects and no more", async () => {
    const hop = (n: number) => `https://site.example.com/${n}`;
    const chain = (length: number) => {
      const table: Record<string, Page> = {};
      for (let n = 0; n < length; n++) table[hop(n)] = redirect(hop(n + 1));
      table[hop(length)] = { body: "Done" };
      return table;
    };
    expect((await fetchPublicText(new URL(hop(0)), "page", sites(chain(MAX_REDIRECTS)).transport)).text).toBe("Done");
    const tooMany = sites(chain(MAX_REDIRECTS + 1));
    expect(await message(() => fetchPublicText(new URL(hop(0)), "page", tooMany.transport))).toContain("redirects too many times");
    expect(tooMany.asked).toHaveLength(MAX_REDIRECTS + 1);
  });
  it("turns a blocked address found while connecting into the same plain message", async () => {
    const transport: LinkTransport = async () => { throw Object.assign(new Error("Blocked"), { code: "EBLOCKEDADDRESS" }); };
    expect(await message(() => fetchPublicText(start, "page", transport))).toBe(BLOCKED);
  });
  it("hides connection details", async () => {
    const transport: LinkTransport = async () => { throw Object.assign(new Error("connect ECONNREFUSED 10.1.1.1:443"), { code: "ECONNREFUSED" }); };
    expect(await message(() => fetchPublicText(start, "page", transport))).toBe("We couldn't reach this link. Check it and try again.");
  });
  it("gives up at the time limit, whether waiting for a reply or reading one", async () => {
    const silent: LinkTransport = (_url, signal) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason)); });
    expect(await message(() => fetchPublicText(start, "page", silent, 10))).toContain("took too long");
    const stalled: LinkTransport = async (_url, signal) => {
      const body = new PassThrough();
      signal.addEventListener("abort", () => body.destroy(signal.reason));
      return { status: 200, headers: HTML, body };
    };
    expect(await message(() => fetchPublicText(start, "page", stalled, 10))).toContain("took too long");
  });
  it("stops at the size cap, whatever the reply says", async () => {
    const tooBig = { body: Buffer.alloc(MAX_LINK_BYTES + 1, "a") };
    expect(await message(() => fetchPublicText(start, "page", sites({ [start.href]: tooBig }).transport))).toContain("too large");
    const declared = { headers: { ...HTML, "content-length": String(MAX_LINK_BYTES + 1) }, body: "x" };
    expect(await message(() => fetchPublicText(start, "page", sites({ [start.href]: declared }).transport))).toContain("too large");
    const lying = { headers: { ...HTML, "content-length": "5" }, body: Buffer.alloc(MAX_LINK_BYTES + 1, "a") };
    expect(await message(() => fetchPublicText(start, "page", sites({ [start.href]: lying }).transport))).toContain("too large");
    const exact = { body: Buffer.alloc(MAX_LINK_BYTES, "a") };
    expect((await fetchPublicText(start, "page", sites({ [start.href]: exact }).transport)).text).toHaveLength(MAX_LINK_BYTES);
  });
  it("stops a compressed reply that unpacks past the cap", async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(MAX_LINK_BYTES * 4, "a"));
    expect(bomb.length).toBeLessThan(MAX_LINK_BYTES);
    const page = { headers: { ...HTML, "content-encoding": "gzip" }, body: bomb };
    expect(await message(() => fetchPublicText(start, "page", sites({ [start.href]: page }).transport))).toContain("too large");
  });
  it.each([["gzip", zlib.gzipSync], ["br", zlib.brotliCompressSync], ["deflate", zlib.deflateSync]])("reads a %s reply", async (encoding, pack) => {
    const page = { headers: { ...HTML, "content-encoding": encoding as string }, body: (pack as (b: Buffer) => Buffer)(Buffer.from("Hello")) };
    expect((await fetchPublicText(start, "page", sites({ [start.href]: page }).transport)).text).toBe("Hello");
  });
  it("refuses a compression it doesn't know", async () => {
    const page = { headers: { ...HTML, "content-encoding": "zstd" }, body: "x" };
    expect(await message(() => fetchPublicText(start, "page", sites({ [start.href]: page }).transport))).toContain("couldn't reach");
  });
  it.each(["application/pdf", "application/octet-stream", "image/png", "application/json", "video/mp4", ""])("refuses content type %j", async (type) => {
    const page: Page = { headers: type ? { "content-type": type } : {}, body: "x" };
    expect(await message(() => fetchPublicText(start, "page", sites({ [start.href]: page }).transport))).toContain("isn't a web page we can read");
  });
  it.each(["text/plain", "text/html; charset=utf-8", "application/xhtml+xml", "TEXT/HTML"])("reads content type %j", async (type) => {
    const page = { headers: { "content-type": type }, body: "x" };
    expect((await fetchPublicText(start, "page", sites({ [start.href]: page }).transport)).text).toBe("x");
  });
  it("uses the charset the page declares, and survives a made-up one", async () => {
    const latin = { headers: { "content-type": "text/plain; charset=iso-8859-1" }, body: Buffer.from([0x61, 0xf1, 0x6f]) };
    expect((await fetchPublicText(start, "page", sites({ [start.href]: latin }).transport)).text).toBe("año");
    const fake = { headers: { "content-type": "text/plain; charset=nonsense" }, body: "ok" };
    expect((await fetchPublicText(start, "page", sites({ [start.href]: fake }).transport)).text).toBe("ok");
  });
  describe("saying why a link can't be read (UC 4.2 flow C)", () => {
    const FORM = "This form isn't public — share it as 'Anyone with the link'";
    it("a form that redirects to sign-in", async () => {
      const { transport, asked } = sites({ [start.href]: redirect("https://accounts.google.com/v3/signin/identifier?x=1") });
      expect(await message(() => fetchPublicText(start, "form", transport))).toBe(FORM);
      expect(asked).toHaveLength(1);
    });
    it("a document that redirects to sign-in", async () => {
      const { transport } = sites({ [start.href]: redirect("https://accounts.google.com/ServiceLogin") });
      expect(await message(() => fetchPublicText(start, "document", transport))).toBe("This document isn't public — share it as 'Anyone with the link'");
    });
    it("Microsoft sign-in", async () => {
      const { transport } = sites({ [start.href]: redirect("https://login.microsoftonline.com/common/oauth2") });
      expect(await message(() => fetchPublicText(start, "form", transport))).toBe(FORM);
    });
    it.each([401, 403])("a page answering %i", async (status) => {
      const { transport } = sites({ [start.href]: { status } });
      expect(await message(() => fetchPublicText(start, "page", transport))).toBe("This page needs sign-in, so it can't be read.");
      expect(await message(() => fetchPublicText(start, "form", transport))).toBe(FORM);
    });
    it("a page redirecting to a login path", async () => {
      const { transport } = sites({ [start.href]: redirect("https://site.example.com/users/sign_in/../login") });
      expect(await message(() => fetchPublicText(start, "page", transport))).toBe("This page needs sign-in, so it can't be read.");
    });
    it.each([404, 410])("a page answering %i", async (status) => {
      expect(await message(() => fetchPublicText(start, "page", sites({ [start.href]: { status } }).transport))).toContain("couldn't find this page");
    });
    it("a server error, or a redirect with nowhere to go", async () => {
      expect(await message(() => fetchPublicText(start, "page", sites({ [start.href]: { status: 500 } }).transport))).toContain("couldn't reach");
      expect(await message(() => fetchPublicText(start, "page", sites({ [start.href]: { status: 302, headers: { location: "http://[bad" } } }).transport))).toContain("couldn't reach");
    });
  });
});

describe("page text", () => {
  it("keeps what's visible and drops the rest", () => {
    expect(htmlToText(`<html><head><title>T</title><style>p{}</style></head><body><!-- hidden --><script>var a="<p>nope</p>";</script><SCRIPT>x</SCRIPT>
      <h1>Quiz</h1><p>1. Rock &amp; roll&nbsp;now &#65; &#x42;</p><ul><li>One</li><li>Two</li></ul><noscript>no</noscript></body></html>`))
      .toBe("Quiz\n1. Rock & roll now A B\nOne\nTwo");
  });
  it("copes with broken pages", () => {
    expect(htmlToText("Before<script>never closed")).toBe("Before");
    expect(htmlToText("Before<!-- never closed")).toBe("Before");
    expect(htmlToText("Before<p")).toBe("Before");
    expect(htmlToText("İİİ<SCRIPT>x</SCRIPT>After")).toBe("İİİAfter");
  });
  it("doesn't slow down on pages built to break it", () => {
    for (const hostile of ["<script>".repeat(400_000), "<!--".repeat(700_000), "<".repeat(2_800_000), "<a ".repeat(900_000), "&amp".repeat(700_000)]) {
      const started = Date.now();
      htmlToText(hostile);
      expect(Date.now() - started).toBeLessThan(2000);
    }
  });
  const form = (items: unknown) => `<html><script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, ["desc", items]])};</script></html>`;
  it("reads a Google Form's questions, leaving out other kinds", () => {
    const choices = (...names: string[]) => [[111, names.map((name) => [name, null, null, null, false]), 1]];
    expect(googleFormText(form([
      [1, "What moves?", null, 2, choices("Ball", "Bat")], [2, "Your name", null, 0, [[5, null, 1]]], [3, "Pick", null, 3, choices("X", "Y")], [4, "All", null, 4, choices("P", "Q")],
    ]))).toBe("Question: What moves?\n- Ball\n- Bat\nQuestion: Pick\n- X\n- Y\nQuestion: All\n- P\n- Q");
  });
  it("gives up quietly on anything unexpected", () => {
    for (const html of ["<p>no form</p>", "FB_PUBLIC_LOAD_DATA_ = [oops;</script>", "FB_PUBLIC_LOAD_DATA_ = [1];</script>", "FB_PUBLIC_LOAD_DATA_ = [", form([]), form([[1, "Name", null, 0]]), form([5])]) {
      expect(googleFormText(html)).toBeNull();
    }
  });
});

describe("knowing what a link is", () => {
  const describes = (raw: string) => describeQuizLink(new URL(raw));
  it("reads Google Docs through its plain text export", () => {
    expect(describes("https://docs.google.com/document/d/abc_D-1/edit?usp=sharing")).toMatchObject({ site: "Google Docs", kind: "document" });
    expect(describes("https://docs.google.com/document/d/abc_D-1/edit?usp=sharing").fetchUrl.href).toBe("https://docs.google.com/document/d/abc_D-1/export?format=txt");
    expect(describes("https://docs.google.com/document/d/e/2PACX/pub").fetchUrl.href).toBe("https://docs.google.com/document/d/e/2PACX/pub");
  });
  it("opens Google Forms at the page students see", () => {
    expect(describes("https://docs.google.com/forms/d/abc/edit").fetchUrl.href).toBe("https://docs.google.com/forms/d/abc/viewform");
    expect(describes("https://docs.google.com/forms/d/e/1FAI/viewform?usp=sf_link")).toMatchObject({ site: "Google Forms", kind: "form" });
    expect(describes("https://docs.google.com/forms/d/e/1FAI/viewform?usp=sf_link").fetchUrl.href).toBe("https://docs.google.com/forms/d/e/1FAI/viewform?usp=sf_link");
    expect(describes("https://forms.gle/abc")).toMatchObject({ site: "Google Forms", kind: "form" });
  });
  it("names Microsoft Forms and other sites", () => {
    expect(describes("https://forms.office.com/r/abc")).toMatchObject({ site: "Microsoft Forms", kind: "form", microsoft: true });
    expect(describes("https://forms.cloud.microsoft/r/abc").site).toBe("Microsoft Forms");
    expect(describes("https://www.Example.com/q")).toMatchObject({ site: "example.com", kind: "page", microsoft: false });
  });
  it("doesn't take a look-alike for Google", () => {
    expect(describes("https://docs.google.com.evil.example/document/d/abc/edit")).toMatchObject({ site: "docs.google.com.evil.example", kind: "page" });
  });
  it("won't let a Google link's rewrite hide credentials or a port", async () => {
    const { transport, asked } = sites({});
    for (const raw of ["https://u:p@docs.google.com/document/d/abc/edit", "https://docs.google.com:8443/document/d/abc/edit"]) {
      expect(await message(() => readQuizLink(new URL(raw), transport))).toBe(BLOCKED);
    }
    expect(asked).toEqual([]);
  });
  it("reads a Google Doc's text", async () => {
    const doc = "1. What moves?\nA. Ball\nB. Bat";
    const { transport } = sites({ "https://docs.google.com/document/d/abc/export?format=txt": { headers: { "content-type": "text/plain" }, body: doc } });
    expect(await readQuizLink(new URL("https://docs.google.com/document/d/abc/edit"), transport)).toMatchObject({ text: doc, info: { site: "Google Docs" } });
  });
  it("prefers a form's own data over its page text", async () => {
    const html = `<body><p>Visible words on the page</p><script>var FB_PUBLIC_LOAD_DATA_ = [null,["d",[[1,"What moves?",null,2,[[1,[["Ball"],["Bat"]]]]]]]];</script></body>`;
    const { transport } = sites({ "https://forms.gle/abc": redirect("https://docs.google.com/forms/d/e/x/viewform"), "https://docs.google.com/forms/d/e/x/viewform": { body: html } });
    expect((await readQuizLink(new URL("https://forms.gle/abc"), transport)).text).toBe("Question: What moves?\n- Ball\n- Bat");
  });
  it("says when a form is closed", async () => {
    const { transport } = sites({ "https://forms.gle/abc": redirect("https://docs.google.com/forms/d/e/x/closedform"), "https://docs.google.com/forms/d/e/x/closedform": { body: "<p>This form is no longer accepting responses</p>" } });
    expect(await message(() => readQuizLink(new URL("https://forms.gle/abc"), transport))).toContain("isn't taking responses");
  });
  it("says plainly that a Microsoft Forms shell can't be read", async () => {
    const { transport } = sites({ "https://forms.office.com/r/abc": { body: "<html><body><div id='app'>Microsoft Forms</div><script>load()</script></body></html>" } });
    expect(await message(() => readQuizLink(new URL("https://forms.office.com/r/abc"), transport))).toContain("Microsoft Forms doesn't show its questions");
  });
  it("says when a page has nothing on it", async () => {
    const { transport } = sites({ "https://site.example.com/": { body: "<html><body><script>x</script></body></html>" } });
    expect(await message(() => readQuizLink(new URL("https://site.example.com/"), transport))).toBe("No multiple-choice questions found on this page.");
  });
});
