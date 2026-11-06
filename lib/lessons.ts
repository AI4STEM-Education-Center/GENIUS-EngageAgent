/**
 * Lessons as editable, versioned records instead of JSON files (#175).
 *
 * A teacher edits a draft (`LessonDraftContent`), where anything can still be
 * blank. Publishing checks it and turns it into a read-only `Lesson`, the same
 * shape the rest of the app already reads. New lessons use the shared
 * misconception IDs (MC01...) as their codes.
 *
 * Nothing here touches storage, so it is safe to use in the browser.
 */
import {
  isMisconceptionId,
  LESSON_MISCONCEPTIONS,
  MISCONCEPTION_TEXT,
  toMisconceptionIds,
  type MisconceptionId,
} from "./misconceptions";
import type { Lesson, QuizItem } from "./types";

export const OPTION_LETTERS = ["A", "B", "C", "D"] as const;
export type OptionLetter = (typeof OPTION_LETTERS)[number];

export const MIN_QUIZ_ITEMS = 4;
export const MAX_QUIZ_ITEMS = 50;
export const MAX_CORE_IDEAS = 30;

/** The paired question students answer after each quiz item. Teachers don't edit it. */
export const CONFIDENCE_STEM = "How confident are you about your answer?";
export const CONFIDENCE_OPTIONS = { A: "Very confident", B: "Somewhat confident", C: "Not very confident", D: "Just guessing" };

export type DraftQuizItem = {
  /** Stays the same across versions, so compare can follow an item and answers keep their key. */
  id: string;
  stem: string;
  image: string | null;
  options: Record<OptionLetter, string>;
  correct: OptionLetter | null;
  matchedMisconception: MisconceptionId | null;
  /** For each wrong option: none or several of the lesson's misconceptions. */
  wrongOptionMisconceptions: Partial<Record<OptionLetter, MisconceptionId[]>>;
  explanation: string;
};

export type LessonDraftContent = {
  title: string;
  objective: string;
  topic: string;
  targetConcept: string;
  coreIdeas: string[];
  misconceptions: MisconceptionId[];
  quizItems: DraftQuizItem[];
};

export type LessonProblem = { field: string; message: string };

export const emptyLessonDraft = (): LessonDraftContent => ({
  title: "", objective: "", topic: "", targetConcept: "", coreIdeas: [], misconceptions: [], quizItems: [],
});

export const emptyDraftQuizItem = (id: string): DraftQuizItem => ({
  id, stem: "", image: null, options: { A: "", B: "", C: "", D: "" }, correct: null,
  matchedMisconception: null, wrongOptionMisconceptions: {}, explanation: "",
});

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isLetter = (value: unknown): value is OptionLetter => OPTION_LETTERS.includes(value as OptionLetter);

/** Only pictures this app serves, so a lesson can't point students at another site. */
export function isSafeLessonImage(value: string) {
  return /^\/(quiz-images|api\/lessons\/images)\/[A-Za-z0-9._-]+$/.test(value) && !value.includes("..");
}

function parseMisconceptionList(value: unknown): MisconceptionId[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  if (value.some((id) => typeof id !== "string" || !isMisconceptionId(id))) return null;
  return new Set(value).size === value.length ? (value as MisconceptionId[]) : null;
}

function parseQuizItem(input: unknown, label: string): DraftQuizItem | string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return `${label} is not valid.`;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(raw.id)) return `${label} has an invalid id.`;
  if (!isText(raw.stem, 2000)) return `${label}: question is too long.`;
  if (!isText(raw.explanation, 4000)) return `${label}: explanation is too long.`;
  if (raw.image !== null && (typeof raw.image !== "string" || !isSafeLessonImage(raw.image))) return `${label}: image is not valid.`;
  if (raw.correct !== null && !isLetter(raw.correct)) return `${label}: correct answer must be A, B, C, or D.`;
  if (raw.matchedMisconception !== null && (typeof raw.matchedMisconception !== "string" || !isMisconceptionId(raw.matchedMisconception))) {
    return `${label}: matched misconception is not on the list.`;
  }
  const options = raw.options as Record<string, unknown> | null;
  if (!options || typeof options !== "object" || Array.isArray(options)) return `${label}: options are not valid.`;
  if (Object.keys(options).some((key) => !isLetter(key))) return `${label}: options must be A, B, C, and D.`;
  if (OPTION_LETTERS.some((letter) => !isText(options[letter], 1000))) return `${label}: each option must be text under 1000 characters.`;
  const map = raw.wrongOptionMisconceptions as Record<string, unknown> | null;
  if (!map || typeof map !== "object" || Array.isArray(map)) return `${label}: option misconceptions are not valid.`;
  const wrongOptionMisconceptions: DraftQuizItem["wrongOptionMisconceptions"] = {};
  for (const [letter, ids] of Object.entries(map)) {
    const parsed = parseMisconceptionList(ids);
    if (!isLetter(letter) || !parsed) return `${label}: option misconceptions are not valid.`;
    if (parsed.length) wrongOptionMisconceptions[letter] = parsed;
  }
  return {
    id: raw.id, stem: raw.stem, image: raw.image as string | null,
    options: { A: options.A as string, B: options.B as string, C: options.C as string, D: options.D as string },
    correct: raw.correct as OptionLetter | null,
    matchedMisconception: raw.matchedMisconception as MisconceptionId | null,
    wrongOptionMisconceptions, explanation: raw.explanation,
  };
}

