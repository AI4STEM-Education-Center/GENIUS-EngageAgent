import { expect, it } from "vitest";
import { applySharingEdits, parseSharingEdits, sharingTextFields } from "@/lib/sharing-privacy";
it("offers editable text without URLs, sequence IDs or generation inputs", () => {
  const value = { title: "Example", draft: { slides: [{ stage: "prediction", title: "Think", teacherNotes: ["Ask Alex."], videoUrl: "https://example.test/private" }] }, generation: { promptHash: "private" } };
  const fields = sharingTextFields(value);
  expect(fields).toEqual({ title: "Example", "draft.slides.0.title": "Think", "draft.slides.0.teacherNotes.0": "Ask Alex." });
  expect(() => parseSharingEdits([{ field: "draft.slides.0.stage", after: "reveal", reason: "Change" }], fields)).toThrow();
});
it("applies reviewed replacements only to unchanged text and preserves the original", () => {
  const original = { title: "Ask Alex", id: "permanent-id" };
  const edits = parseSharingEdits([{ field: "title", before: "forged", after: "Ask a student", reason: "Remove a name" }], sharingTextFields(original));
  expect(edits[0].before).toBe("Ask Alex");
  expect(applySharingEdits(original, [...edits, { field: "id", before: "permanent-id", after: "forged", reason: "Change" }])).toEqual({ title: "Ask a student", id: "permanent-id" });
  expect(original.title).toBe("Ask Alex");
  expect(applySharingEdits({ ...original, title: "My later edit" }, edits).title).toBe("My later edit");
});
