import { expect, it } from "vitest";
import { parseTextFindings, reviewFields, textReviewFormat } from "@/lib/slides/review";
import { slideFixture } from "../fixtures/slides";
import { STRATEGIES } from "@/lib/slides/model";

it.each(STRATEGIES)("grounds every %s finding in an actual editable field", strategy => {
  const draft = slideFixture(strategy);
  const fields = reviewFields(draft);
  expect(new Set(fields.map(field => field.id)).size).toBe(fields.length);
  expect(fields.some(field => /imageIds|lesson|stage/iu.test(field.id))).toBe(false);
  expect(textReviewFormat(draft).json_schema.strict).toBe(true);
  for (const field of fields) {
    const issue = { field: field.id, quote: field.text.slice(0, 100), problem: "An observable detail is unclear.", correction: "Clarify the observed moment." };
    if (!field.text.trim()) {
      // Optional empty public fields are valid, and cannot ground a quoted defect.
      expect(() => parseTextFindings([issue], draft)).toThrow("not grounded");
      continue;
    }
    expect(parseTextFindings([issue], draft)).toEqual([`${field.label}: An observable detail is unclear. Clarify the observed moment.`]);
    expect(() => parseTextFindings([{ ...issue, quote: "An invented statement absent from every field." }], draft)).toThrow("not grounded");
  }
  expect(parseTextFindings([], draft)).toEqual([]);
  expect(() => parseTextFindings(["Slide 2.imageIds: remove the counterpart"], draft)).toThrow();
  expect(() => parseTextFindings(Array(6).fill({}), draft)).toThrow();
});

it("rejects a reviewer-inserted soft hyphen instead of repairing an ungrounded quote", () => {
  const draft = slideFixture("cognitive conflict");
  draft.slides[0].teacherNotes = ["No diagnostic selections are available: the tentative expectation that compression makes no difference is a provisional curriculum hypothesis, not a diagnosed belief. Greater illustrated maximum height after greater compression could challenge it."];
  const issue = { field: "slide-1-note-1", quote: "Greater illustrated maximum height", problem: "The incomplete model is not specified.", correction: "State the provisional model before its prediction." };
  expect(parseTextFindings([issue], draft)).toEqual(["Slide 1.teacherNotes 1: The incomplete model is not specified. State the provisional model before its prediction."]);
  expect(() => parseTextFindings([{ ...issue, quote: "Greater ill\u00adu" }], draft)).toThrow("not grounded");
  const actualFailedQuote = "No diagnostic selections are available: the tentative expectation that compression makes no difference is a provisional curriculum hypothesis, not a diagnosed belief. Greater ill\u00adu";
  expect(actualFailedQuote.length).toBe(180);
  expect(() => parseTextFindings([{ ...issue, quote: actualFailedQuote }], draft)).toThrow("not grounded");
});

it.each(["cognitive conflict", "experience bridging"] as const)("requests short exact %s quotes while preserving strict grounding and existing hard limits", strategy => {
  type FindingProperties = { quote: { maxLength: number; description: string }; problem: { maxLength: number; description: string }; correction: { maxLength: number; description: string } };
  const properties = (method: typeof strategy | "analogy") => (textReviewFormat(slideFixture(method)).json_schema.schema as { properties: { issues: { items: { properties: FindingProperties } } } }).properties.issues.items.properties;
  const current = properties(strategy);
  expect(current.quote.maxLength).toBe(180);
  expect(current.quote.description).toContain("at most 80 characters");
  expect(current.quote.description).toContain("soft hyphens/invisible characters");
  for (const field of ["problem", "correction"] as const) {
    expect(current[field].maxLength).toBe(240);
    expect(current[field].description).toContain("COMPLETE sentence");
  }
  expect(properties("analogy").quote.description).toBe("Exact contiguous excerpt from this field, copied verbatim. Never quote metadata, another field or invented text.");
});
