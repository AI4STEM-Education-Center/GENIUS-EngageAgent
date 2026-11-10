import { describe, expect, it } from "vitest";
import { draftFromLesson, emptyDraftQuizItem, type LessonDraftContent } from "@/lib/lessons";
import { MisconceptionId } from "@/lib/misconceptions";
import { getAllLessons } from "@/lib/quiz-data";
import {
  applyItemChange, applyMatchResults, assertReplaceAllowed, canConfirmItem, confirmationBanner, confirmProblems, createdMessage, emptyTaskQuiz, fileImportMessage,
  importedItem, itemsFromLesson, itemsNeedingMatch, lessonFromTaskQuiz, linkImportMessage, notMatchedYet, parseItemChange, publishBarCount, publishedBarLines, publishedMessage,
  publishProblems, quizCounts, quizItemsFromTaskQuiz, quizTabStatus, replacePrompt, ReplaceConfirmationError, reviewedCount, stepOneStatus, studentQuizHeading, studentQuizItems,
  suggestOnOption, taskMisconceptions, taskQuizView, TaskQuizRuleError, unmatchedBanner, wrongOptions,
  type ItemChange, type OptionMatch, type TaskQuiz, type TaskQuizItem,
} from "@/lib/task-quiz";

const MC1 = MisconceptionId.NoVisibleDamageMeansWeakForce;
const MC2 = MisconceptionId.HeavierAlwaysCausesMoreDamage;
const MC3 = MisconceptionId.ForceNeededForConstantSpeed;
const matched = (ids: MisconceptionId[] = [MC1], setBy: OptionMatch["setBy"] = "teacher"): OptionMatch => ({ state: "matched", ids, setBy, confidence: null, reason: null });
const none = (setBy: OptionMatch["setBy"] = "teacher"): OptionMatch => ({ state: "no_misconception", ids: [], setBy, confidence: null, reason: null });

/** An item ready to confirm: answer A, wrong options matched. */
function ready(id = "q1"): TaskQuizItem {
  const item = importedItem(id, `${id}?`, ["a", "b", "c", "d"], "A");
  item.options[1].match = matched();
  item.options[2].match = none();
  item.options[3].match = matched([MC1, MC2]);
  return item;
}
const lesson = { number: 1, version: 2, title: "L", objective: "o", topic: "t", targetConcept: "c", coreIdeas: ["i1", "i2"], misconceptions: [MC1, MC2] };
const quizOf = (...items: TaskQuizItem[]): TaskQuiz => ({ ...emptyTaskQuiz("c", "a"), lesson, source: "uploaded", items });
const change = (quiz: TaskQuiz, itemChange: ItemChange, id = quiz.items[0].id) => applyItemChange(quiz, id, itemChange);
const refusal = (run: () => unknown) => {
  try { run(); } catch (error) { if (error instanceof TaskQuizRuleError) return error; throw error; }
  throw new Error("Expected a refusal");
};

describe("confirm rules", () => {
  it("accepts an item with an answer, four options and every wrong option matched", () => {
    expect(confirmProblems(ready())).toEqual([]);
    expect(canConfirmItem(ready())).toBe(true);
  });
  it("needs an answer key", () => {
    const item = { ...ready(), answer: null };
    expect(confirmProblems(item)).toContain("Set the correct answer");
  });
  it("won't take an answer that isn't one of the options", () => {
    expect(confirmProblems({ ...ready(), answer: "E" })).toContain("Set the correct answer");
  });
  it.each([[3, ["a", "b", "c"]], [5, ["a", "b", "c", "d", "e"]]])("needs exactly four options, not %i", (_count, options) => {
    const item = importedItem("q", "q?", options as string[], "A");
    for (const option of item.options.slice(1)) option.match = none();
    expect(confirmProblems(item)).toEqual(["This item needs exactly four options, A to D"]);
  });
  it("doesn't count a blank option as an option", () => {
    const item = ready();
    item.options[3] = { ...item.options[3], text: "  " };
    expect(confirmProblems(item)).toContain("This item needs exactly four options, A to D");
  });
  it("needs the options lettered A to D", () => {
    const item = ready();
    item.options[3] = { ...item.options[3], letter: "E" };
    expect(confirmProblems(item)).toContain("This item needs exactly four options, A to D");
  });
  it("needs every wrong option matched, but not the correct one", () => {
    const item = ready();
    expect(item.options[0].match.state).toBe("not_matched");
    expect(canConfirmItem(item)).toBe(true);
    item.options[1].match = notMatchedYet();
    expect(confirmProblems(item)).toEqual(['Match every wrong option to a misconception or "No misconception"']);
  });
  it("counts \"matched\" with no IDs as not matched", () => {
    const item = ready();
    item.options[1].match = { ...matched(), ids: [] };
    expect(canConfirmItem(item)).toBe(false);
  });
  it("accepts \"No misconception\" as a match", () => {
    const item = ready();
    for (const option of item.options.slice(1)) option.match = none("ai");
    expect(canConfirmItem(item)).toBe(true);
  });
  it("lists everything wrong at once", () => {
    expect(confirmProblems(importedItem("q", "q?", ["a", "b"], null))).toHaveLength(3);
  });
});

