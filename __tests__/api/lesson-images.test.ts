import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { isSafeLessonImage } from "@/lib/lessons";
import { lessonImageNameType, lessonImageType, MAX_LESSON_IMAGE_BYTES } from "@/lib/lesson-images";

// The real routes, access check and local storage; only the signed-in user is faked.
const signedIn = vi.hoisted(() => ({ user: null as UserContext | null }));
vi.mock("@/lib/session", async original => ({
  ...await original<typeof import("@/lib/session")>(),
  sessionUser: vi.fn(async () => signedIn.user),
}));

const origin = "https://engageagent.ai4genius.org";
const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Ana", email: null, role: "teacher" };
const student: UserContext = { ...teacher, geniusId: "student-1", userId: "student-1", name: "Sam", role: "student" };

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 30, 0, 0, 0, ...Buffer.from("WEBPVP8 "), 0, 0, 0, 0]);
const SVG = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`);
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

let dir: string;
let upload: typeof import("@/app/api/lessons/images/route");
let image: typeof import("@/app/api/lessons/images/[name]/route");

function formWith(bytes: Uint8Array, name = "picture.png", type = "image/png") {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], name, { type }));
  return form;
}
const post = (body: BodyInit | null, headers: Record<string, string> = {}, url = "/api/lessons/images") =>
  upload.POST(new Request(`${origin}${url}`, { method: "POST", headers: { origin, ...headers }, ...(body ? { body } : {}) }));
const get = (name: string) => image.GET(new Request(`${origin}/api/lessons/images/x`), { params: Promise.resolve({ name }) });
const storedFiles = async () => readdir(path.join(dir, "material-gallery-assets")).catch(() => [] as string[]);

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-lesson-images-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir);
  vi.stubEnv("DYNAMODB_TABLE", "");
  vi.stubEnv("ENGAGE_S3_BUCKET", "");
  vi.stubEnv("ENGAGE_APP_URL", origin);
  vi.resetModules();
  upload = await import("@/app/api/lessons/images/route");
  image = await import("@/app/api/lessons/images/[name]/route");
  signedIn.user = teacher;
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("uploading", () => {
  it.each([["PNG", PNG, "png", "image/png"], ["JPEG", JPEG, "jpg", "image/jpeg"], ["WebP", WEBP, "webp", "image/webp"]] as const)(
    "stores a %s under a server-made name a lesson may use, and serves it back", async (_label, bytes, extension, type) => {
      const response = await post(formWith(bytes, "../../My Holiday <b>.png"));
      expect(response.status).toBe(201);
      const { url } = await response.json();
      expect(url).toMatch(new RegExp(`^/api/lessons/images/[a-f0-9]{32}\\.${extension}$`));
      expect(url).not.toContain("Holiday");
      expect(isSafeLessonImage(url)).toBe(true);

      signedIn.user = student;
      const served = await get(url.split("/").pop());
      expect(served.status).toBe(200);
      expect(served.headers.get("Content-Type")).toBe(type);
      expect(served.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
    },
  );

  it("names the file by its bytes, whatever it claims to be", async () => {
    const { url } = await (await post(formWith(JPEG, "photo.png", "image/png"))).json();
    expect(url).toMatch(/\.jpg$/);
    expect((await get(url.split("/").pop())).headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("gives every upload its own name", async () => {
    const first = await (await post(formWith(PNG))).json(), second = await (await post(formWith(PNG))).json();
    expect(first.url).not.toBe(second.url);
  });

  it.each<[string, () => UserContext | null, number]>([
    ["a student", () => student, 403],
    ["a guest", () => ({ ...teacher, role: "guest" }) as UserContext, 403],
    ["someone signed out", () => null, 401],
  ])("refuses %s", async (_label, who, status) => {
    signedIn.user = who();
    expect((await post(formWith(PNG))).status).toBe(status);
    expect(await storedFiles()).toEqual([]);
  });

  it("refuses another website, even with a teacher signed in", async () => {
    expect((await post(formWith(PNG), { origin: "https://evil.example" })).status).toBe(403);
    expect(await storedFiles()).toEqual([]);
  });

  it("refuses a GENIUS launch token, even with a teacher signed in", async () => {
    expect((await post(formWith(PNG), { authorization: "Bearer anything" })).status).toBe(401);
    expect(await storedFiles()).toEqual([]);
  });

  it("refuses repeated query parameters", async () => {
    expect((await post(formWith(PNG), {}, "/api/lessons/images?a=1&a=2")).status).toBe(400);
  });

  it.each([
    ["an SVG", SVG, "drawing.svg", "image/svg+xml"],
    ["an SVG with a .png name", SVG, "drawing.png", "image/png"],
    ["a web page with a .png name", HTML, "page.png", "image/png"],
    ["only part of a PNG", PNG.subarray(0, 8), "cut.png", "image/png"],
    ["bytes with IHDR but no PNG signature", new Uint8Array([...new Array(12).fill(0), ...Buffer.from("IHDR"), 0, 0, 0, 0]), "fake.png", "image/png"],
    ["a PNG signature with no IHDR", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...Buffer.from("JUNK"), 0, 0]), "fake.png", "image/png"],
    ["a RIFF file with picture-like data that isn't WebP", new Uint8Array([...Buffer.from("RIFF"), 30, 0, 0, 0, ...Buffer.from("AVI VP8 "), 0, 0, 0, 0]), "fake.webp", "image/webp"],
    ["a RIFF file that isn't WebP", new Uint8Array([...Buffer.from("RIFF"), 30, 0, 0, 0, ...Buffer.from("WAVEfmt "), 0, 0]), "sound.webp", "image/webp"],
    ["a WebP header with no picture data", new Uint8Array([...Buffer.from("RIFF"), 30, 0, 0, 0, ...Buffer.from("WEBPJUNK"), 0, 0]), "odd.webp", "image/webp"],
  ])("refuses %s, by its bytes", async (_label, bytes, name, type) => {
    const response = await post(formWith(bytes, name, type));
    expect(response.status).toBe(415);
    expect((await response.json()).error).toBe("Use a PNG, JPEG, or WebP image.");
    expect(await storedFiles()).toEqual([]);
  });

  it("refuses an image over the limit with a clear message", async () => {
    const big = new Uint8Array(MAX_LESSON_IMAGE_BYTES + 1);
    big.set(PNG);
    const response = await post(formWith(big));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe("That image is too large. The limit is 4 MB.");
    expect(await storedFiles()).toEqual([]);
  });

  it("accepts an image right at the limit", async () => {
    const full = new Uint8Array(MAX_LESSON_IMAGE_BYTES);
    full.set(PNG);
    expect((await post(formWith(full))).status).toBe(201);
  });

  it("stops at the declared size without reading the body", async () => {
    const response = await post(formWith(PNG), { "content-length": String(MAX_LESSON_IMAGE_BYTES * 2) });
    expect(response.status).toBe(413);
  });

  it("stops reading a body that turns out larger than it declared", async () => {
    let sent = 0;
    const chunk = new Uint8Array(1_000_000);
    const stream = new ReadableStream({ pull(controller) { sent++; controller.enqueue(chunk); } });
    const response = await upload.POST(new Request(`${origin}/api/lessons/images`, {
      method: "POST", headers: { origin, "content-type": "multipart/form-data; boundary=x" }, body: stream, duplex: "half",
    } as RequestInit));
    expect(response.status).toBe(413);
    expect(sent).toBeLessThan(10);
  });

  it("refuses requests that aren't file uploads", async () => {
    expect((await post(PNG as BodyInit, { "content-type": "image/png" })).status).toBe(415);
    expect((await post(JSON.stringify({ url: "https://evil.example/x.png" }), { "content-type": "application/json" })).status).toBe(415);
    expect((await post("not a form", { "content-type": "multipart/form-data; boundary=x" })).status).toBe(400);
    const noFile = new FormData();
    noFile.set("other", "text");
    expect((await post(noFile)).status).toBe(400);
    const textField = new FormData();
    textField.set("file", "just text");
    expect((await post(textField)).status).toBe(400);
    expect((await post(formWith(new Uint8Array(0)))).status).toBe(400);
  });

  it("says storage failed without giving details", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/lib/material-gallery-storage", () => ({ storeGalleryBlob: vi.fn(async () => { throw new Error("secret bucket name"); }) }));
    const broken = await import("@/app/api/lessons/images/route");
    const response = await broken.POST(new Request(`${origin}/api/lessons/images`, { method: "POST", headers: { origin }, body: formWith(PNG) }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
    vi.doUnmock("@/lib/material-gallery-storage");
    logged.mockRestore();
  });
});

describe("serving", () => {
  it("works for students and for an <img> with no sign-in, and can be cached", async () => {
    const { url } = await (await post(formWith(PNG))).json();
    for (const who of [student, null]) {
      signedIn.user = who;
      const served = await get(url.split("/").pop());
      expect(served.status).toBe(200);
      expect(served.headers.get("Cache-Control")).toContain("immutable");
    }
  });

  it.each([
    "../../../etc/passwd", "..%2f..%2fetc%2fpasswd", "..", ".", "", "x.png", "a.svg", "lesson1.png",
    "abcdef0123456789abcdef0123456789.svg", "abcdef0123456789abcdef0123456789.html", "abcdef0123456789abcdef0123456789",
    "ABCDEF0123456789ABCDEF0123456789.png", "abcdef0123456789abcdef0123456789.png/../x", "abcdef0123456789abcdef0123456789.png\n",
    "abcdef0123456789abcdef0123456789.png.exe", "abcdef0123456789abcdef012345678.png", "abcdef0123456789abcdef01234567890.png",
  ])("refuses %j and doesn't ask storage for it", async (name) => {
    const response = await get(name);
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("says not found for a good name nothing was stored under", async () => {
    const response = await get("abcdef0123456789abcdef0123456789.png");
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("won't serve stored bytes that don't match the name", async () => {
    const storage = await import("@/lib/material-gallery-storage");
    const name = "abcdef0123456789abcdef0123456789.png";
    await storage.storeGalleryBlob(`lesson-images/${name}`, Buffer.from(HTML), "image/png");
    expect((await get(name)).status).toBe(404);
  });

  it("says unavailable, with no details, when storage fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/lib/material-gallery-storage", () => ({ readGalleryBlob: vi.fn(async () => { throw new Error("secret bucket name"); }) }));
    const broken = await import("@/app/api/lessons/images/[name]/route");
    const response = await broken.GET(new Request(`${origin}/x`), { params: Promise.resolve({ name: "abcdef0123456789abcdef0123456789.png" }) });
    expect(response.status).toBe(503);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(JSON.stringify(await response.json())).not.toContain("secret");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
    vi.doUnmock("@/lib/material-gallery-storage");
    logged.mockRestore();
  });
});

describe("telling pictures apart", () => {
  it("knows the three types and nothing else", () => {
    expect(lessonImageType(PNG)).toBe("image/png");
    expect(lessonImageType(JPEG)).toBe("image/jpeg");
    expect(lessonImageType(WEBP)).toBe("image/webp");
    expect(lessonImageType(SVG)).toBeNull();
    expect(lessonImageType(new Uint8Array(0))).toBeNull();
  });
  it("reads a stored name back to its type", () => {
    const hex = "abcdef0123456789abcdef0123456789";
    expect(lessonImageNameType(`${hex}.png`)).toBe("image/png");
    expect(lessonImageNameType(`${hex}.jpg`)).toBe("image/jpeg");
    expect(lessonImageNameType(`${hex}.webp`)).toBe("image/webp");
    expect(lessonImageNameType(`${hex}.gif`)).toBeNull();
  });
});
