import JSZip from "jszip";

const WORD_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const POWERPOINT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const types = (type: string) => `<?xml version="1.0"?><Types><Override PartName="/main" ContentType="${type}"/></Types>`;

const save = (zip: JSZip) => zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

export function docxZip(paragraphs: string[]) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", types(WORD_TYPE));
  zip.file("word/document.xml", `<w:document><w:body>${paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip;
}
export const docx = (paragraphs: string[]) => save(docxZip(paragraphs));

export function pptxZip(slides: string[], notes: Record<number, string> = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", types(POWERPOINT_TYPE));
  zip.file("ppt/presentation.xml", "<p:presentation/>");
  slides.forEach((text, index) => {
    const number = index + 1;
    zip.file(`ppt/slides/slide${number}.xml`, `<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`);
    if (notes[number]) {
      // The notes file's own number differs from the slide's, as it can in real decks.
      zip.file(`ppt/slides/_rels/slide${number}.xml.rels`, `<Relationships><Relationship Target="../notesSlides/notesSlide${number + 40}.xml"/></Relationships>`);
      zip.file(`ppt/notesSlides/notesSlide${number + 40}.xml`, `<p:notes><a:p><a:r><a:t>${notes[number]}</a:t></a:r></a:p></p:notes>`);
    }
  });
  return zip;
}
export const pptx = (slides: string[], notes?: Record<number, string>) => save(pptxZip(slides, notes));

export const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");

/** Claims a much smaller unpacked size for every part in the zip's directory, as a crafted file could. */
export function lieAboutSizes(zipBytes: Buffer) {
  const bytes = Buffer.from(zipBytes);
  for (let at = bytes.indexOf("PK\x01\x02", 0, "latin1"); at >= 0; at = bytes.indexOf("PK\x01\x02", at + 4, "latin1")) bytes.writeUInt32LE(100, at + 24);
  return bytes;
}