describe("counts and labels", () => {
  const confirmed = (id: string) => ({ ...ready(id), confirmed: true });
  it("says Ready only when every item is confirmed", () => {
    expect(quizTabStatus(emptyTaskQuiz("c", "a"))).toBeNull();
    expect(quizTabStatus(quizOf(ready()))).toBe("Needs review");
    expect(quizTabStatus(quizOf(confirmed("a"), ready("b")))).toBe("Needs review");
    expect(quizTabStatus(quizOf(confirmed("a"), confirmed("b")))).toBe("Ready");
  });
  it("doesn't trust a confirmed flag on an item that breaks the rules", () => {
    const quiz = quizOf({ ...ready(), confirmed: true, answer: null });
    expect(quizTabStatus(quiz)).toBe("Needs review");
    expect(publishProblems(quiz).length).toBeGreaterThan(0);
  });
  it("shows Step 1's status", () => {
    expect(stepOneStatus(emptyTaskQuiz("c", "a"))).toBe("Not started");
    expect(stepOneStatus(quizOf(ready()))).toBe("In progress");
    expect(stepOneStatus(quizOf(confirmed("a")))).toBe("Ready to publish");
    expect(stepOneStatus({ ...quizOf(confirmed("a")), status: "published" })).toBe("Published");
    expect(stepOneStatus({ ...quizOf(confirmed("a")), lesson: null })).toBe("Not started");
  });
  it("uses the task's wording for the banners and bar", () => {
    const five = quizOf(confirmed("a"), confirmed("b"), confirmed("c"), ready("d"), ready("e"));
    expect(confirmationBanner(five)).toBe("2 of 5 items need confirmation");
    expect(publishBarCount(five)).toBe("Quiz · 3 of 5 confirmed");
    const all = quizOf(confirmed("a"), confirmed("b"), confirmed("c"), confirmed("d"), confirmed("e"));
    expect(confirmationBanner(all)).toBeNull();
    expect(publishBarCount(all)).toBe("Quiz · 5 items confirmed");
    expect(publishBarCount(quizOf(confirmed("a")))).toBe("Quiz · 1 item confirmed");
    expect(publishBarCount(emptyTaskQuiz("c", "a"))).toBe("Quiz · no items yet");
  });
  it("shows the not-matched banner only while a wrong option is unmatched", () => {
    expect(unmatchedBanner(quizOf(ready()))).toBeNull();
    const item = ready();
    item.options[1].match = notMatchedYet();
    expect(unmatchedBanner(quizOf(item))).toBe("Misconceptions not matched yet");
  });
  it("doesn't count the option AI thinks is correct as unmatched", () => {
    const item = importedItem("q", "q?", ["a", "b", "c", "d"], null);
    expect(quizCounts(quizOf(item)).notMatched).toBe(4);
    item.answerSuggestion = { letter: "C", confidence: "High", reason: "r" };
    for (const option of wrongOptions(item)) option.match = none("ai");
    expect(quizCounts(quizOf(item)).notMatched).toBe(0);
    expect(quizCounts(quizOf(item)).noAnswerKey).toBe(1);
  });
  it("writes the toast messages with the right plurals", () => {
    const two = [ready("a"), { ...ready("b"), answer: null }];
    expect(fileImportMessage(two, "Collisions warm-up.docx")).toBe("2 items read from Collisions warm-up.docx — 1 has no answer key");
    expect(fileImportMessage([ready()], "x.pdf")).toBe("1 item read from x.pdf");
    expect(linkImportMessage([{ ...ready("a"), answer: null }, { ...ready("b"), answer: null }, ready("c")], "Google Forms")).toBe("3 items imported from Google Forms — 2 have no answer key");
    expect(createdMessage([ready("a"), ready("b"), ready("c")])).toBe("3 items created with suggested misconception matches");
    expect(replacePrompt(3)).toBe("Replace the 3 items you've reviewed?");
    expect(replacePrompt(1)).toBe("Replace the 1 item you've reviewed?");
    expect(publishedMessage(25)).toBe("Task published to 25 students");
    expect(publishedMessage(1)).toBe("Task published to 1 student");
    expect(publishedMessage(null)).toBe("Task published");
  });
  it("words the bar after publishing", () => {
    expect(publishedBarLines({ className: "Period 3", classSize: 25, submitted: 0 })).toEqual({ published: "Quiz published to Period 3.", progress: "Waiting for students — 0 of 25 submitted.", canGoToStep2: false });
    expect(publishedBarLines({ className: "Period 3", classSize: 25, submitted: 4 })).toEqual({ published: "Quiz published to Period 3.", progress: "4 of 25 students submitted.", canGoToStep2: true });
    expect(publishedBarLines({ className: null, classSize: null, submitted: 0 }).progress).toBe("Waiting for students — 0 submitted.");
    expect(publishedBarLines({ className: null, classSize: null, submitted: 1 })).toEqual({ published: "Quiz published.", progress: "1 student submitted.", canGoToStep2: true });
  });
});

