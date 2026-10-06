import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { STAGES, STRATEGIES, VISUALS, draftErrors, isSlideAsset, parseDraft, visibleVisualIds } from "@/lib/slides/model";
import { exportErrors, layoutErrors, slideElements, type MeasureText } from "@/lib/slides/layout";
import { slidePrompt, slideCheckPrompt, slideOutputFormat } from "@/lib/slides/prompts";
import { buildPresentation, buildPresentationBytes, downloadPresentation } from "@/lib/slides/export";
import { normalizePresentationPackage } from "@/lib/slides/package";
import { deckFixture, slideFixture } from "../fixtures/slides";
import { textCheckKey, teachingErrors } from "@/lib/slides/quality";
import { getSlideLearningTarget } from "@/lib/slides/learning-target";

const measure: MeasureText = (text, element) => text.length * element.fontSize * .53;
describe("teaching slide contract", () => {
  it.each(STRATEGIES)("binds %s field guidance to its own five stage and image variants", strategy => {
    const schema = slideOutputFormat(strategy).json_schema.schema as { properties: { slides: { items: { anyOf: { properties: { stage: { enum: string[] }; body: { description: string }; task: { description: string } } }[] } }; visuals: { items: { anyOf: { properties: { id: { enum: string[] }; prompt: { description: string } } }[] } } } };
    const stages = schema.properties.slides.items.anyOf;
    expect(stages.map(item => item.properties.stage.enum[0])).toEqual(STAGES[strategy]);
    expect(stages.every(item => item.properties.body.description.includes("maximum 29 words"))).toBe(true);
    expect(stages[4].properties.task.description).toMatch(/write and hand in/);
    expect(stages[4].properties.body.description).toContain("No questions or starters");
    const images = schema.properties.visuals.items.anyOf;
    expect(images.map(item => item.properties.id.enum[0])).toEqual(VISUALS[strategy]);
    if (strategy === "experience bridging") {
      expect(stages[1].properties.task.description).toContain("OWN recalled experience");
      expect(images[0].properties.prompt.description).toContain("ONE frozen moment");
    }
    if (strategy === "cognitive conflict") expect(stages[1].properties.task.description).toContain("WRITE a prediction");
    if (strategy === "analogy") expect(stages[2].properties.task.description).toContain("SAME later outcome");
  });
  it.each(STRATEGIES)("validates, lays out and exports five editable %s slides", async strategy => {
    const deck = deckFixture(strategy);
    expect(parseDraft(deck.draft, strategy)).toEqual(deck.draft);
    expect(layoutErrors(deck, measure)).toEqual([]);
    const bytes = await buildPresentationBytes(deck, measure);
    const zip = await JSZip.loadAsync(bytes);
    const manifest = new XMLParser({ ignoreAttributes: false }).parse(await zip.file("[Content_Types].xml")!.async("string"));
    for (const part of manifest.Types.Override) expect(zip.file(part["@_PartName"].slice(1))).not.toBeNull();
    expect(Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/u.test(path))).toHaveLength(5);
    expect(Object.keys(zip.files).filter(path => /^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(path))).toHaveLength(5);
    for (let i = 1; i <= 5; i++) {
      const xml = await zip.file(`ppt/slides/slide${i}.xml`)!.async("string");
      expect(xml).toContain("<a:t>");
      expect(xml).not.toContain("Allow time for students");
      expect(xml).not.toContain("normAutofit");
      expect(xml).toContain("<a:spcPts");
      const notes = await zip.file(`ppt/notesSlides/notesSlide${i}.xml`)!.async("string");
      expect(notes).toContain("Allow time for students");
      expect(notes).toContain("AI-generated illustrations");
      const rels = await zip.file(`ppt/slides/_rels/slide${i}.xml.rels`)!.async("string");
      expect(rels).not.toContain('TargetMode="External"');
      if (strategy === "cognitive conflict" && i <= 2) expect(xml).not.toContain("<p:pic>");
    }
  });
  it("offers the identical native PPTX bytes through automatic blob download and its data URI fallback", async () => {
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:native-pptx");
    vi.stubGlobal("Image", class {
      src = "";
      naturalWidth = 1;
      naturalHeight = 1;
      async decode() {}
    });
    vi.stubGlobal("FileReader", class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(blob: Blob) {
        void blob.arrayBuffer().then(bytes => {
          this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
          this.onload?.();
        }).catch(() => this.onerror?.());
      }
    });
    vi.stubGlobal("document", { createElement: () => anchor, body: { append: vi.fn() } });
    try {
      const file = await downloadPresentation(deckFixture("analogy"), measure);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      const fallbackBytes = Buffer.from(file.dataUri.split(",")[1], "base64");
      expect(fallbackBytes.equals(Buffer.from(await blob.arrayBuffer()))).toBe(true);
      expect(file.dataUri).toMatch(/^data:application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation;base64,/u);
      const zip = await JSZip.loadAsync(fallbackBytes);
      expect(Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/u.test(path))).toHaveLength(5);
      expect(anchor.href).toBe(file.url);
      expect(anchor.download).toBe(file.fileName);
      expect(anchor.click).toHaveBeenCalledTimes(1);
      expect(anchor.remove).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
  it("does not hide missing slides or unrelated corrupt package declarations", async () => {
    const zip = await JSZip.loadAsync(await buildPresentationBytes(deckFixture("analogy"), measure));
    zip.remove("ppt/slides/slide2.xml");
    await expect(normalizePresentationPackage(await zip.generateAsync({ type: "arraybuffer" })))
      .rejects.toThrow("Missing PowerPoint part: /ppt/slides/slide2.xml");
  });
  it("preserves valid master declarations and is safe to normalize twice", async () => {
    const bytes = await buildPresentationBytes(deckFixture("analogy"), measure);
    const before = await JSZip.loadAsync(bytes);
    const after = await JSZip.loadAsync(await normalizePresentationPackage(bytes));
    expect(Object.keys(after.files)).toEqual(Object.keys(before.files));
    expect(await after.file("[Content_Types].xml")!.async("string")).toEqual(await before.file("[Content_Types].xml")!.async("string"));
    expect(await after.file("[Content_Types].xml")!.async("string")).toContain('/ppt/slideMasters/slideMaster1.xml');
  });
  it("owns reveal timing without leaking future images into earlier slides", () => {
    expect(visibleVisualIds("cognitive conflict", 0)).toEqual([]);
    expect(visibleVisualIds("cognitive conflict", 1)).toEqual([]);
    expect(visibleVisualIds("cognitive conflict", 2)).toEqual(["evidence"]);
    expect(visibleVisualIds("analogy", 0)).toEqual(["analogue", "target"]);
    expect(visibleVisualIds("analogy", 1)).toEqual(["analogue", "target"]);
    expect(visibleVisualIds("analogy", 2)).toEqual(["target", "variation"]);
    expect(visibleVisualIds("analogy", 3)).toEqual(["analogue", "target"]);
    expect(visibleVisualIds("analogy", 4)).toEqual([]);
  });
  it("records an explicit teacher decision in private notes, never on student slides", async () => {
    const deck = deckFixture("analogy");
    const reason = "Inspected contact geometry and accepted this instructional schematic.";
    deck.checks!.images.target.issues = ["Possible ambiguity"];
    deck.teacherDecision = { reason, draftKey: textCheckKey(deck), checks: deck.checks!, assets: deck.assets };
    const pptx = await buildPresentation(deck, measure);
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: "arraybuffer" }) as ArrayBuffer);
    expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).not.toContain(reason);
    expect(await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string")).toContain(reason);
  });
  it("identifies exact fields, invalid order and unknown fields", () => {
    const draft = slideFixture("analogy");
    draft.slides[2].body = "word ".repeat(30);
    draft.slides[0].stage = "mapping";
    expect(draftErrors(draft, "analogy").join("\n")).toContain("Slide 3.body");
    expect(draftErrors(draft, "analogy").join("\n")).toContain("Slide 1.stage");
    expect(draftErrors({ ...draft, script: "bad" }, "analogy").join()).toContain("unexpected field");
    expect(() => parseDraft(null, "analogy")).toThrow();
  });
  it("blocks overflowing text and missing or unsafe images before export", async () => {
    const deck = deckFixture("analogy");
    deck.draft.slides[0].task = "W".repeat(100);
    expect(layoutErrors(deck, measure).join()).toContain("too wide");
    await expect(buildPresentation(deck, measure)).rejects.toThrow();
    const clean = deckFixture("analogy"); clean.assets = {};
    expect(exportErrors(clean, measure)).toHaveLength(3);
    expect(isSlideAsset({ data: "https://example.com/image.jpg", width: 1, height: 1 })).toBe(false);
    expect(isSlideAsset({ data: "data:image/svg+xml;base64,AAAA", width: 1, height: 1 })).toBe(false);
  });
  it("uses fixed image regions with aspect-ratio containment", () => {
    const deck = deckFixture("analogy");
    deck.assets.analogue.width = 1024; deck.assets.analogue.height = 1536;
    const image = slideElements(deck, 0).find(item => item.kind === "image")!;
    expect(image.frame.width / image.frame.height).toBeCloseTo(2 / 3);
    expect(image.frame.left).toBeGreaterThanOrEqual(64);
    expect(image.frame.left + image.frame.width).toBeLessThanOrEqual(616);
    const target = slideElements(deck, 0).find(item => item.id === "image-target")!;
    expect(target.frame.left).toBeGreaterThanOrEqual(664);
  });
  it.each(STRATEGIES)("uses the team method and its required stage count for %s", strategy => {
    const prompt = slidePrompt({ lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Observe deformation" }, strategy);
    if (strategy === "experience bridging") expect(prompt.system).toContain("Return FOUR pages");
    else if (strategy === "cognitive conflict") {
      expect(prompt.system).toContain("exactly FIVE pages: phenomenon, prediction, discrepant, compare, question");
      expect(prompt.system).not.toContain("load_paths_analogy_soc.pptx");
    }
    else {
      expect(prompt.system).toContain("load_paths_analogy_soc.pptx");
      expect(prompt.system).toContain("Five content slides TOTAL");
    }
    expect(prompt.system).toContain("body UNDER 30 words");
    expect(prompt.system).toMatch(/WRITE (?:one question they now want to investigate|and hand in their OWN question)/u);
    expect(prompt.user).not.toContain("correct_answer");
  });
  it.each(STRATEGIES)("provides numbered steps and an editable question card for %s", async strategy => {
    const deck = deckFixture(strategy);
    for (let i = 0; i < 5; i++) expect(slideElements(deck, i)).toContainEqual(expect.objectContaining({ id: "step-number", text: String(i + 1) }));
    expect(slideElements(deck, 4)).toContainEqual(expect.objectContaining({ id: "question-card", kind: "text", text: expect.stringContaining("MY QUESTION") }));
    expect(slideElements(deck, 4)).toContainEqual(expect.objectContaining({ id: "question-starters", text: "Why...?\nWhat changes if...?\nHow could we test...?" }));
    const pptx = await buildPresentation(deck, measure);
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: "arraybuffer" }) as ArrayBuffer);
    expect(await zip.file("ppt/slides/slide5.xml")!.async("string")).toContain("MY QUESTION");
  });
  it("rejects an incompatible legacy stage sequence instead of silently relabeling it", () => {
    const draft = slideFixture("analogy");
    ["target", "analogue", "mapping", "limits", "question"].forEach((stage, i) => { draft.slides[i].stage = stage; });
    expect(draftErrors(draft, "analogy").filter(error => error.includes(".stage"))).toHaveLength(3);
  });
  it.each(STRATEGIES)("renders the learning target at the required %s reveal stage in preview and PPTX", async strategy => {
    const deck = deckFixture(strategy);
    const target = `Today we investigate: ${getSlideLearningTarget(deck.lessonNumber)}`;
    const targetIndex = strategy === "experience bridging" ? 2 : 0;
    expect(slideElements(deck, targetIndex)).toContainEqual(expect.objectContaining({ id: "learning-target", text: target, kind: "text" }));
    expect(slideElements(deck, 1).some(item => item.id === "learning-target")).toBe(false);
    expect(layoutErrors(deck, measure)).toEqual([]);
    const zip = await JSZip.loadAsync(await buildPresentationBytes(deck, measure));
    expect(await zip.file(`ppt/slides/slide${targetIndex + 1}.xml`)!.async("string")).toContain(target);
    if (strategy === "experience bridging") expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).not.toContain(target);
    if (strategy === "cognitive conflict") expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).not.toContain("<p:pic>");
  });
  it("accepts a useful optional boundary or a clear reflection without requiring limits", async () => {
    for (const stage of ["reflect", "limits"]) {
      const deck = deckFixture("analogy");
      deck.draft.slides[3].stage = stage;
      if (stage === "limits") {
        deck.draft.slides[3].title = "What does a counter show?";
        deck.draft.slides[3].body = "Counters help track amounts; each counter is a representation, not a physical piece of energy.";
        deck.draft.slides[3].task = "What can this picture help you track about the launcher?";
      }
      expect(parseDraft(deck.draft, "analogy")).toBe(deck.draft);
      expect(layoutErrors(deck, measure)).toEqual([]);
    }
    const wrongPosition = slideFixture("analogy");
    wrongPosition.slides[2].stage = "limits";
    expect(draftErrors(wrongPosition, "analogy").join()).toContain("Slide 3.stage");
  });
  it("keeps topic orientation neutral when naming a scientific result would answer a prediction", () => {
    expect(getSlideLearningTarget(5)).toBe("Contact forces");
    expect(getSlideLearningTarget(3)).not.toMatch(/temporary|recover/iu);
    for (let lesson = 1; lesson <= 8; lesson++) {
      const deck = { ...deckFixture("cognitive conflict"), lessonNumber: lesson };
      expect(layoutErrors(deck, measure)).toEqual([]);
    }
  });
  it("keeps prose short on all pages because the final starters are app-owned", () => {
    const draft = slideFixture("analogy");
    expect(draftErrors(draft, "analogy")).toEqual([]);
    for (let i = 0; i < 5; i++) {
      draft.slides[i].body = "One sentence. Another sentence. A third sentence.";
      expect(draftErrors(draft, "analogy").join()).toContain(`Slide ${i + 1}.body: use at most two sentences`);
    }
  });
  it.each(STRATEGIES)("preserves learner-owned inquiry when generating and reviewing %s", strategy => {
    const lesson = { lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Observe deformation" };
    for (const prompt of [slidePrompt(lesson, strategy), slideCheckPrompt(lesson, strategy, slideFixture(strategy))]) {
      expect(prompt.system).toContain("NOW want to investigate");
      expect(prompt.system).toContain("not a fully written question to copy");
      expect(prompt.system).toContain("Do not force every learner");
      expect(prompt.system).toContain("briefly recalls the concrete unresolved observation");
    }
    const generated = slidePrompt(lesson, strategy);
    expect(generated.system).toContain(`docs/references/strategy-prompts/${strategy.replaceAll(" ", "-")}${strategy === "analogy" ? "" : "-20261005"}.txt`);
  });
  it("requires the source's explicit prediction/observation comparison without inventing the learner's answer", () => {
    const draft = slideFixture("cognitive conflict");
    expect(teachingErrors(draft)).toEqual([]);
    draft.slides[3].body = "Compare with the picture.";
    expect(teachingErrors(draft)).toContain("Slide 4.body: separate Your prediction: from What we observed in the activity: as two labeled entries.");
    const prompt = slidePrompt({ lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Observe deformation" }, "cognitive conflict");
    expect(prompt.system).toContain("SAME property under the SAME conditions");
    expect(prompt.system).toContain("Never supply the learner's prediction");
  });
  it("keeps method-specific stage checks separate instead of giving every strategy the conflict sequence", () => {
    const lesson = { lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Observe deformation" };
    const analogy = slidePrompt(lesson, "analogy").system;
    const bridging = slidePrompt(lesson, "experience bridging").system;
    expect(analogy).toContain("its action is proposing a correspondence");
    expect(bridging).toContain("NOW NOTICES in their own remembered experience");
    for (const prompt of [analogy, bridging]) expect(prompt).not.toContain("Slide 4.body MUST use the source's two labeled entries");
    expect(slidePrompt(lesson, "cognitive conflict").system).toContain("Slide 4.body MUST use the source's two labeled entries");
  });
  it("keeps finished example questions out of the learner's question card", () => {
    const draft = slideFixture("cognitive conflict");
    draft.slides[4].body = "Why does the ball return to round?";
    expect(teachingErrors(draft).join()).toContain("without supplying questions");
    draft.slides[4].body = "The brief shape change leaves something to investigate in our next lesson.";
    expect(teachingErrors(draft).join()).toContain("leave this empty");
    draft.slides[4].body = "";
    expect(teachingErrors(draft)).toEqual([]);
  });
});
