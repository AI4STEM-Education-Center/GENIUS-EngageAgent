/**
 * A task's own quiz (#177): a copy of quiz items that belongs to one class task,
 * whether they came from the lesson, a file or link, or AI. The teacher reviews
 * them here, and students, strategy and reports read the published copy, not the
 * lesson file.
 *
 * Nothing here touches storage, so it is safe to use in the browser.
 */
import { CONFIDENCE_OPTIONS, CONFIDENCE_STEM, OPTION_LETTERS, type LessonDraftContent } from "./lessons";
import { isMisconceptionId, MISCONCEPTION_TEXT, type MisconceptionId } from "./misconceptions";
import type { Lesson, QuizItem } from "./types";

export const QUIZ_SOURCES = ["provided", "uploaded", "ai"] as const;
export type QuizSource = (typeof QUIZ_SOURCES)[number];
export type ItemOrigin = "Lesson bank" | "Uploaded" | "Created with AI";

export const MATCH_CONFIDENCES = ["High", "Medium", "Low"] as const;
export type MatchConfidence = (typeof MATCH_CONFIDENCES)[number];

export const ITEM_COUNTS = [3, 4, 5] as const;
export const READING_LEVELS = ["Grade 6", "Grade 7", "Grade 8"] as const;
export type ReadingLevel = (typeof READING_LEVELS)[number];

export const MAX_QUIZ_ITEMS = 30;
export const MAX_ITEM_OPTIONS = 10;
export const MAX_STEM_LENGTH = 2000;
export const MAX_OPTION_LENGTH = 1000;
export const MAX_EXPLANATION_LENGTH = 4000;
export const MAX_REASON_LENGTH = 500;
export const MAX_ANCHORING_LENGTH = 2000;

export const NOT_MATCHED_LABEL = "Not matched yet";
export const NO_MISCONCEPTION_LABEL = "No misconception";
export const PUBLISHED_MESSAGE = "This quiz is published and can't be changed.";
export const PICK_LESSON_MESSAGE = "Pick a lesson first.";

/** Option letters by position. Imports can find more than four options, so this goes past D. */
export const ITEM_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;

export type OptionMatch = {
  /** "matched" has at least one ID. "no_misconception" is an explicit choice, not a blank. */
  state: "not_matched" | "matched" | "no_misconception";
  ids: MisconceptionId[];
  /** Who chose it: the lesson it was copied from, an AI suggestion, or the teacher. */
  setBy: "lesson" | "ai" | "teacher" | null;
  confidence: MatchConfidence | null;
  reason: string | null;
};

/** An AI suggestion from outside this lesson's list, waiting for "Add to lesson list and use" or "Dismiss". */
export type PossibleNewMisconception = { id: MisconceptionId; confidence: MatchConfidence; reason: string };

export type TaskQuizOption = { letter: string; text: string; match: OptionMatch; possibleNew: PossibleNewMisconception[] };

export type TaskQuizItem = {
  id: string;
  origin: ItemOrigin;
  stem: string;
  image: string | null;
  options: TaskQuizOption[];
  /** The correct option's letter, or null for "No answer key". */
  answer: string | null;
  answerSetBy: "lesson" | "file" | "ai" | "teacher" | null;
  /** What AI thinks the answer is. It only becomes the answer when the teacher says so. */
  answerSuggestion: { letter: string; confidence: MatchConfidence; reason: string } | null;
  explanation: string;
  confirmed: boolean;
  /** The teacher has worked on this item, so replacing the quiz asks first. */
  reviewed: boolean;
};

export type TaskQuizLesson = {
  number: number;
  version: number;
  title: string;
  objective: string;
  topic: string;
  targetConcept: string;
  coreIdeas: string[];
  misconceptions: MisconceptionId[];
};

export type QuizSourceDetail =
  | { kind: "file"; fileName: string; fileKind: string; bytes: number; storageKey: string; at: string }
  | { kind: "link"; url: string; site: string; at: string };

export type QuizActor = { id: string; name: string };