describe("publish rules", () => {
  it("needs a lesson, at least one item, and every item confirmed", () => {
    expect(publishProblems(emptyTaskQuiz("c", "a"))).toEqual(["Pick a lesson first."]);
    expect(publishProblems(quizOf())).toEqual(["Add at least one quiz item."]);
    expect(publishProblems(quizOf(ready()))).toEqual(["1 of 1 items need confirmation"]);
    expect(publishProblems(quizOf({ ...ready(), confirmed: true }))).toEqual([]);
  });
});

describe("replacing reviewed items", () => {
  const reviewed = { ...quizOf({ ...ready(), reviewed: true }, { ...ready("q2"), reviewed: true }, ready("q3")) };
  it("asks with the count when switching source", () => {
    expect(reviewedCount(reviewed)).toBe(2);
    expect(() => assertReplaceAllowed(reviewed, "ai", false)).toThrow(ReplaceConfirmationError);
    try { assertReplaceAllowed(reviewed, "ai", false); } catch (error) {
      expect((error as ReplaceConfirmationError).reviewedCount).toBe(2);
      expect((error as Error).message).toBe("Replace the 2 items you've reviewed?");
    }
  });
  it("goes ahead on yes, with nothing reviewed, or on the same source", () => {
    expect(() => assertReplaceAllowed(reviewed, "ai", true)).not.toThrow();
    expect(() => assertReplaceAllowed(quizOf(ready()), "ai", false)).not.toThrow();
    expect(() => assertReplaceAllowed(reviewed, "uploaded", false)).not.toThrow();
  });
});