/**
 * Checks a draft sent by the client. It only checks the shape, because a draft
 * can be unfinished; `lessonProblems` decides whether it can be published.
 */
export function parseLessonDraft(input: unknown): { draft: LessonDraftContent } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Lesson must be an object." };
  const raw = input as Record<string, unknown>;
  if (!isText(raw.title, 200)) return { error: "Lesson title must be text under 200 characters." };
  if (!isText(raw.objective, 2000)) return { error: "Learning objective must be text under 2000 characters." };
  if (!isText(raw.topic, 300)) return { error: "Topic must be text under 300 characters." };
  if (!isText(raw.targetConcept, 300)) return { error: "Target concept must be text under 300 characters." };
  if (!Array.isArray(raw.coreIdeas) || raw.coreIdeas.length > MAX_CORE_IDEAS || raw.coreIdeas.some((idea) => !isText(idea, 1000))) {
    return { error: `Core ideas must be a list of up to ${MAX_CORE_IDEAS} short texts.` };
  }
  const misconceptions = parseMisconceptionList(raw.misconceptions);
  if (!misconceptions) return { error: "Misconceptions must come from the list, with no repeats." };
  if (!Array.isArray(raw.quizItems) || raw.quizItems.length > MAX_QUIZ_ITEMS) return { error: `Add up to ${MAX_QUIZ_ITEMS} quiz items.` };
  const quizItems: DraftQuizItem[] = [];
  for (const [index, item] of raw.quizItems.entries()) {
    const parsed = parseQuizItem(item, `Q${index + 1}`);
    if (typeof parsed === "string") return { error: parsed };
    quizItems.push(parsed);
  }
  if (new Set(quizItems.map((item) => item.id)).size !== quizItems.length) return { error: "Quiz item ids must not repeat." };
  return {
    draft: {
      title: raw.title, objective: raw.objective, topic: raw.topic, targetConcept: raw.targetConcept,
      coreIdeas: raw.coreIdeas as string[], misconceptions, quizItems,
    },
  };
}

/** Everything stopping a draft from being published. Empty means it's ready. */
export function lessonProblems(draft: LessonDraftContent): LessonProblem[] {
  const problems: LessonProblem[] = [];
  const need = (value: string, field: string, message: string) => {
    if (!value.trim()) problems.push({ field, message });
  };
  need(draft.title, "title", "Lesson title is required");
  need(draft.objective, "objective", "Learning objective is required");
  need(draft.topic, "topic", "Topic is required");
  need(draft.targetConcept, "targetConcept", "Target concept is required");
  if (!draft.coreIdeas.some((idea) => idea.trim())) problems.push({ field: "coreIdeas", message: "Add at least one core idea" });
  if (!draft.misconceptions.length) problems.push({ field: "misconceptions", message: "Add at least one misconception" });
  if (draft.quizItems.length < MIN_QUIZ_ITEMS) problems.push({ field: "quizItems", message: "Add at least four quiz items" });

  const inLesson = new Set(draft.misconceptions);
  draft.quizItems.forEach((item, index) => {
    const q = `Q${index + 1}`;
    const at = (name: string) => `quizItems.${index}.${name}`;
    need(item.stem, at("stem"), `${q}: question is required`);
    for (const letter of OPTION_LETTERS) need(item.options[letter], at(`options.${letter}`), `${q}: option ${letter} is required`);
    const filled = OPTION_LETTERS.map((letter) => item.options[letter].trim().toLowerCase()).filter(Boolean);
    if (new Set(filled).size !== filled.length) problems.push({ field: at("options"), message: `${q}: options must be different` });
    if (!item.correct || !item.options[item.correct].trim()) {
      problems.push({ field: at("correct"), message: `${q}: correct answer is not one of the options` });
    }
    if (!item.matchedMisconception || !inLesson.has(item.matchedMisconception)) {
      problems.push({ field: at("matchedMisconception"), message: `${q}: matched misconception must be one of this lesson's misconceptions` });
    }
    for (const letter of OPTION_LETTERS) {
      const ids = item.wrongOptionMisconceptions[letter] ?? [];
      if (letter === item.correct && ids.length) {
        problems.push({ field: at(`wrongOptionMisconceptions.${letter}`), message: `${q}: the correct answer can't have misconceptions` });
      }
      if (ids.some((id) => !inLesson.has(id))) {
        problems.push({ field: at(`wrongOptionMisconceptions.${letter}`), message: `${q}: option ${letter} uses a misconception that isn't in this lesson` });
      }
    }
    need(item.explanation, at("explanation"), `${q}: explanation is required`);
  });
  return problems;
}

