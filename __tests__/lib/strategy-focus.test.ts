import { describe, expect, it } from "vitest";

import { getLesson } from "@/lib/quiz-data";
import {
  defaultStrategyFocus,
  EMPTY_FOCUS,
  FocusError,
  focusForStrategy,
  focusKind,
  focusPromptLine,
  lessonCoreIdeas,
  lessonFocusMisconceptions,
  resolveStrategyFocus,
} from "@/lib/strategy-focus";

const lesson8 = getLesson(8)!;
const statement = (code: string) => lesson8.misconceptions[code];
const counts = (byCode: Record<string, number>) => ({
  misconceptions: lessonFocusMisconceptions(8).map(m => ({ id: m.code, statement: m.statement, count: byCode[m.code] ?? 0 })),
});

describe("focusKind", () => {
  it("uses misconceptions for conflict and critiquing, core ideas for analogy and bridging", () => {
    expect(focusKind("cognitive conflict")).toBe("misconceptions");
    expect(focusKind("engaged critiquing")).toBe("misconceptions");
    expect(focusKind("analogy")).toBe("coreIdeas");
    expect(focusKind("experience bridging")).toBe("coreIdeas");
    expect(focusKind("retired strategy")).toBeNull();
  });
});

describe("lesson focus options", () => {
  it("lists the lesson's misconceptions in order with their MC ids", () => {
    expect(lessonFocusMisconceptions(8).slice(0, 2)).toEqual([
      { code: "1&2-a", id: "MC26", statement: statement("1&2-a") },
      { code: "1&2-b", id: "MC27", statement: statement("1&2-b") },
    ]);
  });

  it("leaves out misconceptions the recommendation rule merges into another", () => {
    const codes = lessonFocusMisconceptions(5).map(m => m.code);
    expect(codes).toContain("1-a");
    expect(codes).not.toContain("2-a");
  });

  it("returns nothing for an unknown lesson", () => {
    expect(lessonFocusMisconceptions(999)).toEqual([]);
    expect(lessonCoreIdeas(999)).toEqual([]);
  });
});

describe("defaultStrategyFocus", () => {
  it("starts with the most common misconceptions, at most two, and the first core idea", () => {
    expect(defaultStrategyFocus(8, counts({ "3-a": 4, "4-a": 4, "4-b": 4, "1&2-a": 1 }))).toEqual({ misconceptions: ["3-a", "4-a"], coreIdeas: [0] });
    expect(defaultStrategyFocus(8, counts({ "4-b": 2, "3-a": 1 })).misconceptions).toEqual(["4-b"]);
  });

  it("falls back to the lesson's first misconception without answers or wrong answers", () => {
    expect(defaultStrategyFocus(8)).toEqual({ misconceptions: ["1&2-a"], coreIdeas: [0] });
    expect(defaultStrategyFocus(8, counts({})).misconceptions).toEqual(["1&2-a"]);
  });
});

describe("focusForStrategy", () => {
  const focus = { misconceptions: ["3-a"], coreIdeas: [1] };
  it("sends only the kind the strategy uses", () => {
    expect(focusForStrategy(focus, "cognitive conflict")).toEqual({ misconceptions: ["3-a"] });
    expect(focusForStrategy(focus, "analogy")).toEqual({ coreIdeas: [1] });
  });
  it("sends nothing for an empty focus or an unknown strategy", () => {
    expect(focusForStrategy(EMPTY_FOCUS, "analogy")).toBeUndefined();
    expect(focusForStrategy(focus, "retired strategy")).toBeUndefined();
  });
});

describe("resolveStrategyFocus", () => {
  it("returns null when no focus is sent", () => {
    expect(resolveStrategyFocus(8, "analogy", undefined)).toBeNull();
    expect(resolveStrategyFocus(8, "analogy", null)).toBeNull();
  });

  it("rejects focus that does not match the selected strategy", () => {
    expect(() => resolveStrategyFocus(8, "analogy", { misconceptions: ["3-a"] })).toThrow(FocusError);
  });

  it("turns codes and indexes into the lesson's own wording", () => {
    expect(resolveStrategyFocus(8, "engaged critiquing", { misconceptions: ["4-a", "3-b"] }))
      .toEqual({ kind: "misconceptions", items: [statement("4-a"), statement("3-b")] });
    expect(resolveStrategyFocus(8, "experience bridging", { coreIdeas: [3] }))
      .toEqual({ kind: "coreIdeas", items: [lesson8.core_ideas[3]] });
  });

  it.each([
    ["an empty list", { misconceptions: [] }],
    ["three items", { misconceptions: ["1&2-a", "3-a", "4-a"] }],
    ["a duplicate", { misconceptions: ["3-a", "3-a"] }],
    ["a list that is not an array", { misconceptions: "3-a" }],
  ])("rejects %s", (_, value) => {
    expect(() => resolveStrategyFocus(8, "cognitive conflict", value)).toThrow("Choose one or two misconceptions for the focus.");
  });

  it("rejects misconceptions the lesson does not count", () => {
    expect(() => resolveStrategyFocus(8, "cognitive conflict", { misconceptions: ["9-z"] })).toThrow("Unknown misconception");
    expect(() => resolveStrategyFocus(8, "cognitive conflict", { misconceptions: [3] })).toThrow("Unknown misconception");
    expect(() => resolveStrategyFocus(5, "cognitive conflict", { misconceptions: ["2-a"] })).toThrow("Unknown misconception");
  });

  it("rejects core ideas outside the lesson's list", () => {
    for (const index of [-1, lesson8.core_ideas.length, 1.5, "0"]) {
      expect(() => resolveStrategyFocus(8, "analogy", { coreIdeas: [index] })).toThrow("Unknown core idea");
    }
    expect(() => resolveStrategyFocus(8, "analogy", { coreIdeas: [0, 1, 2] })).toThrow("Choose one or two core ideas");
  });

  it("rejects a focus with the wrong shape or for a strategy without one", () => {
    expect(() => resolveStrategyFocus(8, "analogy", [0])).toThrow(FocusError);
    expect(() => resolveStrategyFocus(8, "analogy", "0")).toThrow(FocusError);
    expect(() => resolveStrategyFocus(8, "retired strategy", { coreIdeas: [0] })).toThrow(FocusError);
  });
});

describe("focusPromptLine", () => {
  it("quotes the items as data", () => {
    const misconceptions = focusPromptLine({ kind: "misconceptions", items: ["A", "B"] });
    expect(misconceptions).toContain("these possible thinking patterns");
    expect(misconceptions).toContain('["A","B"]');
    const idea = focusPromptLine({ kind: "coreIdeas", items: ['Say "hi"'] });
    expect(idea).toContain("this core idea");
    expect(idea).toContain(JSON.stringify(['Say "hi"']));
  });
});