describe("what the teacher can change", () => {
  describe("the answer", () => {
    it("sets the answer, clears the pill and the suggestion", () => {
      const item = importedItem("q", "q?", ["a", "b", "c", "d"], null);
      item.answerSuggestion = { letter: "B", confidence: "High", reason: "r" };
      const saved = change(quizOf(item), { action: "setAnswer", letter: "B" }).items[0];
      expect(saved).toMatchObject({ answer: "B", answerSetBy: "teacher", answerSuggestion: null, reviewed: true });
      expect(taskQuizView(quizOf(saved)).items[0].noAnswerKey).toBeNull();
    });
    it("can pick a different option to the one AI suggested", () => {
      const item = importedItem("q", "q?", ["a", "b", "c", "d"], null);
      item.answerSuggestion = { letter: "B", confidence: "High", reason: "r" };
      item.options[2].match = matched();
      const saved = change(quizOf(item), { action: "setAnswer", letter: "C" }).items[0];
      expect(saved.answer).toBe("C");
      // The new answer loses its misconceptions; the old guess is now a wrong option to match.
      expect(saved.options[2].match).toEqual(notMatchedYet());
      expect(wrongOptions(saved).map((option) => option.letter)).toEqual(["A", "B", "D"]);
    });
    it("takes the confirmation away when the answer changes", () => {
      const quiz = quizOf({ ...ready(), confirmed: true });
      const saved = change(quiz, { action: "setAnswer", letter: "B" }).items[0];
      expect(saved.confirmed).toBe(false);
      expect(saved.options[0].match.state).toBe("not_matched");
      expect(saved.options[1].match.state).toBe("not_matched");
    });
    it("keeps it confirmed when the same answer is set again", () => {
      const saved = change(quizOf({ ...ready(), confirmed: true }), { action: "setAnswer", letter: "A" }).items[0];
      expect(saved.confirmed).toBe(true);
    });
    it("refuses a letter the item doesn't have", () => {
      expect(refusal(() => change(quizOf(ready()), { action: "setAnswer", letter: "E" })).message).toBe("Choose one of the item's options.");
    });
  });

  describe("the options (UC 4.2 flow F)", () => {
    const five = () => importedItem("q", "q?", ["a", "b", "c", "d", "e"], "E");
    it("lets an item with five options become confirmable, keeping matches by their text", () => {
      const item = five();
      item.options[0].match = matched();
      const saved = change(quizOf(item), { action: "setOptions", options: ["e", "a", "b", "c"] }).items[0];
      expect(saved.options.map((option) => [option.letter, option.text])).toEqual([["A", "e"], ["B", "a"], ["C", "b"], ["D", "c"]]);
      expect(saved.answer).toBe("A"); // Followed its text to the new letter.
      expect(saved.options[1].match.state).toBe("matched");
      expect(saved.options[2].match.state).toBe("not_matched");
    });
    it("clears the answer if its option was removed", () => {
      const saved = change(quizOf(five()), { action: "setOptions", options: ["a", "b", "c", "d"] }).items[0];
      expect(saved).toMatchObject({ answer: null, answerSetBy: null });
    });
    it("takes an answer given with the options, and refuses one past the end", () => {
      expect(change(quizOf(five()), { action: "setOptions", options: ["a", "b", "c", "d"], answer: "B" }).items[0].answer).toBe("B");
      expect(refusal(() => change(quizOf(five()), { action: "setOptions", options: ["a", "b"], answer: "C" })).status).toBe(422);
    });
    it("always needs confirming again", () => {
      const saved = change(quizOf({ ...ready(), confirmed: true }), { action: "setOptions", options: ["a", "b", "c", "d"] }).items[0];
      expect(saved.confirmed).toBe(false);
    });
    it("takes misconceptions off an option that became the answer", () => {
      const item = ready();
      const saved = change(quizOf(item), { action: "setOptions", options: ["a", "b", "c", "d"], answer: "B" }).items[0];
      expect(saved.options[1].match.state).toBe("not_matched");
    });
  });

  describe("the text", () => {
    it("needs confirming again if the question changes, not the explanation", () => {
      const quiz = quizOf({ ...ready(), confirmed: true });
      expect(change(quiz, { action: "editText", stem: "New?" }).items[0]).toMatchObject({ stem: "New?", confirmed: false });
      expect(change(quiz, { action: "editText", explanation: "Why" }).items[0]).toMatchObject({ explanation: "Why", confirmed: true });
    });
  });

  describe("misconceptions", () => {
    it("records the teacher's choice as teacher-set, dropping AI's confidence and reason", () => {
      const item = ready();
      item.options[1].match = { state: "matched", ids: [MC1], setBy: "ai", confidence: "High", reason: "r" };
      const saved = change(quizOf(item), { action: "setMatch", letter: "B", ids: [MC2], noMisconception: false }).items[0];
      expect(saved.options[1].match).toEqual({ state: "matched", ids: [MC2], setBy: "teacher", confidence: null, reason: null });
      expect(saved.reviewed).toBe(true);
    });
    it("takes \"No misconception\"", () => {
      const saved = change(quizOf(ready()), { action: "setMatch", letter: "B", ids: [], noMisconception: true }).items[0];
      expect(saved.options[1].match).toMatchObject({ state: "no_misconception", ids: [], setBy: "teacher" });
    });
    it("removing the last chip goes back to Not matched yet and takes the confirmation away", () => {
      const saved = change(quizOf({ ...ready(), confirmed: true }), { action: "setMatch", letter: "B", ids: [], noMisconception: false }).items[0];
      expect(saved.options[1].match).toEqual(notMatchedYet());
      expect(saved.confirmed).toBe(false);
    });
    it("keeps a confirmed item confirmed when it's still fully matched", () => {
      const saved = change(quizOf({ ...ready(), confirmed: true }), { action: "setMatch", letter: "B", ids: [MC2], noMisconception: false }).items[0];
      expect(saved.confirmed).toBe(true);
    });
    it("only lets the teacher pick from this task's list", () => {
      expect(refusal(() => change(quizOf(ready()), { action: "setMatch", letter: "B", ids: [MC3], noMisconception: false })).message).toBe("Pick from this task's misconceptions.");
    });
    it("won't put misconceptions on the correct answer", () => {
      expect(refusal(() => change(quizOf(ready()), { action: "setMatch", letter: "A", ids: [MC1], noMisconception: false })).message).toBe("The correct answer can't have misconceptions.");
    });
    it("refuses an option the item doesn't have", () => {
      expect(refusal(() => change(quizOf(ready()), { action: "setMatch", letter: "H", ids: [], noMisconception: true })).status).toBe(422);
    });
  });

  describe("possible new misconceptions (UC 4.4 flow A)", () => {
    const withSuggestion = () => {
      const item = ready();
      item.options[1] = { ...item.options[1], match: notMatchedYet(), possibleNew: [{ id: MC3, confidence: "Medium", reason: "Fits" }] };
      return item;
    };
    it("Add puts it on this task's list as \"Added by you\" and uses it, leaving the lesson's list alone", () => {
      const quiz = quizOf(withSuggestion());
      const saved = change(quiz, { action: "addPossibleNew", letter: "B", id: MC3 });
      expect(saved.addedMisconceptions).toEqual([MC3]);
      expect(saved.lesson?.misconceptions).toEqual([MC1, MC2]);
      expect(quiz.lesson?.misconceptions).toEqual([MC1, MC2]);
      expect(saved.items[0].options[1].match).toEqual({ state: "matched", ids: [MC3], setBy: "teacher", confidence: "Medium", reason: "Fits" });
      expect(saved.items[0].options[1].possibleNew).toEqual([]);
      expect(taskMisconceptions(saved).find((entry) => entry.id === MC3)).toMatchObject({ addedByYou: true });
      expect(taskMisconceptions(saved).find((entry) => entry.id === MC1)).toMatchObject({ addedByYou: false });
    });
    it("keeps chips already on the option, and doesn't list an ID twice", () => {
      const item = withSuggestion();
      item.options[1].match = matched([MC1]);
      const once = change(quizOf(item), { action: "addPossibleNew", letter: "B", id: MC3 });
      expect(once.items[0].options[1].match.ids).toEqual([MC1, MC3]);
      const other = ready("q2");
      other.options[2] = { ...other.options[2], match: notMatchedYet(), possibleNew: [{ id: MC3, confidence: "Low", reason: "r" }] };
      const twice = change({ ...once, items: [...once.items, other] }, { action: "addPossibleNew", letter: "C", id: MC3 }, "q2");
      expect(twice.addedMisconceptions).toEqual([MC3]);
    });
    it("Dismiss removes only the suggestion", () => {
      const saved = change(quizOf(withSuggestion()), { action: "dismissPossibleNew", letter: "B", id: MC3 });
      expect(saved.addedMisconceptions).toEqual([]);
      expect(saved.items[0].options[1]).toMatchObject({ match: notMatchedYet(), possibleNew: [] });
    });
    it("a waiting suggestion doesn't count as a match", () => {
      expect(canConfirmItem(withSuggestion())).toBe(false);
    });
    it("refuses a suggestion that's gone", () => {
      expect(refusal(() => change(quizOf(ready()), { action: "addPossibleNew", letter: "B", id: MC3 })).status).toBe(409);
    });
  });

  describe("confirming", () => {
    it("marks it confirmed and clears what was waiting", () => {
      const item = ready();
      item.options[1].possibleNew = [{ id: MC3, confidence: "Low", reason: "r" }];
      const saved = change(quizOf(item), { action: "confirm" }).items[0];
      expect(saved).toMatchObject({ confirmed: true, reviewed: true, answerSuggestion: null });
      expect(saved.options[1].possibleNew).toEqual([]);
    });
    it("refuses with the reasons", () => {
      const error = refusal(() => change(quizOf({ ...ready(), answer: null }), { action: "confirm" }));
      expect(error.status).toBe(422);
      expect(error.problems).toContain("Set the correct answer");
    });
  });

  it("refuses an item that isn't in the quiz", () => {
    expect(refusal(() => applyItemChange(quizOf(ready()), "nope", { action: "confirm" })).status).toBe(404);
  });
  it("only changes the one item", () => {
    const quiz = quizOf(ready("a"), ready("b"));
    const saved = applyItemChange(quiz, "a", { action: "confirm" });
    expect(saved.items[1]).toBe(quiz.items[1]);
  });
});