/** The read-only lesson a checked draft becomes. Students' confidence questions are added here. */
export function lessonFromDraft(draft: LessonDraftContent, lessonNumber: number): Lesson {
  const quizItems: QuizItem[] = draft.quizItems.flatMap((item, index) => {
    const map: Partial<Record<string, string>> = {};
    for (const letter of OPTION_LETTERS) {
      const ids = item.wrongOptionMisconceptions[letter];
      // Same form as the lesson files: several codes are written "MC01, MC02".
      if (ids?.length && letter !== item.correct) map[letter] = ids.join(", ");
    }
    const options = Object.fromEntries(OPTION_LETTERS.map((letter) => [letter, item.options[letter].trim()]));
    return [
      {
        item_id: item.id, type: "multiple_choice" as const, question_number: index + 1, stem: item.stem.trim(),
        ...(item.image ? { image: item.image } : {}),
        options, correct_answer: item.correct ?? undefined, matched_misconception: item.matchedMisconception ?? undefined,
        distractor_misconception_map: map, explanation: item.explanation.trim(),
      },
      { item_id: `${item.id}_confidence`, type: "confidence_check" as const, stem: CONFIDENCE_STEM, options: { ...CONFIDENCE_OPTIONS } },
    ];
  });
  return {
    lesson_number: lessonNumber, lesson_title: draft.title.trim(), learning_objective: draft.objective.trim(),
    topic: draft.topic.trim(), target_concept: draft.targetConcept.trim(),
    core_ideas: draft.coreIdeas.map((idea) => idea.trim()).filter(Boolean),
    misconceptions: Object.fromEntries(draft.misconceptions.map((id) => [id, MISCONCEPTION_TEXT[id]])),
    quiz_items: quizItems,
  };
}

/** The ID behind one of a lesson's codes. Older lessons use their own codes; newer ones use the ID itself. */
const misconceptionIdOf = (lessonNumber: number, code: string): MisconceptionId | null =>
  LESSON_MISCONCEPTIONS[lessonNumber]?.[code] ?? (isMisconceptionId(code) ? code : null);

/** Opens a published lesson for editing, or for comparing with another version. */
export function draftFromLesson(lesson: Lesson): LessonDraftContent {
  const n = lesson.lesson_number;
  const misconceptions = [...new Set(Object.keys(lesson.misconceptions).map((code) => misconceptionIdOf(n, code)))]
    .filter((id): id is MisconceptionId => id !== null);
  return {
    title: lesson.lesson_title, objective: lesson.learning_objective, topic: lesson.topic ?? "", targetConcept: lesson.target_concept ?? "",
    coreIdeas: [...lesson.core_ideas], misconceptions,
    quizItems: lesson.quiz_items.filter((item) => item.type === "multiple_choice").map((item) => {
      const wrongOptionMisconceptions: DraftQuizItem["wrongOptionMisconceptions"] = {};
      for (const letter of OPTION_LETTERS) {
        const ids = toMisconceptionIds(n, item.distractor_misconception_map?.[letter]);
        if (ids.length && letter !== item.correct_answer) wrongOptionMisconceptions[letter] = ids;
      }
      return {
        id: item.item_id, stem: item.stem, image: item.image ?? null,
        options: { A: item.options.A ?? "", B: item.options.B ?? "", C: item.options.C ?? "", D: item.options.D ?? "" },
        correct: isLetter(item.correct_answer) ? item.correct_answer : null,
        matchedMisconception: toMisconceptionIds(n, item.matched_misconception)[0] ?? null,
        wrongOptionMisconceptions, explanation: item.explanation ?? "",
      };
    }),
  };
}

