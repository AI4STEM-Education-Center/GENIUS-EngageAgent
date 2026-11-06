import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_OPTIONS, CONFIDENCE_STEM, compareLessons, draftFromLesson, emptyDraftQuizItem, emptyLessonDraft, isSafeLessonImage,
  lessonFromDraft, lessonProblems, parseLessonDraft, type DraftQuizItem, type LessonDraftContent,
} from "@/lib/lessons";
import { LESSON_MISCONCEPTIONS, MisconceptionId, toMisconceptionIds } from "@/lib/misconceptions";
import { getAllLessons } from "@/lib/quiz-data";

const MC1 = MisconceptionId.NoVisibleDamageMeansWeakForce, MC2 = MisconceptionId.HeavierAlwaysCausesMoreDamage, MC3 = MisconceptionId.ForceNeededForConstantSpeed;

const item = (id: string, overrides: Partial<DraftQuizItem> = {}): DraftQuizItem => ({
  ...emptyDraftQuizItem(id), stem: `Question ${id}?`, options: { A: `${id} one`, B: `${id} two`, C: `${id} three`, D: `${id} four` },
  correct: "B", matchedMisconception: MC1, wrongOptionMisconceptions: { A: [MC1], C: [MC1, MC2] }, explanation: "Because.", ...overrides,
});
const ready = (overrides: Partial<LessonDraftContent> = {}): LessonDraftContent => ({
  title: "Forces", objective: "Explain forces.", topic: "Collisions", targetConcept: "Force pairs", coreIdeas: ["Idea one", "Idea two"],
  misconceptions: [MC1, MC2], quizItems: ["q1", "q2", "q3", "q4"].map((id) => item(id)), ...overrides,
});
const messages = (draft: LessonDraftContent) => lessonProblems(draft).map((problem) => problem.message);

describe("parseLessonDraft", () => {
  it("accepts an empty draft, since a draft can be unfinished", () => {
    expect(parseLessonDraft(emptyLessonDraft())).toEqual({ draft: emptyLessonDraft() });
    expect(parseLessonDraft({ ...emptyLessonDraft(), quizItems: [emptyDraftQuizItem("q1")], coreIdeas: [""] })).toHaveProperty("draft");
  });

  it("keeps a finished draft exactly as sent", () => {
    expect(parseLessonDraft(ready())).toEqual({ draft: ready() });
  });

  it.each<[string, unknown]>([
    ["not an object", "lesson"],
    ["a list", []],
    ["nothing", null],
    ["a title that isn't text", { ...ready(), title: 7 }],
    ["a title that's too long", { ...ready(), title: "x".repeat(201) }],
    ["a missing objective", { ...ready(), objective: undefined }],
    ["core ideas that aren't a list", { ...ready(), coreIdeas: "idea" }],
    ["a core idea that isn't text", { ...ready(), coreIdeas: [1] }],
    ["too many core ideas", { ...ready(), coreIdeas: Array(31).fill("idea") }],
    ["a misconception not on the list", { ...ready(), misconceptions: ["MC99"] }],
    ["a repeated misconception", { ...ready(), misconceptions: [MC1, MC1] }],
    ["items that aren't a list", { ...ready(), quizItems: {} }],
    ["too many items", { ...ready(), quizItems: Array.from({ length: 51 }, (_, i) => item(`q${i}`)) }],
    ["a repeated item id", { ...ready(), quizItems: [item("q1"), item("q1")] }],
    ["a bad item id", { ...ready(), quizItems: [item("q 1")] }],
    ["an item that isn't an object", { ...ready(), quizItems: ["q1"] }],
    ["a correct answer that isn't a letter", { ...ready(), quizItems: [item("q1", { correct: "E" as never })] }],
    ["an unknown matched misconception", { ...ready(), quizItems: [item("q1", { matchedMisconception: "nope" as never })] }],
    ["a missing option", { ...ready(), quizItems: [item("q1", { options: { A: "a", B: "b", C: "c" } as never })] }],
    ["a fifth option", { ...ready(), quizItems: [item("q1", { options: { A: "a", B: "b", C: "c", D: "d", E: "e" } as never })] }],
    ["an option that's too long", { ...ready(), quizItems: [item("q1", { options: { A: "x".repeat(1001), B: "b", C: "c", D: "d" } })] }],
    ["an unknown option misconception", { ...ready(), quizItems: [item("q1", { wrongOptionMisconceptions: { A: ["nope"] } as never })] }],
    ["option misconceptions on an unknown letter", { ...ready(), quizItems: [item("q1", { wrongOptionMisconceptions: { E: [MC1] } as never })] }],
    ["a picture on another site", { ...ready(), quizItems: [item("q1", { image: "https://evil.example/a.png" })] }],
    ["a script address as a picture", { ...ready(), quizItems: [item("q1", { image: "javascript:alert(1)" })] }],
  ])("refuses %s", (_label, input) => {
    expect(parseLessonDraft(input)).toHaveProperty("error");
  });

  it("only allows pictures this app serves", () => {
    expect(isSafeLessonImage("/quiz-images/L1_Q1.webp")).toBe(true);
    expect(isSafeLessonImage("/api/lessons/images/abc-1.png")).toBe(true);
    for (const bad of ["/quiz-images/../secret", "/quiz-images/a/b.png", "/other/a.png", "//evil.example/a.png", "/quiz-images/.."]) {
      expect(isSafeLessonImage(bad)).toBe(false);
    }
  });

  it("drops empty option misconception lists", () => {
    const parsed = parseLessonDraft({ ...ready(), quizItems: [item("q1", { wrongOptionMisconceptions: { A: [] } })] });
    expect("draft" in parsed && parsed.draft.quizItems[0].wrongOptionMisconceptions).toEqual({});
  });
});

