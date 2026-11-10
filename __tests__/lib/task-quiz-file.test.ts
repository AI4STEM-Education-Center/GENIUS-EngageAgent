import JSZip from "jszip";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { docx, docxZip, lieAboutSizes, pdf, pptx, pptxZip } from "@/__tests__/fixtures/quiz-files";
import { cleanQuizFileName, MAX_QUIZ_FILE_BYTES, QuizFileTooLarge, readQuizFile, readQuizUpload, UnsupportedQuizFile } from "@/lib/task-quiz-file";

const textOf = async (bytes: Buffer, name: string) => {
  const { document } = await readQuizFile(bytes, name);
  if (document.type !== "text") throw new Error("Expected text");
  return document.text;
};
const refused = (bytes: Buffer, name: string) => expect(readQuizFile(bytes, name)).rejects.toThrow(UnsupportedQuizFile);
const save = (zip: JSZip) => zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
const QUESTION = "1. What happens to a ball?";

afterEach(() => { vi.restoreAllMocks(); });

describe("reading files", () => {
  it("reads a Word file, one paragraph per line, decoding entities", async () => {
    const text = await textOf(await docx([QUESTION, "A) Rock &amp; roll", "B) 3 &lt; 4 &#65; &#x42;", "Answer: A"]), "Quiz.DOCX");
    expect(text).toBe(`${QUESTION}\nA) Rock & roll\nB) 3 < 4 A B\nAnswer: A`);
  });
  it("marks Word list entries and ignores deleted text", async () => {
    const zip = docxZip([]);
    zip.file("word/document.xml", `<w:p><w:pPr><w:numPr/></w:pPr></w:p><w:p><w:pPr><w:numPr></w:numPr></w:pPr><w:r><w:t>Option one</w:t></w:r></w:p><w:p><w:r><w:delText>gone</w:delText><w:t>${QUESTION}</w:t></w:r></w:p>`);
    expect(await textOf(await save(zip), "q.docx")).toBe(`- Option one\n${QUESTION}`);
  });
  it("reads slides in number order, with each slide's own notes", async () => {
    const slides = Array.from({ length: 11 }, (_, i) => `Slide text ${i + 1}`);
    const text = await textOf(await pptx(slides, { 2: "Answer: B" }), "q.pptx");
    expect(text.indexOf("Slide text 2")).toBeLessThan(text.indexOf("Slide text 10"));
    expect(text).toContain("Speaker notes for slide 2:\nAnswer: B");
  });
  it("hands a PDF on whole", async () => {
    const bytes = pdf();
    expect(await readQuizFile(bytes, "q.pdf")).toEqual({ kind: "pdf", document: { type: "pdf", bytes } });
  });
  it("doesn't expand entities a file defines", async () => {
    const zip = docxZip([]);
    zip.file("word/document.xml", `<!DOCTYPE d [<!ENTITY a "boom">]><w:p><w:r><w:t>Before &a; after, long enough</w:t></w:r></w:p>`);
    expect(await textOf(await save(zip), "q.docx")).toBe("Before &a; after, long enough");
  });
});

describe("checking what a file really is", () => {
  it("refuses a text file renamed .docx, .pptx or .pdf", async () => {
    const bytes = Buffer.from("just some text pretending to be a document");
    for (const name of ["q.docx", "q.pptx", "q.pdf"]) await refused(bytes, name);
  });
  it("refuses other kinds of file, whatever is inside", async () => {
    const real = await docx([QUESTION]);
    for (const name of ["q.txt", "q.doc", "q.zip", "q.docm", "q", "docx", "q.docx.exe"]) await refused(real, name);
  });
  it("refuses real files with the wrong name", async () => {
    await refused(await docx([QUESTION]), "q.pptx");
    await refused(await docx([QUESTION]), "q.pdf");
    await refused(await pptx([QUESTION]), "q.docx");
    await refused(pdf(), "q.docx");
    await refused(pdf(), "q.pptx");
  });
  it("refuses a zip that isn't an Office file", async () => {
    const zip = new JSZip();
    zip.file("notes.txt", QUESTION);
    await refused(await save(zip), "q.docx");
  });
  it("refuses a zip with the right part but the wrong declared type", async () => {
    const zip = docxZip([QUESTION]);
    zip.file("[Content_Types].xml", "<Types></Types>");
    await refused(await save(zip), "q.docx");
  });
  it("refuses a file with macros", async () => {
    const zip = docxZip([QUESTION]);
    zip.file("word/vbaProject.bin", "x");
    await refused(await save(zip), "q.docx");
  });
  it("refuses a broken zip and a file too short to be anything", async () => {
    await refused(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("garbage")]), "q.docx");
    await refused(Buffer.alloc(0), "q.docx");
    await refused(Buffer.from("%PDF"), "q.pdf");
  });
  it("refuses a file with no text to read", async () => {
    await refused(await docx([]), "q.docx");
    await refused(await pptx(["  ", ""]), "q.pptx");
  });
});

