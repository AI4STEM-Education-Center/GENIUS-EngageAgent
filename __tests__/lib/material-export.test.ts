// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStudentMaterialHtml, downloadStudentMaterial } from "@/lib/material-export";
import type { ContentItem } from "@/lib/types";
import { analogyActivity, conflictActivity } from "../fixtures/material-activities";

const image = "data:image/png;base64,aGVsbG8=";
const item: ContentItem = { id: "material", type: "phenomenon", title: "A bounce", body: "Full flattened story must not leak.", strategy: "cognitive conflict", activity: conflictActivity };
const documentFor = (html: string) => new DOMParser().parseFromString(html, "text/html");
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("standalone student material download", () => {
  it("embeds the full activity and image without private image plans or flattened text", () => {
    const html = buildStudentMaterialHtml(item, image);
    const doc = documentFor(html);
    expect(doc.querySelectorAll("[data-stage]")).toHaveLength(5);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(image);
    expect(html).not.toContain(item.body);
    expect(html).not.toContain(conflictActivity.image.scene);
    expect(html).not.toContain(conflictActivity.image.panels![0].description);
    expect(html).not.toContain("https://");
  });

  it("requires a prediction before revealing evidence and carries it into comparison", () => {
    const doc = documentFor(buildStudentMaterialHtml(item, image));
    const script = doc.querySelector("script")!.textContent!;
    new Function("document", script)(doc);
    const sections = Array.from(doc.querySelectorAll<HTMLElement>("[data-stage]"));
    const button = doc.querySelector<HTMLButtonElement>("#continue")!;
    const prediction = doc.querySelector<HTMLTextAreaElement>("#prediction")!;
    expect(sections.map(section => section.hidden)).toEqual([false, true, true, true, true]);
    button.click();
    expect(button.disabled).toBe(true);
    button.click();
    expect(sections[2].hidden).toBe(true);
    prediction.value = "It stays round.";
    prediction.dispatchEvent(new Event("input"));
    expect(button.disabled).toBe(false);
    button.click();
    expect(prediction.readOnly).toBe(true);
    expect(sections[2].hidden).toBe(false);
    button.click();
    expect(doc.querySelector("#recorded-prediction p")?.textContent).toBe("It stays round.");
    button.click();
    expect(button.hidden).toBe(true);
    expect(sections.every(section => !section.hidden)).toBe(true);
  });

  it("keeps analogue and target panels separate until mapping", () => {
    const doc = documentFor(buildStudentMaterialHtml({ ...item, strategy: "analogy", activity: analogyActivity }, image));
    const sections = doc.querySelectorAll<HTMLElement>("[data-stage]");
    expect(sections[0].querySelector("img")?.getAttribute("alt")).toBe(analogyActivity.image.panels![0].alt);
    expect(sections[1].hidden).toBe(true);
    expect(sections[1].querySelector("img")?.getAttribute("alt")).toBe(analogyActivity.image.panels![1].alt);
    expect(sections[1].querySelector("img")?.style.left).toBe("-100%");
    expect(sections[2].querySelector(".panel")).toBeNull();
    expect(sections[2].querySelector("img")).not.toBeNull();
  });

  it("escapes content and rejects external or executable image sources", () => {
    const malicious = `<img src=x onerror="alert(1)"><script>alert(1)</script>`;
    const doc = documentFor(buildStudentMaterialHtml({ ...item, title: malicious, body: malicious, activity: undefined }, image));
    expect(doc.querySelector("h1")?.textContent).toBe(malicious);
    expect(doc.querySelectorAll("script, [onerror]")).toHaveLength(0);
    expect(doc.querySelectorAll("img")).toHaveLength(1);
    expect(() => buildStudentMaterialHtml(item, "https://example.test/image.png")).toThrow(/embedded/);
    expect(() => buildStudentMaterialHtml(item, "data:image/svg+xml;base64,aGVsbG8=")).toThrow(/embedded/);
  });

  it("retains identical HTML bytes for automatic blob download and a persistent data URI fallback", async () => {
    const create = vi.fn().mockReturnValue("blob:material"); const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["hello"], { type: "image/png" }) }));
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    const file = await downloadStudentMaterial(item, "https://example.test/image.png");
    expect(file.url).toBe("blob:material");
    expect(file.fileName).toBe("A-bounce.html");
    const decoded = Buffer.from(file.dataUri.split(",")[1], "base64").toString("utf8");
    expect(decoded).toBe(buildStudentMaterialHtml(item, image));
    const blobText = await new Promise<string>(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(create.mock.calls[0][0]);
    });
    expect(blobText).toBe(decoded);
    expect(clicked[0].href).toBe(file.url);
    expect(clicked[0].download).toBe(file.fileName);
    expect(clicked[0].isConnected).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("still returns the fallback file when a browser blocks the automatic anchor click", async () => {
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: () => "blob:blocked-material" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["hello"], { type: "image/png" }) }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("Automatic download blocked"); });
    const file = await downloadStudentMaterial(item, image);
    expect(file.dataUri).toMatch(/^data:text\/html;charset=utf-8;base64,/);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it.each([true, false])("uploads the same HTML Blob once and downloads one file with storage available=%s", async available => {
    const create = vi.fn().mockReturnValue("blob:material");
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create }));
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["hello"], { type: "image/png" }) })
      .mockResolvedValueOnce({ ok: available, json: async () => ({ url: "https://files.example.test/material.html", fileName: "Material.html" }) });
    vi.stubGlobal("fetch", fetchMock);
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    const file = await downloadStudentMaterial(item, image, undefined, { classId: "ea-class-a", assignmentId: "ea-task-a" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(create.mock.calls[0][0]);
    expect(file.url).toBe("blob:material");
    expect(file.httpUrl).toBe(available ? "https://files.example.test/material.html" : undefined);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].href).toBe(available ? file.httpUrl : file.url);
  });

  it("does not create or click a stale file after its image request is aborted", async () => {
    let finish: (value: unknown) => void = () => {};
    const create = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create }));
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const controller = new AbortController(); const request = downloadStudentMaterial(item, image, controller.signal);
    controller.abort(); finish({ ok: true, blob: async () => new Blob(["hello"], { type: "image/png" }) });
    await expect(request).rejects.toThrow();
    expect(create).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
  });

  it("does not automatically download a late HTTP attachment after the workspace aborts", async () => {
    let finish: (value: unknown) => void = () => {};
    let started: () => void = () => {};
    const uploading = new Promise<void>(resolve => { started = resolve; });
    const create = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["hello"], { type: "image/png" }) })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; started(); })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const controller = new AbortController();
    const pending = downloadStudentMaterial(item, image, controller.signal, { classId: "ea-class-a", assignmentId: "ea-task-a" });
    const failure = expect(pending).rejects.toThrow();
    await uploading; controller.abort();
    finish({ ok: true, json: async () => ({ url: "https://files.example.test/old-material.html", fileName: "Old.html" }) });
    await failure;
    expect(create).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
  });
});