describe("lessonProblems", () => {
  it("finds nothing wrong with a finished lesson", () => {
    expect(lessonProblems(ready())).toEqual([]);
  });

  it("lists everything missing from an empty lesson, using the wording in the task", () => {
    expect(messages(emptyLessonDraft())).toEqual([
      "Lesson title is required", "Learning objective is required", "Topic is required", "Target concept is required",
      "Add at least one core idea", "Add at least one misconception", "Add at least four quiz items",
    ]);
  });

  it("treats spaces as empty", () => {
    expect(messages(ready({ title: "   ", coreIdeas: ["  ", ""] }))).toEqual(["Lesson title is required", "Add at least one core idea"]);
  });

  it("needs at least four quiz items", () => {
    expect(messages(ready({ quizItems: ready().quizItems.slice(0, 3) }))).toEqual(["Add at least four quiz items"]);
  });

  it("names the question and field for each problem", () => {
    const quizItems = ready().quizItems;
    quizItems[2] = item("q3", { correct: null });
    expect(lessonProblems(ready({ quizItems }))).toEqual([{ field: "quizItems.2.correct", message: "Q3: correct answer is not one of the options" }]);
  });

  it.each<[string, Partial<DraftQuizItem>, string]>([
    ["a blank question", { stem: " " }, "Q1: question is required"],
    ["a blank option", { options: { A: "a", B: "b", C: "", D: "d" } }, "Q1: option C is required"],
    ["options that repeat", { options: { A: "Same", B: "b", C: "same ", D: "d" } }, "Q1: options must be different"],
    ["a correct answer pointing at a blank option", { correct: "C", wrongOptionMisconceptions: {}, options: { A: "a", B: "b", C: " ", D: "d" } }, "Q1: correct answer is not one of the options"],
    ["no matched misconception", { matchedMisconception: null }, "Q1: matched misconception must be one of this lesson's misconceptions"],
    ["a matched misconception outside the lesson", { matchedMisconception: MC3 }, "Q1: matched misconception must be one of this lesson's misconceptions"],
    ["an option misconception outside the lesson", { wrongOptionMisconceptions: { A: [MC3] } }, "Q1: option A uses a misconception that isn't in this lesson"],
    ["misconceptions on the correct answer", { wrongOptionMisconceptions: { B: [MC1] } }, "Q1: the correct answer can't have misconceptions"],
    ["no explanation", { explanation: "" }, "Q1: explanation is required"],
  ])("catches %s", (_label, overrides, message) => {
    const quizItems = ready().quizItems;
    quizItems[0] = item("q1", overrides);
    expect(messages(ready({ quizItems }))).toContain(message);
  });

  it("allows wrong options with no misconceptions", () => {
    const quizItems = ready().quizItems;
    quizItems[0] = item("q1", { wrongOptionMisconceptions: {} });
    expect(lessonProblems(ready({ quizItems }))).toEqual([]);
  });

  it("the image is optional", () => {
    const quizItems = ready().quizItems;
    quizItems[0] = item("q1", { image: "/quiz-images/a.webp" });
    expect(lessonProblems(ready({ quizItems }))).toEqual([]);
  });
});