describe("checking a change from the client", () => {
  it.each([
    [{ action: "nope" }],
    [{}],
    [{ action: "setAnswer" }],
    [{ action: "setAnswer", letter: "Z" }],
    [{ action: "setAnswer", letter: 1 }],
    [{ action: "setOptions", options: "a" }],
    [{ action: "setOptions", options: ["a"] }],
    [{ action: "setOptions", options: ["a", ""] }],
    [{ action: "setOptions", options: ["a", " A "] }],
    [{ action: "setOptions", options: ["a", 2] }],
    [{ action: "setOptions", options: Array.from({ length: 11 }, (_, i) => `o${i}`) }],
    [{ action: "setOptions", options: ["a", "x".repeat(1001)] }],
    [{ action: "setOptions", options: ["a", "b"], answer: "Z" }],
    [{ action: "editText" }],
    [{ action: "editText", stem: " " }],
    [{ action: "editText", stem: "x".repeat(2001) }],
    [{ action: "editText", explanation: 3 }],
    [{ action: "setMatch", letter: "B", ids: ["MC99"] }],
    [{ action: "setMatch", letter: "B", ids: "MC01" }],
    [{ action: "setMatch", letter: "B", ids: ["MC01"], noMisconception: true }],
    [{ action: "setMatch", letter: "B", noMisconception: "yes" }],
    [{ action: "addPossibleNew", letter: "B" }],
    [{ action: "addPossibleNew", letter: "B", id: "MC99" }],
    [{ action: "dismissPossibleNew", letter: "B", id: "nope" }],
  ])("refuses %j", (input) => {
    expect(parseItemChange(input)).toHaveProperty("error");
  });
  it("accepts good changes, trimmed and without repeats", () => {
    expect(parseItemChange({ action: "confirm" })).toEqual({ action: "confirm" });
    expect(parseItemChange({ action: "setAnswer", letter: "C" })).toEqual({ action: "setAnswer", letter: "C" });
    expect(parseItemChange({ action: "setOptions", options: [" a ", "b"], answer: null })).toEqual({ action: "setOptions", options: ["a", "b"], answer: null });
    expect(parseItemChange({ action: "editText", stem: " New? " })).toEqual({ action: "editText", stem: "New?" });
    expect(parseItemChange({ action: "setMatch", letter: "B", ids: [MC1, MC1] })).toEqual({ action: "setMatch", letter: "B", ids: [MC1], noMisconception: false });
    expect(parseItemChange({ action: "setMatch", letter: "B", noMisconception: true })).toEqual({ action: "setMatch", letter: "B", ids: [], noMisconception: true });
    expect(parseItemChange({ action: "dismissPossibleNew", letter: "B", id: MC1 })).toEqual({ action: "dismissPossibleNew", letter: "B", id: MC1 });
  });
});

