export type SharingEdit = { field: string; before: string; after: string; reason: string };
const textKeys = new Set(["title", "body", "text", "task", "teacherNotes", "description", "caption", "alt", "prompt", "visualBrief", "experienceContext", "teachingContext", "classProfile", "target", "analogue", "relationship", "targetPart", "analoguePart", "observedOutcome"]);

/** Only editable text is offered for review. IDs, URLs and sequence stay intact. */
export function sharingTextFields(value: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  function visit(v: unknown, path: string, key: string) {
    if (typeof v === "string") { if (textKeys.has(key) && v.trim()) fields[path] = v; return; }
    if (Array.isArray(v)) v.forEach((item, i) => visit(item, `${path}.${i}`, key));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, item]) => visit(item, path ? `${path}.${k}` : k, k));
  }
  visit(value, "", ""); return fields;
}
export function parseSharingEdits(value: unknown, fields: Record<string, string>): SharingEdit[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("The cleanup suggestions could not be read. Try again.");
  const seen = new Set<string>();
  return value.map(edit => {
    if (!edit || typeof edit.field !== "string" || !Object.hasOwn(fields, edit.field) || seen.has(edit.field)
      || typeof edit.after !== "string" || !edit.after.trim() || edit.after.length > 4000
      || typeof edit.reason !== "string" || !edit.reason.trim() || edit.reason.length > 240) throw new Error("The cleanup suggestions did not match this text. Try again.");
    seen.add(edit.field);
    return { field: edit.field, before: fields[edit.field], after: edit.after, reason: edit.reason };
  }).filter(edit => edit.after !== edit.before);
}
export function applySharingEdits<T>(value: T, edits: SharingEdit[]): T {
  const allowed = sharingTextFields(value);
  const replacements = new Map(edits.filter(e => Object.hasOwn(allowed, e.field)).map(e => [e.field, e]));
  function visit(v: unknown, path: string): unknown {
    if (typeof v === "string") { const edit = replacements.get(path); return edit?.before === v ? edit.after : v; }
    if (Array.isArray(v)) return v.map((item, i) => visit(item, `${path}.${i}`));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([key, item]) => [key, visit(item, path ? `${path}.${key}` : key)]));
    return v;
  }
  return visit(value, "") as T;
}