export type TaskQuiz = {
  classId: string;
  assignmentId: string;
  /** Goes up on each save, so a stale save can't overwrite someone's newer one. */
  revision: number;
  status: "draft" | "published";
  lesson: TaskQuizLesson | null;
  anchoringPhenomenon: string;
  source: QuizSource | null;
  sourceDetail: QuizSourceDetail | null;
  /** Marked "Added by you". They belong to this task; the lesson version never changes. */
  addedMisconceptions: MisconceptionId[];
  items: TaskQuizItem[];
  updatedAt: string;
  updatedBy: QuizActor | null;
  publishedAt: string | null;
  publishedBy: QuizActor | null;
};

/** A quiz rule was broken. `status` and `problems` go back to the client as they are. */
export class TaskQuizRuleError extends Error {
  constructor(message: string, public status = 422, public problems?: string[]) { super(message); }
}

/** The server won't replace reviewed items until the teacher says yes (UC 4.4 flow D). */
export class ReplaceConfirmationError extends Error {
  constructor(public reviewedCount: number) { super(replacePrompt(reviewedCount)); }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export const emptyTaskQuiz = (classId: string, assignmentId: string): TaskQuiz => ({
  classId, assignmentId, revision: 0, status: "draft", lesson: null, anchoringPhenomenon: "", source: null, sourceDetail: null,
  addedMisconceptions: [], items: [], updatedAt: "", updatedBy: null, publishedAt: null, publishedBy: null,
});

export const notMatchedYet = (): OptionMatch => ({ state: "not_matched", ids: [], setBy: null, confidence: null, reason: null });

/* ------------------------------------------------------------------ */
/*  The rules                                                          */
/* ------------------------------------------------------------------ */

export const isOptionMatched = (option: TaskQuizOption) =>
  (option.match.state === "matched" && option.match.ids.length > 0) || option.match.state === "no_misconception";

/** Every option that isn't the answer. With no key yet, the one AI thinks is correct doesn't count as wrong. */
export function wrongOptions(item: TaskQuizItem) {
  const correct = item.answer ?? item.answerSuggestion?.letter ?? null;
  return item.options.filter((option) => option.letter !== correct);
}

const hasExactlyFourOptions = (item: TaskQuizItem) =>
  item.options.length === OPTION_LETTERS.length
  && item.options.every((option, index) => option.letter === OPTION_LETTERS[index] && option.text.trim().length > 0);

/** What stops an item being confirmed. Empty means "Confirm item" is active. */
export function confirmProblems(item: TaskQuizItem): string[] {
  const problems: string[] = [];
  if (!item.answer || !item.options.some((option) => option.letter === item.answer)) problems.push("Set the correct answer");
  if (!hasExactlyFourOptions(item)) problems.push("This item needs exactly four options, A to D");
  if (wrongOptions(item).some((option) => !isOptionMatched(option))) {
    problems.push(`Match every wrong option to a misconception or "${NO_MISCONCEPTION_LABEL}"`);
  }
  return problems;
}

export const canConfirmItem = (item: TaskQuizItem) => confirmProblems(item).length === 0;

export const taskMisconceptionIds = (quiz: TaskQuiz): MisconceptionId[] => [...(quiz.lesson?.misconceptions ?? []), ...quiz.addedMisconceptions];

/** The lesson's misconceptions plus any added for this task. */
export function taskMisconceptions(quiz: TaskQuiz) {
  const added = new Set(quiz.addedMisconceptions);
  return taskMisconceptionIds(quiz).map((id) => ({ id, text: MISCONCEPTION_TEXT[id], addedByYou: added.has(id) }));
}

export const reviewedCount = (quiz: TaskQuiz) => quiz.items.filter((item) => item.reviewed).length;

export const replacePrompt = (count: number) => `Replace the ${plural(count, "item")} you've reviewed?`;

/** Switching source asks first once items are reviewed. Running the same source again doesn't (UC 4.3 flow B). */
export function assertReplaceAllowed(quiz: TaskQuiz, next: QuizSource, confirmed: boolean) {
  const reviewed = reviewedCount(quiz);
  if (quiz.source !== next && reviewed > 0 && !confirmed) throw new ReplaceConfirmationError(reviewed);
}

export function quizCounts(quiz: TaskQuiz) {
  const total = quiz.items.length;
  const confirmed = quiz.items.filter((item) => item.confirmed).length;
  return {
    total, confirmed, needConfirmation: total - confirmed,
    noAnswerKey: quiz.items.filter((item) => !item.answer).length,
    notMatched: quiz.items.reduce((sum, item) => sum + wrongOptions(item).filter((option) => !isOptionMatched(option)).length, 0),
  };
}

const allConfirmed = (quiz: TaskQuiz) => quiz.items.length > 0 && quiz.items.every((item) => item.confirmed && canConfirmItem(item));

export const quizTabStatus = (quiz: TaskQuiz): "Ready" | "Needs review" | null =>
  !quiz.items.length ? null : allConfirmed(quiz) ? "Ready" : "Needs review";

export function stepOneStatus(quiz: TaskQuiz): "Published" | "Ready to publish" | "In progress" | "Not started" {
  if (quiz.status === "published") return "Published";
  if (quiz.lesson && allConfirmed(quiz)) return "Ready to publish";
  return quiz.lesson ? "In progress" : "Not started";
}

export const confirmationBanner = (quiz: TaskQuiz) => {
  const { total, needConfirmation } = quizCounts(quiz);
  return needConfirmation ? `${needConfirmation} of ${total} items need confirmation` : null;
};

export const unmatchedBanner = (quiz: TaskQuiz) => (quizCounts(quiz).notMatched ? "Misconceptions not matched yet" : null);

export function publishBarCount(quiz: TaskQuiz) {
  const { total, confirmed } = quizCounts(quiz);
  if (!total) return "Quiz · no items yet";
  return confirmed === total ? `Quiz · ${plural(total, "item")} confirmed` : `Quiz · ${confirmed} of ${total} confirmed`;
}

/** What stops the task being published. Empty means "Publish task" is active. */
export function publishProblems(quiz: TaskQuiz): string[] {
  if (!quiz.lesson) return [PICK_LESSON_MESSAGE];
  if (!quiz.items.length) return ["Add at least one quiz item."];
  return allConfirmed(quiz) ? [] : [confirmationBanner(quiz) ?? "Check each item again before publishing."];
}

/** The lines the publish bar shows once the task is out. */
export function publishedBarLines(input: { className: string | null; classSize: number | null; submitted: number }) {
  const { className, classSize, submitted } = input;
  return {
    published: className ? `Task published to ${className}.` : "Task published.",
    progress: submitted === 0
      ? `Waiting for students — 0${classSize === null ? "" : ` of ${classSize}`} submitted.`
      : classSize === null ? `${plural(submitted, "student")} submitted.` : `${submitted} of ${classSize} students submitted.`,
    canGoToStep2: submitted > 0,
  };
}

export const publishedMessage = (classSize: number | null) =>
  (classSize === null ? "Task published" : `Task published to ${plural(classSize, "student")}`);

const missingKeys = (items: TaskQuizItem[]) => {
  const missing = items.filter((item) => !item.answer).length;
  if (!missing) return "";
  return ` — ${missing} ${missing === 1 ? "has" : "have"} no answer key`;
};

export const fileImportMessage = (items: TaskQuizItem[], fileName: string) => `${plural(items.length, "item")} read from ${fileName}${missingKeys(items)}`;
export const linkImportMessage = (items: TaskQuizItem[], site: string) => `${plural(items.length, "item")} imported from ${site}${missingKeys(items)}`;
export const createdMessage = (items: TaskQuizItem[]) => `${plural(items.length, "item")} created with suggested misconception matches`;
export const NO_ITEMS_MESSAGE = (fileName: string) => `No multiple-choice items found in ${fileName}`;

/* ------------------------------------------------------------------ */
/*  Making items                                                       */
/* ------------------------------------------------------------------ */

/** UC 4.1: the lesson version's items. They start confirmed, unless one somehow breaks the rules. */
export function itemsFromLesson(content: LessonDraftContent): TaskQuizItem[] {
  return content.quizItems.map((source) => {
    const item: TaskQuizItem = {
      id: source.id, origin: "Lesson bank", stem: source.stem, image: source.image, explanation: source.explanation,
      answer: source.correct, answerSetBy: source.correct ? "lesson" : null, answerSuggestion: null, confirmed: false, reviewed: false,
      options: OPTION_LETTERS.map((letter) => {
        const ids = source.wrongOptionMisconceptions[letter] ?? [];
        const match: OptionMatch = letter === source.correct
          ? notMatchedYet()
          : { state: ids.length ? "matched" : "no_misconception", ids, setBy: "lesson", confidence: null, reason: null };
        return { letter, text: source.options[letter], match, possibleNew: [] };
      }),
    };
    return { ...item, confirmed: canConfirmItem(item) };
  });
}

/** UC 4.2: an item as a file or page had it, with whatever options were found. */
export function importedItem(id: string, stem: string, options: string[], answer: string | null): TaskQuizItem {
  return {
    id, origin: "Uploaded", stem, image: null, explanation: "", answer, answerSetBy: answer ? "file" : null, answerSuggestion: null,
    confirmed: false, reviewed: false,
    options: options.map((text, index) => ({ letter: ITEM_LETTERS[index], text, match: notMatchedYet(), possibleNew: [] })),
  };
}

export type OptionSuggestion = { ids: MisconceptionId[]; noMisconception: boolean; confidence: MatchConfidence; reason: string };

/** Puts a suggestion on an option. An ID outside this task's list waits as a possible new misconception (UC 4.4 flow A). */
export function suggestOnOption(option: TaskQuizOption, suggestion: OptionSuggestion, listed: ReadonlySet<MisconceptionId>): TaskQuizOption {
  const { confidence, reason } = suggestion;
  const inList = suggestion.ids.filter((id) => listed.has(id));
  const outside = suggestion.ids.filter((id) => !listed.has(id));
  const match: OptionMatch = inList.length
    ? { state: "matched", ids: inList, setBy: "ai", confidence, reason }
    : suggestion.noMisconception
      ? { state: "no_misconception", ids: [], setBy: "ai", confidence, reason }
      : notMatchedYet();
  return { ...option, match, possibleNew: outside.map((id) => ({ id, confidence, reason })) };
}

export type MatchResult = {
  itemId: string;
  answerSuggestion: TaskQuizItem["answerSuggestion"];
  options: Record<string, OptionSuggestion>;
};

/** The items "Match all items" still has work to do on. */
export const itemsNeedingMatch = (quiz: TaskQuiz) => quiz.items.filter((item) =>
  !item.confirmed && ((!item.answer && !item.answerSuggestion) || wrongOptions(item).some((option) => !isOptionMatched(option))));

/** Fills in only what is still "Not matched yet"; a teacher's own choices and confirmed items stay. */
export function applyMatchResults(quiz: TaskQuiz, results: MatchResult[]): TaskQuiz {
  const byItem = new Map(results.map((result) => [result.itemId, result]));
  const listed = new Set(taskMisconceptionIds(quiz));
  return {
    ...quiz,
    items: quiz.items.map((item) => {
      const result = byItem.get(item.id);
      if (!result || item.confirmed) return item;
      const answerSuggestion = item.answer ? null : result.answerSuggestion ?? item.answerSuggestion;
      const correct = item.answer ?? answerSuggestion?.letter;
      return {
        ...item, answerSuggestion,
        options: item.options.map((option) => {
          const suggestion = result.options[option.letter];
          return suggestion && option.letter !== correct && option.match.state === "not_matched" ? suggestOnOption(option, suggestion, listed) : option;
        }),
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  What the teacher can do to an item                                 */
/* ------------------------------------------------------------------ */

export type ItemChange =
  | { action: "setAnswer"; letter: string }
  | { action: "setOptions"; options: string[]; answer?: string | null }
  | { action: "editText"; stem?: string; explanation?: string }
  | { action: "setMatch"; letter: string; ids: MisconceptionId[]; noMisconception: boolean }
  | { action: "addPossibleNew"; letter: string; id: MisconceptionId }
  | { action: "dismissPossibleNew"; letter: string; id: MisconceptionId }
  | { action: "confirm" };

const isItemLetter = (value: unknown): value is string => ITEM_LETTERS.includes(value as (typeof ITEM_LETTERS)[number]);

/** Checks a change sent by the client. */
export function parseItemChange(input: Record<string, unknown>): ItemChange | { error: string } {
  const { action, letter, id } = input;
  const needsLetter = ["setAnswer", "setMatch", "addPossibleNew", "dismissPossibleNew"].includes(String(action));
  if (needsLetter && !isItemLetter(letter)) return { error: "Choose one of the item's options." };
  const validLetter = letter as string;
  switch (action) {
    case "setAnswer": return { action, letter: validLetter };
    case "confirm": return { action };
    case "setOptions": {
      const { options, answer } = input;
      if (!Array.isArray(options) || options.length < 2 || options.length > MAX_ITEM_OPTIONS
        || options.some((text) => typeof text !== "string" || !text.trim() || text.length > MAX_OPTION_LENGTH)) {
        return { error: `An item needs 2 to ${MAX_ITEM_OPTIONS} options, each with text under ${MAX_OPTION_LENGTH} characters.` };
      }
      if (answer !== undefined && answer !== null && !isItemLetter(answer)) return { error: "Choose one of the item's options." };
      const trimmed = (options as string[]).map((text) => text.trim());
      if (new Set(trimmed.map((text) => text.toLowerCase())).size !== trimmed.length) return { error: "Options must be different." };
      return { action, options: trimmed, ...(answer === undefined ? {} : { answer: answer as string | null }) };
    }
    case "editText": {
      const { stem, explanation } = input;
      if (stem === undefined && explanation === undefined) return { error: "Nothing to change." };
      if (stem !== undefined && (typeof stem !== "string" || !stem.trim() || stem.length > MAX_STEM_LENGTH)) return { error: `A question needs text under ${MAX_STEM_LENGTH} characters.` };
      if (explanation !== undefined && (typeof explanation !== "string" || explanation.length > MAX_EXPLANATION_LENGTH)) return { error: `An explanation must be under ${MAX_EXPLANATION_LENGTH} characters.` };
      return { action, ...(stem === undefined ? {} : { stem: (stem as string).trim() }), ...(explanation === undefined ? {} : { explanation: (explanation as string).trim() }) };
    }
    case "setMatch": {
      const { ids = [], noMisconception = false } = input;
      if (typeof noMisconception !== "boolean" || !Array.isArray(ids) || ids.length > 20 || ids.some((value) => typeof value !== "string" || !isMisconceptionId(value))) {
        return { error: "Misconceptions must come from the list." };
      }
      if (noMisconception && ids.length) return { error: `Choose misconceptions or "${NO_MISCONCEPTION_LABEL}", not both.` };
      return { action, letter: validLetter, ids: [...new Set(ids as MisconceptionId[])], noMisconception };
    }
    case "addPossibleNew":
    case "dismissPossibleNew":
      if (typeof id !== "string" || !isMisconceptionId(id)) return { error: "Misconceptions must come from the list." };
      return { action, letter: validLetter, id };
    default:
      return { error: "Unknown change." };
  }
}

const requireOption = (item: TaskQuizItem, letter: string) => {
  const option = item.options.find((candidate) => candidate.letter === letter);
  if (!option) throw new TaskQuizRuleError("Choose one of the item's options.");
  return option;
};

const withOption = (item: TaskQuizItem, letter: string, change: (option: TaskQuizOption) => TaskQuizOption): TaskQuizItem =>
  ({ ...item, options: item.options.map((option) => (option.letter === letter ? change(option) : option)) });

/** The answer can't carry misconceptions. Its old match is cleared, so it reads "Not matched yet" if it stops being the answer. */
const clearAnswerMatch = (item: TaskQuizItem): TaskQuizItem =>
  (item.answer ? withOption(item, item.answer, (option) => ({ ...option, match: notMatchedYet(), possibleNew: [] })) : item);

function changeItem(quiz: TaskQuiz, item: TaskQuizItem, change: ItemChange): { item: TaskQuizItem; added?: MisconceptionId } {
  switch (change.action) {
    case "setAnswer": {
      requireOption(item, change.letter);
      const same = change.letter === item.answer;
      return { item: clearAnswerMatch({ ...item, answer: change.letter, answerSetBy: same ? item.answerSetBy : "teacher", answerSuggestion: null, confirmed: item.confirmed && same }) };
    }
    case "setOptions": {
      const before = new Map(item.options.map((option) => [option.text.trim().toLowerCase(), option]));
      const options = change.options.map((text, index): TaskQuizOption => {
        const kept = before.get(text.toLowerCase());
        return { letter: ITEM_LETTERS[index], text, match: kept?.match ?? notMatchedYet(), possibleNew: kept?.possibleNew ?? [] };
      });
      // Unless the teacher chose, the answer follows its text to its new letter.
      const oldAnswer = item.options.find((option) => option.letter === item.answer);
      const answer = change.answer !== undefined
        ? change.answer
        : options.find((option) => option.text.toLowerCase() === oldAnswer?.text.trim().toLowerCase())?.letter ?? null;
      if (answer && !options.some((option) => option.letter === answer)) throw new TaskQuizRuleError("Choose one of the item's options.");
      return { item: clearAnswerMatch({ ...item, options, answer, answerSetBy: answer ? "teacher" : null, answerSuggestion: null, confirmed: false }) };
    }
    case "editText":
      return { item: {
        ...item, stem: change.stem ?? item.stem, explanation: change.explanation ?? item.explanation,
        confirmed: item.confirmed && (change.stem === undefined || change.stem === item.stem),
      } };
    case "setMatch": {
      requireOption(item, change.letter);
      if (change.letter === item.answer) throw new TaskQuizRuleError("The correct answer can't have misconceptions.");
      const listed = new Set(taskMisconceptionIds(quiz));
      if (change.ids.some((id) => !listed.has(id))) throw new TaskQuizRuleError("Pick from this task's misconceptions.");
      const match: OptionMatch = change.noMisconception
        ? { state: "no_misconception", ids: [], setBy: "teacher", confidence: null, reason: null }
        : change.ids.length ? { state: "matched", ids: change.ids, setBy: "teacher", confidence: null, reason: null } : notMatchedYet();
      return { item: withOption(item, change.letter, (option) => ({ ...option, match })) };
    }
    case "addPossibleNew":
    case "dismissPossibleNew": {
      const option = requireOption(item, change.letter);
      const suggestion = option.possibleNew.find((entry) => entry.id === change.id);
      if (!suggestion) throw new TaskQuizRuleError("That suggestion is no longer here.", 409);
      const possibleNew = option.possibleNew.filter((entry) => entry.id !== change.id);
      if (change.action === "dismissPossibleNew") return { item: withOption(item, change.letter, (current) => ({ ...current, possibleNew })) };
      if (change.letter === item.answer) throw new TaskQuizRuleError("The correct answer can't have misconceptions.");
      const ids = option.match.state === "matched" ? [...option.match.ids.filter((id) => id !== change.id), change.id] : [change.id];
      const match: OptionMatch = { state: "matched", ids, setBy: "teacher", confidence: suggestion.confidence, reason: suggestion.reason };
      return { item: withOption(item, change.letter, (current) => ({ ...current, match, possibleNew })), added: change.id };
    }
    case "confirm": {
      const problems = confirmProblems(item);
      if (problems.length) throw new TaskQuizRuleError("This item can't be confirmed yet.", 422, problems);
      return { item: { ...item, confirmed: true, answerSuggestion: null, options: item.options.map((option) => ({ ...option, possibleNew: [] })) } };
    }
  }
}

/**
 * Applies one teacher change. A confirmed item stays confirmed only if it still
 * passes the rules, and editing the question, options or answer always needs a new look.
 */
export function applyItemChange(quiz: TaskQuiz, itemId: string, change: ItemChange): TaskQuiz {
  const item = quiz.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new TaskQuizRuleError("That item is no longer in this quiz.", 404);
  const { item: changed, added } = changeItem(quiz, item, change);
  const next: TaskQuizItem = { ...changed, reviewed: true, confirmed: changed.confirmed && canConfirmItem(changed) };
  const inLesson = quiz.lesson?.misconceptions.includes(added as MisconceptionId);
  return {
    ...quiz,
    items: quiz.items.map((candidate) => (candidate.id === itemId ? next : candidate)),
    addedMisconceptions: added && !inLesson && !quiz.addedMisconceptions.includes(added) ? [...quiz.addedMisconceptions, added] : quiz.addedMisconceptions,
  };
}

/* ------------------------------------------------------------------ */
/*  What the rest of the app reads                                     */
/* ------------------------------------------------------------------ */

function confidenceItem(id: string): QuizItem {
  return { item_id: `${id}_confidence`, type: "confidence_check", stem: CONFIDENCE_STEM, options: { ...CONFIDENCE_OPTIONS } };
}

const optionTexts = (item: TaskQuizItem) => Object.fromEntries(item.options.map((option) => [option.letter, option.text.trim()]));

/**
 * The quiz in the shape the app already reads, with each item's paired
 * confidence question. Only confirmed items carry misconception matches.
 *
 * `matched_misconception` is left out when an option is "No misconception",
 * because lesson-context.ts falls back to it for any option with no match.
 */
export function quizItemsFromTaskQuiz(quiz: TaskQuiz): QuizItem[] {
  return quiz.items.flatMap((item, index) => {
    const map: Partial<Record<string, string>> = {};
    const wrong = item.confirmed ? wrongOptions(item) : [];
    for (const option of wrong) if (option.match.state === "matched" && option.match.ids.length) map[option.letter] = option.match.ids.join(", ");
    const anyNone = wrong.some((option) => option.match.state === "no_misconception");
    const matched = anyNone ? undefined : wrong.find((option) => option.match.ids.length)?.match.ids[0];
    return [
      {
        item_id: item.id, type: "multiple_choice" as const, question_number: index + 1, stem: item.stem.trim(),
        ...(item.image ? { image: item.image } : {}),
        options: optionTexts(item),
        ...(item.answer ? { correct_answer: item.answer } : {}),
        ...(matched ? { matched_misconception: matched } : {}),
        distractor_misconception_map: map, explanation: item.explanation.trim(),
      },
      confidenceItem(item.id),
    ];
  });
}

/** What a student sees: built field by field, so answer keys and misconceptions can't come along. */
export function studentQuizItems(quiz: TaskQuiz): QuizItem[] {
  return quiz.items.flatMap((item, index) => [
    {
      item_id: item.id, type: "multiple_choice" as const, question_number: index + 1, stem: item.stem.trim(),
      ...(item.image ? { image: item.image } : {}), options: optionTexts(item),
    },
    confidenceItem(item.id),
  ]);
}

export const studentQuizHeading = (quiz: TaskQuiz) => `Lesson ${quiz.lesson?.number ?? ""}: Get ready for the lesson`;

/** The task's quiz as a whole `Lesson`, for code that reads one. Includes misconceptions added for this task. */
export function lessonFromTaskQuiz(quiz: TaskQuiz): Lesson | null {
  if (!quiz.lesson) return null;
  return {
    lesson_number: quiz.lesson.number, lesson_title: quiz.lesson.title, learning_objective: quiz.lesson.objective,
    topic: quiz.lesson.topic, target_concept: quiz.lesson.targetConcept, core_ideas: [...quiz.lesson.coreIdeas],
    misconceptions: Object.fromEntries(taskMisconceptionIds(quiz).map((id) => [id, MISCONCEPTION_TEXT[id]])),
    quiz_items: quizItemsFromTaskQuiz(quiz),
  };
}

/** The lesson as the Step 1 card shows it: misconceptions by enum ID, never answer keys. */
export const lessonCard = (lesson: TaskQuizLesson) => ({
  number: lesson.number, version: lesson.version, title: lesson.title, objective: lesson.objective, coreIdeas: lesson.coreIdeas,
  misconceptions: lesson.misconceptions.map((id) => ({ id, text: MISCONCEPTION_TEXT[id] })),
});

function optionView(item: TaskQuizItem, option: TaskQuizOption) {
  const isCorrect = option.letter === item.answer;
  const { state, ids, setBy, confidence, reason } = option.match;
  return {
    letter: option.letter, text: option.text, isCorrect, tag: isCorrect ? "Correct" : null,
    match: isCorrect ? null : {
      state, setBy, confidence, reason, ids,
      label: state === "matched" ? null : state === "no_misconception" ? NO_MISCONCEPTION_LABEL : NOT_MATCHED_LABEL,
      chips: ids.map((id) => ({ id, text: MISCONCEPTION_TEXT[id] })),
      aiLine: setBy === "ai" && confidence ? `AI · ${confidence} confidence. ${reason ?? ""}`.trim() : null,
    },
    possibleNew: isCorrect ? [] : option.possibleNew.map((entry) => ({
      ...entry, text: MISCONCEPTION_TEXT[entry.id], label: `Possible new misconception: ${MISCONCEPTION_TEXT[entry.id]}`,
    })),
  };
}

function itemView(item: TaskQuizItem, index: number) {
  return {
    id: item.id, number: index + 1, origin: item.origin, stem: item.stem, image: item.image, explanation: item.explanation,
    answer: item.answer, answerSetBy: item.answerSetBy, confirmed: item.confirmed, reviewed: item.reviewed,
    pill: item.confirmed ? "Confirmed" : "Needs your review",
    noAnswerKey: item.answer ? null : "No answer key",
    answerSuggestion: !item.answer && item.answerSuggestion
      ? { ...item.answerSuggestion, label: "AI suggests this is the correct answer" }
      : null,
    canConfirm: canConfirmItem(item), confirmProblems: confirmProblems(item),
    options: item.options.map((option) => optionView(item, option)),
  };
}

/** The whole quiz for the teacher's screen. Where the uploaded file is stored stays on the server. */
export function taskQuizView(quiz: TaskQuiz) {
  const reviewed = reviewedCount(quiz);
  const detail = quiz.sourceDetail;
  const problems = publishProblems(quiz);
  const locked = quiz.status === "published";
  return {
    revision: quiz.revision, status: quiz.status, locked, lockedLabel: locked ? "Locked after publishing" : null,
    lesson: quiz.lesson ? { ...lessonCard(quiz.lesson), misconceptions: taskMisconceptions(quiz) } : null,
    anchoringPhenomenon: quiz.anchoringPhenomenon,
    source: quiz.source,
    sourceDetail: detail?.kind === "file"
      ? { kind: detail.kind, fileName: detail.fileName, fileKind: detail.fileKind, bytes: detail.bytes, at: detail.at }
      : detail,
    items: quiz.items.map(itemView),
    counts: quizCounts(quiz),
    tabStatus: quizTabStatus(quiz),
    stepStatus: stepOneStatus(quiz),
    unmatchedBanner: unmatchedBanner(quiz),
    confirmationBanner: confirmationBanner(quiz),
    publishBarCount: publishBarCount(quiz),
    canPublish: !locked && problems.length === 0,
    publishProblems: locked ? [] : problems,
    reviewedCount: reviewed,
    replacePrompt: reviewed ? replacePrompt(reviewed) : null,
    publishedAt: quiz.publishedAt, publishedBy: quiz.publishedBy,
  };
}
export type TaskQuizView = ReturnType<typeof taskQuizView>;