describe("AI suggestions", () => {
  const listed = new Set([MC1, MC2]);
  const option = () => ({ letter: "B", text: "b", match: notMatchedYet(), possibleNew: [] });
  it("uses a listed ID with its confidence and reason", () => {
    expect(suggestOnOption(option(), { ids: [MC1], noMisconception: false, confidence: "High", reason: "r" }, listed).match)
      .toEqual({ state: "matched", ids: [MC1], setBy: "ai", confidence: "High", reason: "r" });
  });
  it("holds back an ID outside this task's list", () => {
    const result = suggestOnOption(option(), { ids: [MC3], noMisconception: false, confidence: "Low", reason: "r" }, listed);
    expect(result.match).toEqual(notMatchedYet());
    expect(result.possibleNew).toEqual([{ id: MC3, confidence: "Low", reason: "r" }]);
  });
  it("splits a mix of listed and outside IDs", () => {
    const result = suggestOnOption(option(), { ids: [MC1, MC3], noMisconception: false, confidence: "Low", reason: "r" }, listed);
    expect(result.match.ids).toEqual([MC1]);
    expect(result.possibleNew.map((entry) => entry.id)).toEqual([MC3]);
  });
  it("records \"No misconception\" with the reason", () => {
    expect(suggestOnOption(option(), { ids: [], noMisconception: true, confidence: "Medium", reason: "Plausible distractor; no listed idea fits." }, listed).match)
      .toEqual({ state: "no_misconception", ids: [], setBy: "ai", confidence: "Medium", reason: "Plausible distractor; no listed idea fits." });
  });

  describe("applying a match", () => {
    const suggestion = { ids: [MC1], noMisconception: false, confidence: "High" as const, reason: "r" };
    const all = { A: suggestion, B: suggestion, C: suggestion, D: suggestion };
    it("fills in only what's Not matched yet", () => {
      const item = importedItem("q", "q?", ["a", "b", "c", "d"], "A");
      item.options[1].match = matched([MC2]);
      const saved = applyMatchResults(quizOf(item), [{ itemId: "q", answerSuggestion: null, options: all }]).items[0];
      expect(saved.options[1].match).toEqual(matched([MC2]));
      expect(saved.options[2].match).toMatchObject({ state: "matched", setBy: "ai" });
      expect(saved.options[0].match.state).toBe("not_matched"); // The correct answer.
    });
    it("never touches a confirmed item", () => {
      const item = { ...ready(), confirmed: true };
      item.options[1] = { ...item.options[1], match: none() };
      const saved = applyMatchResults(quizOf(item), [{ itemId: "q1", answerSuggestion: null, options: all }]).items[0];
      expect(saved).toEqual(item);
    });
    it("suggests an answer without setting it", () => {
      const item = importedItem("q", "q?", ["a", "b", "c", "d"], null);
      const saved = applyMatchResults(quizOf(item), [{ itemId: "q", answerSuggestion: { letter: "B", confidence: "High", reason: "r" }, options: all }]).items[0];
      expect(saved.answer).toBeNull();
      expect(saved.answerSuggestion?.letter).toBe("B");
      expect(saved.options[1].match.state).toBe("not_matched");
      expect(saved.options[0].match.state).toBe("matched");
      expect(canConfirmItem(saved)).toBe(false);
    });
    it("knows which items still need work", () => {
      const noKey = importedItem("nokey", "q?", ["a", "b", "c", "d"], null);
      const done = { ...ready("done"), confirmed: true };
      const unmatched = importedItem("unmatched", "q?", ["a", "b", "c", "d"], "A");
      const suggested = importedItem("suggested", "q?", ["a", "b", "c", "d"], null);
      suggested.answerSuggestion = { letter: "A", confidence: "Low", reason: "r" };
      for (const option of wrongOptions(suggested)) option.match = none("ai");
      expect(itemsNeedingMatch(quizOf(noKey, done, unmatched, ready("ok"), suggested)).map((item) => item.id)).toEqual(["nokey", "unmatched"]);
    });
  });
});

