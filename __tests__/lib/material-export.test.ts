// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildStudentMaterialHtml } from "@/lib/material-export";
import type { ContentItem } from "@/lib/types";
import { analogyActivity, conflictActivity } from "../fixtures/material-activities";

const image = "data:image/png;base64,aGVsbG8=";
const item: ContentItem = { id: "material", type: "phenomenon", title: "A bounce", body: "Full flattened story must not leak.", strategy: "cognitive conflict", activity: conflictActivity };
const documentFor = (html: string) => new DOMParser().parseFromString(html, "text/html");

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
});