export type FieldChange = { field: string; before: string; after: string };
export type LessonChanges = {
  basics: FieldChange[];
  coreIdeas: { added: string[]; removed: string[]; changed: { before: string; after: string }[]; reordered: boolean };
  misconceptions: { added: MisconceptionId[]; removed: MisconceptionId[] };
  quizItems: {
    added: { id: string; number: number; stem: string }[];
    removed: { id: string; stem: string }[];
    changed: { id: string; number: number; stem: string; changes: FieldChange[] }[];
    reordered: boolean;
  };
  hasChanges: boolean;
};

const ids = (list: readonly string[] | undefined) => (list?.length ? list.join(", ") : "None");

function itemChanges(before: DraftQuizItem, after: DraftQuizItem): FieldChange[] {
  const changes: FieldChange[] = [];
  const add = (field: string, a: string, b: string) => { if (a !== b) changes.push({ field, before: a, after: b }); };
  add("Question", before.stem, after.stem);
  add("Image", before.image ?? "None", after.image ?? "None");
  for (const letter of OPTION_LETTERS) add(`Option ${letter}`, before.options[letter], after.options[letter]);
  add("Correct answer", before.correct ?? "None", after.correct ?? "None");
  add("Matched misconception", before.matchedMisconception ?? "None", after.matchedMisconception ?? "None");
  for (const letter of OPTION_LETTERS) {
    add(`Option ${letter} misconceptions`, ids(before.wrongOptionMisconceptions[letter]), ids(after.wrongOptionMisconceptions[letter]));
  }
  add("Explanation", before.explanation, after.explanation);
  return changes;
}

/** A field-by-field list of what changed between two versions of a lesson. */
export function compareLessons(before: LessonDraftContent, after: LessonDraftContent): LessonChanges {
  const basics: FieldChange[] = [];
  for (const [field, a, b] of [
    ["Lesson title", before.title, after.title], ["Learning objective", before.objective, after.objective],
    ["Topic", before.topic, after.topic], ["Target concept", before.targetConcept, after.targetConcept],
  ] as const) {
    if (a !== b) basics.push({ field, before: a, after: b });
  }

  const oldIdeas = before.coreIdeas.filter((idea) => idea.trim()), newIdeas = after.coreIdeas.filter((idea) => idea.trim());
  const removedIdeas = oldIdeas.filter((idea) => !newIdeas.includes(idea)), addedIdeas = newIdeas.filter((idea) => !oldIdeas.includes(idea));
  // A removed idea and an added idea at the same spot in the two leftovers read as an edit.
  const pairs = Math.min(removedIdeas.length, addedIdeas.length);
  const kept = oldIdeas.filter((idea) => newIdeas.includes(idea));

  const oldItems = new Map(before.quizItems.map((item) => [item.id, item]));
  const newIds = new Set(after.quizItems.map((item) => item.id));
  const keptItemOrder = before.quizItems.map((item) => item.id).filter((id) => newIds.has(id));
  const added: LessonChanges["quizItems"]["added"] = [], changed: LessonChanges["quizItems"]["changed"] = [];
  after.quizItems.forEach((item, index) => {
    const old = oldItems.get(item.id);
    if (!old) { added.push({ id: item.id, number: index + 1, stem: item.stem }); return; }
    const changes = itemChanges(old, item);
    if (changes.length) changed.push({ id: item.id, number: index + 1, stem: item.stem, changes });
  });

  const result: LessonChanges = {
    basics,
    coreIdeas: {
      added: addedIdeas.slice(pairs), removed: removedIdeas.slice(pairs),
      changed: removedIdeas.slice(0, pairs).map((idea, index) => ({ before: idea, after: addedIdeas[index] })),
      reordered: kept.join("\n") !== newIdeas.filter((idea) => oldIdeas.includes(idea)).join("\n"),
    },
    misconceptions: {
      added: after.misconceptions.filter((id) => !before.misconceptions.includes(id)),
      removed: before.misconceptions.filter((id) => !after.misconceptions.includes(id)),
    },
    quizItems: {
      added, changed, removed: before.quizItems.filter((item) => !newIds.has(item.id)).map((item) => ({ id: item.id, stem: item.stem })),
      reordered: keptItemOrder.join("\n") !== after.quizItems.map((item) => item.id).filter((id) => oldItems.has(id)).join("\n"),
    },
    hasChanges: false,
  };
  const { coreIdeas: c, misconceptions: m, quizItems: q } = result;
  result.hasChanges = Boolean(
    basics.length || c.added.length || c.removed.length || c.changed.length || c.reordered || m.added.length || m.removed.length
    || q.added.length || q.removed.length || q.changed.length || q.reordered,
  );
  return result;
}