describe("zip bombs", () => {
  // Built once: packing 53 MB is the slow part, and it's slower still on a busy machine.
  let bomb: Buffer;
  beforeAll(async () => {
    const zip = docxZip([]);
    zip.file("word/document.xml", "<w:p><w:r><w:t>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</w:t></w:r></w:p>".repeat(1_100_000));
    bomb = await save(zip);
  }, 120_000);
  it("stops unpacking past the limit", async () => {
    expect(bomb.length).toBeLessThan(MAX_QUIZ_FILE_BYTES);
    await refused(bomb, "q.docx");
  }, 30_000);
  it("isn't fooled by a part that lies about its size", async () => {
    await refused(lieAboutSizes(bomb), "q.docx");
  }, 30_000);
  it("counts every slide toward the limit", async () => {
    const zip = pptxZip([]);
    const slide = `<a:p><a:r><a:t>Some text here</a:t></a:r></a:p>${"<x/>".repeat(2_250_000)}`; // About 9 MB each, nearly all markup.
    for (let n = 1; n <= 6; n++) zip.file(`ppt/slides/slide${n}.xml`, slide);
    await refused(await save(zip), "q.pptx");
  }, 120_000);
  it("refuses a file claiming to unpack to far too much, before unpacking anything", async () => {
    const zip = docxZip([QUESTION]);
    const bytes = await save(zip);
    const claims = Buffer.from(bytes);
    for (let at = claims.indexOf("PK\x01\x02", 0, "latin1"); at >= 0; at = claims.indexOf("PK\x01\x02", at + 4, "latin1")) claims.writeUInt32LE(400 * 1024 * 1024, at + 24);
    await refused(claims, "q.docx");
  });
  it("refuses a real file that unpacks to far too much, even in parts it wouldn't read", async () => {
    const zip = docxZip([QUESTION]);
    zip.file("word/media/huge.bin", Buffer.alloc(301 * 1024 * 1024));
    await refused(await save(zip), "q.docx");
  }, 120_000);
  it("refuses too many parts", async () => {
    const zip = docxZip([QUESTION]);
    for (let n = 0; n < 5_001; n++) zip.file(`x/${n}`, "");
    await refused(await save(zip), "q.docx");
  }, 30_000);
});

describe("reading the upload", () => {
  const url = "http://localhost/upload";
  const streamOf = (bytes: number) => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } });
  const upload = (body: BodyInit, headers: Record<string, string> = {}) => new Request(url, { method: "POST", body, headers, duplex: "half" } as RequestInit);
  it("takes exactly 10 MB", async () => {
    expect((await readQuizUpload(upload(streamOf(MAX_QUIZ_FILE_BYTES)))).length).toBe(MAX_QUIZ_FILE_BYTES);
  });
  it("refuses one byte more, even with no Content-Length", async () => {
    await expect(readQuizUpload(upload(streamOf(MAX_QUIZ_FILE_BYTES + 1)))).rejects.toThrow(QuizFileTooLarge);
  });
  it("refuses on a Content-Length that's too big without reading the body", async () => {
    const pull = vi.fn();
    const body = new ReadableStream({ pull });
    await expect(readQuizUpload(upload(body, { "content-length": String(MAX_QUIZ_FILE_BYTES + 1) }))).rejects.toThrow("Files up to 10 MB");
    await expect(readQuizUpload(upload("x", { "content-length": "abc" }))).rejects.toThrow(QuizFileTooLarge);
  });
  it("isn't fooled by a small Content-Length on a big body", async () => {
    await expect(readQuizUpload(upload(streamOf(MAX_QUIZ_FILE_BYTES + 1), { "content-length": "5" }))).rejects.toThrow(QuizFileTooLarge);
  });
});

describe("file names", () => {
  it("keeps a teacher's name as it is", () => {
    expect(cleanQuizFileName(" Collisions warm-up.docx ")).toBe("Collisions warm-up.docx");
    expect(cleanQuizFileName("Fuerzas – año 2.pdf")).toBe("Fuerzas – año 2.pdf");
  });
  it.each([[null], [""], ["  "], ["../secret.docx"], ["a\\b.docx"], ["a\nb.docx"], ["x".repeat(181)]])("refuses %j", (name) => {
    expect(cleanQuizFileName(name)).toBeNull();
  });
});
