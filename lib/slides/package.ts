import JSZip from "jszip";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";

const manifestPath = "[Content_Types].xml";
const masterType = "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml";

export async function normalizePresentationPackage(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(bytes);
  const manifest = await zip.file(manifestPath)?.async("string");
  if (!manifest || XMLValidator.validate(manifest) !== true) throw new Error("Invalid PowerPoint content manifest.");
  const options = { ignoreAttributes: false, isArray: (name: string) => name === "Override" || name === "Default" };
  const document = new XMLParser(options).parse(manifest);
  const overrides = document.Types?.Override;
  if (!Array.isArray(overrides)) throw new Error("Missing PowerPoint content declarations.");
  // PptxGenJS 4.0.1 declares one master per slide but writes only the shared master.
  document.Types.Override = overrides.filter((entry: Record<string, string>) => {
    const part = entry["@_PartName"];
    if (typeof part !== "string" || !part.startsWith("/")) throw new Error("Invalid PowerPoint part name.");
    if (zip.file(part.slice(1))) return true;
    if (/^\/ppt\/slideMasters\/slideMaster\d+\.xml$/u.test(part) && entry["@_ContentType"] === masterType) return false;
    throw new Error(`Missing PowerPoint part: ${part}`);
  });
  zip.file(manifestPath, new XMLBuilder({ ignoreAttributes: false }).build(document));
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}