describe("lessonFromDraft", () => {
  const lesson = lessonFromDraft(ready({ title: " Forces ", coreIdeas: [" Idea one ", "", "Idea two"] }), 9);

  it("uses the shape the rest of the app reads", () => {
    expect(lesson).toMatchObject({
      lesson_number: 9, lesson_title: "Forces", learning_objective: "Explain forces.", topic: "Collisions", target_concept: "Force pairs",
      core_ideas: ["Idea one", "Idea two"],
    });
    expect(Object.keys(lesson.misconceptions)).toEqual([MC1, MC2]);
    expect(lesson.misconceptions[MC1]).toBeTruthy();
  });

  it("adds a confidence question after each item, which the teacher doesn't edit", () => {
    expect(lesson.quiz_items).toHaveLength(8);
    expect(lesson.quiz_items.map((q) => q.item_id).slice(0, 2)).toEqual(["q1", "q1_confidence"]);
    expect(lesson.quiz_items[1]).toEqual({ item_id: "q1_confidence", type: "confidence_check", stem: CONFIDENCE_STEM, options: CONFIDENCE_OPTIONS });
  });

  it("numbers the items and writes several misconceptions the way the lesson files do", () => {
    const first = lesson.quiz_items[0];
    expect(first).toMatchObject({
      type: "multiple_choice", question_number: 1, correct_answer: "B", matched_misconception: MC1, explanation: "Because.",
      distractor_misconception_map: { A: MC1, C: `${MC1}, ${MC2}` },
    });
    expect(lesson.quiz_items[2].question_number).toBe(2);
    expect(first).not.toHaveProperty("image");
    expect(toMisconceptionIds(9, first.distractor_misconception_map?.C)).toEqual([MC1, MC2]);
  });
});

it("lessonFromDraft never records misconceptions on the correct answer", () => {
  const quizItems = ready().quizItems;
  quizItems[0] = item("q1", { correct: "A", wrongOptionMisconceptions: { A: [MC1], C: [MC2] } });
  expect(lessonFromDraft(ready({ quizItems }), 9).quiz_items[0].distractor_misconception_map).toEqual({ C: MC2 });
});

describe("draftFromLesson", () => {
  it.each(getAllLessons().map((lesson) => [lesson.lesson_number, lesson] as const))("opens built-in lesson %i for editing without losing anything", (n, lesson) => {
    const draft = draftFromLesson(lesson);
    expect(parseLessonDraft(draft)).toEqual({ draft });
    expect(draft.title).toBe(lesson.lesson_title);
    expect(draft.coreIdeas).toEqual(lesson.core_ideas);
    expect(new Set(draft.misconceptions)).toEqual(new Set(Object.values(LESSON_MISCONCEPTIONS[n])));
    const multipleChoice = lesson.quiz_items.filter((q) => q.type === "multiple_choice");
    expect(draft.quizItems.map((q) => q.id)).toEqual(multipleChoice.map((q) => q.item_id));
    draft.quizItems.forEach((q, index) => {
      const source = multipleChoice[index];
      expect(q.correct).toBe(source.correct_answer);
      expect(q.options).toEqual(source.options);
      expect(q.image).toBe(source.image ?? null);
      expect(q.matchedMisconception).toBe(toMisconceptionIds(n, source.matched_misconception)[0] ?? null);
      for (const [letter, codes] of Object.entries(source.distractor_misconception_map ?? {})) {
        expect(q.wrongOptionMisconceptions[letter as "A"]).toEqual(toMisconceptionIds(n, codes));
      }
    });
    // The only things left to fill in are what the lesson files never had.
    const missing = lessonProblems(draft).map((problem) => problem.message).filter((m) => !/explanation is required|Topic is required|Target concept is required/.test(m));
    expect(missing).toEqual([]);
  });

  it("gives back the same draft after publishing", () => {
    expect(draftFromLesson(lessonFromDraft(ready(), 9))).toEqual(ready());
  });

  it("keeps a version 2 of a built-in lesson working once it uses the shared IDs", () => {
    const edited = lessonFromDraft({ ...draftFromLesson(getAllLessons()[0]), topic: "t", targetConcept: "c" }, 1);
    expect(Object.keys(edited.misconceptions).every((id) => id.startsWith("MC"))).toBe(true);
    expect(draftFromLesson(edited).misconceptions).toEqual(draftFromLesson(getAllLessons()[0]).misconceptions);
  });
});

