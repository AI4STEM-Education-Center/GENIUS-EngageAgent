/**
 * Pictures on lesson quiz items (#175). Nothing here touches storage, so the
 * form can share the limits. A picture's type comes from its bytes, never from
 * the file's name or what the browser says it is, so an SVG or a web page
 * renamed to .png is refused.
 */

/** Hosting caps a response at about 4.4 MB (see MAX_MATERIAL_FILE_BYTES), and pictures are served through the app. */
export const MAX_LESSON_IMAGE_BYTES = 4_000_000;
export const LESSON_IMAGE_TOO_LARGE = "That image is too large. The limit is 4 MB.";
export const LESSON_IMAGE_WRONG_TYPE = "Use a PNG, JPEG, or WebP image.";
export const LESSON_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
export const LESSON_IMAGE_PATH = "/api/lessons/images";

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export type LessonImageType = keyof typeof EXTENSIONS;

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/** What the bytes really are, or null if they aren't a picture we accept. */
export function lessonImageType(bytes: Uint8Array): LessonImageType | null {
  if (bytes.length >= 16 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && ascii(bytes, 12, 16) === "IHDR") return "image/png";
  if (bytes.length >= 4 && startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(ascii(bytes, 12, 16))) return "image/webp";
  return null;
}

/** A name the server made: 32 random hex characters and the extension for the type it found. */
export const lessonImageName = (type: LessonImageType, randomHex: string) => `${randomHex}.${EXTENSIONS[type]}`;

/** The type a stored name stands for, or null for anything the server wouldn't have made. */
export function lessonImageNameType(name: string): LessonImageType | null {
  const extension = /^[a-f0-9]{32}\.(png|jpg|webp)$/.exec(name)?.[1];
  if (!extension) return null;
  return (Object.keys(EXTENSIONS) as LessonImageType[]).find((type) => EXTENSIONS[type] === extension) ?? null;
}

export const lessonImageKey = (name: string) => `lesson-images/${name}`;