describe("the lesson's quiz (UC 4.1)", () => {
  it.each(getAllLessons().map((lesson) => [lesson.lesson_number, lesson] as const))("copies lesson %i with every item confirmed and its IDs mapped", (_n, lesson) => {
    const items = itemsFromLesson(draftFromLesson(lesson));
    expect(items).toHaveLength(lesson.quiz_items.filter((item) => item.type === "multiple_choice").length);
    for (const item of items) {
      expect(item).toMatchObject({ origin: "Lesson bank", confirmed: true, reviewed: false, answerSetBy: "lesson" });
      expect(item.options.map((option) => option.letter)).toEqual(["A", "B", "C", "D"]);
      expect(confirmProblems(item)).toEqual([]);
      for (const option of wrongOptions(item)) expect(option.match.setBy).toBe("lesson");
      for (const option of item.options) for (const id of option.match.ids) expect(id).toMatch(/^MC\d\d$/);
    }
    expect(items.some((item) => item.options.some((option) => option.match.ids.length))).toBe(true);
  });
  it("keeps an item needing review if a lesson's item breaks the rules", () => {
    const content: LessonDraftContent = {
      title: "t", objective: "o", topic: "t", targetConcept: "c", coreIdeas: [], misconceptions: [],
      quizItems: [{ ...emptyDraftQuizItem("q"), stem: "q", options: { A: "a", B: "b", C: "c", D: "d" }, correct: null }],
    };
    expect(itemsFromLesson(content)[0]).toMatchObject({ confirmed: false, answer: null, answerSetBy: null });
  });
});

describe("what the rest of the app reads", () => {
  const published = (): TaskQuiz => {
    const first = { ...ready("q1"), confirmed: true, explanation: "Because" };
    first.image = "/quiz-images/x.png";
    const second = { ...ready("q2"), confirmed: true };
    second.options[2].match = matched([MC2]);
    return { ...quizOf(first, second), status: "published", addedMisconceptions: [MC3] };
  };
  it("gives the app's own shape, with each item's paired confidence question", () => {
    const items = quizItemsFromTaskQuiz(published());
    expect(items.map((item) => [item.item_id, item.type])).toEqual([
      ["q1", "multiple_choice"], ["q1_confidence", "confidence_check"], ["q2", "multiple_choice"], ["q2_confidence", "confidence_check"],
    ]);
    expect(items[0]).toMatchObject({
      question_number: 1, stem: "q1?", image: "/quiz-images/x.png", options: { A: "a", B: "b", C: "c", D: "d" }, correct_answer: "A", explanation: "Because",
      distractor_misconception_map: { B: MC1, D: `${MC1}, ${MC2}` },
    });
    expect(items[1]).toEqual({ item_id: "q1_confidence", type: "confidence_check", stem: "How confident are you about your answer?", options: { A: "Very confident", B: "Somewhat confident", C: "Not very confident", D: "Just guessing" } });
  });
  it("gives no fallback misconception when an option is \"No misconception\"", () => {
    const items = quizItemsFromTaskQuiz(published());
    expect(items[0].matched_misconception).toBeUndefined();
    expect(items[0].distractor_misconception_map).not.toHaveProperty("C");
    expect(items[2].matched_misconception).toBe(MC1);
  });
  it("uses only confirmed matches", () => {
    const quiz = quizOf(ready("q1"));
    const [item] = quizItemsFromTaskQuiz(quiz);
    expect(item.distractor_misconception_map).toEqual({});
    expect(item.matched_misconception).toBeUndefined();
  });
  it("gives students no answer keys, misconceptions or explanations", () => {
    const quiz = published();
    const items = studentQuizItems(quiz);
    const text = JSON.stringify(items);
    for (const banned of ["correct_answer", "distractor", "matched_misconception", "explanation", "Because", "MC0"]) expect(text).not.toContain(banned);
    expect(items[0]).toEqual({ item_id: "q1", type: "multiple_choice", question_number: 1, stem: "q1?", image: "/quiz-images/x.png", options: { A: "a", B: "b", C: "c", D: "d" } });
    expect(items[1].stem).toBe("How confident are you about your answer?");
    expect(studentQuizHeading(quiz)).toBe("Lesson 1: Get ready for the lesson");
  });
  it("can give a whole lesson, including misconceptions added for this task", () => {
    const whole = lessonFromTaskQuiz(published())!;
    expect(whole).toMatchObject({ lesson_number: 1, lesson_title: "L", learning_objective: "o", core_ideas: ["i1", "i2"] });
    expect(Object.keys(whole.misconceptions)).toEqual([MC1, MC2, MC3]);
    expect(whole.quiz_items).toHaveLength(4);
    expect(lessonFromTaskQuiz(emptyTaskQuiz("c", "a"))).toBeNull();
  });
});