describe("compareLessons", () => {
  it("finds nothing between identical lessons", () => {
    expect(compareLessons(ready(), ready())).toMatchObject({ hasChanges: false, basics: [] });
  });

  it("reports changed basics", () => {
    expect(compareLessons(ready(), ready({ title: "Energy" })).basics).toEqual([{ field: "Lesson title", before: "Forces", after: "Energy" }]);
  });

  it("reports core ideas added, removed, changed and reordered", () => {
    const base = ready({ coreIdeas: ["one", "two", "three"] });
    expect(compareLessons(base, ready({ coreIdeas: ["one", "two", "three", "four"] })).coreIdeas).toMatchObject({ added: ["four"], removed: [], changed: [], reordered: false });
    expect(compareLessons(base, ready({ coreIdeas: ["one", "two"] })).coreIdeas).toMatchObject({ added: [], removed: ["three"], changed: [] });
    expect(compareLessons(base, ready({ coreIdeas: ["one", "2", "three"] })).coreIdeas).toMatchObject({ added: [], removed: [], changed: [{ before: "two", after: "2" }] });
    const moved = compareLessons(base, ready({ coreIdeas: ["three", "one", "two"] }));
    expect(moved.coreIdeas.reordered).toBe(true);
    expect(moved.hasChanges).toBe(true);
  });

  it("reports misconceptions by ID", () => {
    expect(compareLessons(ready(), ready({ misconceptions: [MC2, MC3] })).misconceptions).toEqual({ added: [MC3], removed: [MC1] });
  });

  it("reports quiz items added, removed and reordered", () => {
    const [a, b, c, d] = ready().quizItems;
    const changes = compareLessons(ready(), ready({ quizItems: [a, b, c, item("q5")] }));
    expect(changes.quizItems.added).toEqual([{ id: "q5", number: 4, stem: "Question q5?" }]);
    expect(changes.quizItems.removed).toEqual([{ id: "q4", stem: "Question q4?" }]);
    expect(changes.quizItems.reordered).toBe(false);
    expect(compareLessons(ready(), ready({ quizItems: [b, a, c, d] })).quizItems.reordered).toBe(true);
  });

  it("reports option text, correct answer, misconception mapping and explanation inside an item", () => {
    const quizItems = ready().quizItems;
    quizItems[1] = item("q2", {
      options: { A: "q2 one", B: "q2 two", C: "changed", D: "q2 four" }, correct: "A", matchedMisconception: MC2,
      wrongOptionMisconceptions: { C: [MC2], B: [MC1] }, explanation: "New.", image: "/quiz-images/x.webp", stem: "New question?",
    });
    const [changed] = compareLessons(ready(), ready({ quizItems })).quizItems.changed;
    expect(changed).toMatchObject({ id: "q2", number: 2 });
    expect(changed.changes).toEqual(expect.arrayContaining([
      { field: "Question", before: "Question q2?", after: "New question?" },
      { field: "Image", before: "None", after: "/quiz-images/x.webp" },
      { field: "Option C", before: "q2 three", after: "changed" },
      { field: "Correct answer", before: "B", after: "A" },
      { field: "Matched misconception", before: MC1, after: MC2 },
      { field: "Option A misconceptions", before: MC1, after: "None" },
      { field: "Option B misconceptions", before: "None", after: MC1 },
      { field: "Option C misconceptions", before: `${MC1}, ${MC2}`, after: MC2 },
      { field: "Explanation", before: "Because.", after: "New." },
    ]));
  });
});