describe("the teacher's view", () => {
  it("has what each card shows, and never where the file is stored", () => {
    const item = importedItem("q", "q?", ["a", "b", "c", "d"], null);
    item.answerSuggestion = { letter: "A", confidence: "High", reason: "Why" };
    item.options[1].match = { state: "matched", ids: [MC1], setBy: "ai", confidence: "Medium", reason: "Because" };
    item.options[2].match = { state: "no_misconception", ids: [], setBy: "ai", confidence: "Low", reason: "Plausible" };
    item.options[3].possibleNew = [{ id: MC3, confidence: "Low", reason: "Fits" }];
    const view = taskQuizView({
      ...quizOf(item), sourceDetail: { kind: "file", fileName: "x.docx", fileKind: "docx", bytes: 3, storageKey: "secret-key", at: "now" },
    });
    expect(JSON.stringify(view)).not.toContain("secret-key");
    expect(view.sourceDetail).toEqual({ kind: "file", fileName: "x.docx", fileKind: "docx", bytes: 3, at: "now" });
    const [card] = view.items;
    expect(card).toMatchObject({ number: 1, origin: "Uploaded", pill: "Needs your review", noAnswerKey: "No answer key", canConfirm: false });
    expect(card.answerSuggestion).toMatchObject({ letter: "A", label: "AI suggests this is the correct answer" });
    expect(card.options[0].match).toMatchObject({ state: "not_matched", label: "Not matched yet" });
    expect(card.options[1].match).toMatchObject({ aiLine: "AI · Medium confidence. Because" });
    expect(card.options[1].match?.chips[0]).toMatchObject({ id: MC1 });
    expect(card.options[2].match).toMatchObject({ label: "No misconception", aiLine: "AI · Low confidence. Plausible" });
    expect(card.options[3].possibleNew[0].label).toMatch(/^Possible new misconception: /);
    expect(view).toMatchObject({ canPublish: false, tabStatus: "Needs review", stepStatus: "In progress", unmatchedBanner: "Misconceptions not matched yet" });
  });
  it("marks the correct option and shows a confirmed item's pill", () => {
    const view = taskQuizView(quizOf({ ...ready(), confirmed: true }));
    expect(view.items[0].pill).toBe("Confirmed");
    expect(view.items[0].options[0]).toMatchObject({ isCorrect: true, tag: "Correct", match: null });
    expect(view).toMatchObject({ canPublish: true, tabStatus: "Ready", stepStatus: "Ready to publish", replacePrompt: null });
  });
  it("offers the replace question once items are reviewed", () => {
    expect(taskQuizView(quizOf({ ...ready(), reviewed: true }))).toMatchObject({ reviewedCount: 1, replacePrompt: "Replace the 1 item you've reviewed?" });
  });
  it("shows the lock once published", () => {
    const view = taskQuizView({ ...quizOf({ ...ready(), confirmed: true }), status: "published" });
    expect(view).toMatchObject({ locked: true, lockedLabel: "Locked after publishing", canPublish: false, publishProblems: [] });
  });
});
