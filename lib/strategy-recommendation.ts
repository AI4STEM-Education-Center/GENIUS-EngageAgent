import { getEngagementStrategyLabel } from "./engagement-strategies";
import { getLesson } from "./quiz-data";
import type { Lesson, QuizItem } from "./types";

/**
 * Class-level strategy recommendation rule (decision rule v1).
 *
 * For one class section and one lesson, the rule returns exactly one strategy
 * from the class's answers to the lesson's multiple-choice quiz items:
 *
 *   Step 1  accuracy > 70%                                  -> engaged critiquing
 *   Step 2  one misconception behind > 25% of wrong answers -> cognitive conflict
 *   Step 3  lesson analogy label is "recommend"             -> analogy
 *           otherwise                                       -> experience bridging
 *
 * Every comparison uses whole-number counts (10·C > 7·R and 4·k > E), so
 * rounding never changes a result. Option-to-misconception labels come from the
 * lesson data (`distractor_misconception_map`). Blank answers, and anything
 * that is not exactly one of the item's option letters, count as incorrect and
 * are not linked to any misconception.
 *
 * This module only computes; nothing in the app calls it yet.
 */

export type RecommendedStrategy =
  | "engaged critiquing"
  | "cognitive conflict"
  | "analogy"
  | "experience bridging";

export type AnalogyLabel = "recommend" | "not recommend";

/**
 * Each lesson's core ideas, split by their analogy label from the LLM rubric
 * run on the curriculum ("highly recommended" and "consider analogy" count as
 * recommend). Lesson 6 has no core ideas of its own; it uses the five core
 * ideas it applies: forces 5.1, energy transfer 2.3, peak force 5.2, elastic
 * limit 4.2, breaking point 4.3.
 */
export const LESSON_ANALOGY_CORE_IDEAS: Record<
  number,
  { recommend: string[]; notRecommend: string[] }
> = {
  1: { recommend: [], notRecommend: ["1.1", "1.2"] },
  2: { recommend: ["2.1", "2.3", "2.4"], notRecommend: ["2.2"] },
  3: { recommend: ["3.1"], notRecommend: [] },
  4: { recommend: ["4.1"], notRecommend: ["4.2", "4.3", "4.4"] },
  5: { recommend: ["5.1", "5.2", "5.4"], notRecommend: ["5.3"] },
  6: { recommend: ["5.1", "2.3", "5.2"], notRecommend: ["4.2", "4.3"] },
  7: { recommend: ["7.2", "7.3"], notRecommend: ["7.1"] },
  8: { recommend: ["8.3", "8.4"], notRecommend: ["8.1", "8.2"] },
};

/**
 * Misconception IDs merged for counting: an answer labeled with the key counts
 * toward the value. Lesson 5's 2-a (peak force) is the same belief as 1-a.
 */
export const MERGED_MISCONCEPTIONS: Record<number, Record<string, string>> = {
  5: { "2-a": "1-a" },
};

export type QuizSubmission = Record<string, string | undefined>;

export type MisconceptionCount = {
  id: string;
  statement: string;
  count: number;
};

export type ClassQuizCounts = {
  lessonNumber: number;
  /** N: students who submitted the quiz. */
  students: number;
  /** R: N times the number of multiple-choice items. */
  responses: number;
  /** C */
  correct: number;
  /** E = R - C */
  incorrect: number;
  /** k(m) for every misconception in the lesson's list, in list order. */
  misconceptions: MisconceptionCount[];
  /** U: incorrect answers linked to no misconception (unlabeled options, blanks). */
  unlinked: number;
};

export type StrategyRecommendation = {
  lessonNumber: number;
  strategy: RecommendedStrategy;
  decidedAtStep: 1 | 2 | 3;
  counts: ClassQuizCounts;
  analogyLabel: AnalogyLabel;
  /** Cognitive conflict only: every misconception tied for the largest count. */
  targetCandidates: MisconceptionCount[];
  /** Cognitive conflict with one candidate; null when the teacher must choose among ties. */
  target: MisconceptionCount | null;
};

export function getLessonAnalogyLabel(lessonNumber: number): AnalogyLabel {
  const coreIdeas = LESSON_ANALOGY_CORE_IDEAS[lessonNumber];
  if (!coreIdeas) {
    throw new Error(`No analogy label is defined for lesson ${lessonNumber}.`);
  }
  const total = coreIdeas.recommend.length + coreIdeas.notRecommend.length;
  // Strict majority: exactly half is "not recommend".
  return coreIdeas.recommend.length * 2 > total ? "recommend" : "not recommend";
}

export function getMultipleChoiceItems(lesson: Lesson): QuizItem[] {
  return lesson.quiz_items.filter((item) => item.type === "multiple_choice");
}

function getCountedMisconceptionIds(lesson: Lesson): string[] {
  const merged = MERGED_MISCONCEPTIONS[lesson.lesson_number] ?? {};
  return Object.keys(lesson.misconceptions).filter((id) => !(id in merged));
}

/**
 * The single misconception an option counts toward, or null if the option is
 * unlabeled. Throws if the lesson data breaks the one-label-per-option rule.
 */
export function resolveOptionMisconception(
  lesson: Lesson,
  item: QuizItem,
  option: string,
): string | null {
  const rawLabel = item.distractor_misconception_map?.[option];
  if (!rawLabel) {
    return null;
  }
  const merged = MERGED_MISCONCEPTIONS[lesson.lesson_number] ?? {};
  const ids = Array.from(
    new Set(
      rawLabel
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((id) => merged[id] ?? id),
    ),
  );
  if (ids.length !== 1) {
    throw new Error(
      `${item.item_id} option ${option} maps to ${ids.length} misconceptions; the rule allows exactly one.`,
    );
  }
  const [id] = ids;
  if (!(id in lesson.misconceptions)) {
    throw new Error(`${item.item_id} option ${option} maps to unknown misconception "${id}".`);
  }
  return id;
}

export function countClassResponses(lesson: Lesson, submissions: QuizSubmission[]): ClassQuizCounts {
  if (submissions.length === 0) {
    throw new Error("The rule needs at least one submitted quiz (N >= 1).");
  }
  const items = getMultipleChoiceItems(lesson);
  if (items.length === 0) {
    throw new Error(`Lesson ${lesson.lesson_number} has no multiple-choice items.`);
  }

  const countedIds = getCountedMisconceptionIds(lesson);
  const countById = new Map<string, number>(countedIds.map((id) => [id, 0]));
  let correct = 0;

  for (const submission of submissions) {
    for (const item of items) {
      const answer = submission[item.item_id];
      if (typeof answer !== "string" || !Object.prototype.hasOwnProperty.call(item.options, answer)) {
        // Blank, or not exactly one of this item's option letters: incorrect, not linked.
        continue;
      }
      if (answer === item.correct_answer) {
        correct += 1;
        continue;
      }
      const id = resolveOptionMisconception(lesson, item, answer);
      if (id !== null) {
        countById.set(id, (countById.get(id) ?? 0) + 1);
      }
    }
  }

  const responses = submissions.length * items.length;
  const incorrect = responses - correct;
  const misconceptions = countedIds.map((id) => ({
    id,
    statement: lesson.misconceptions[id],
    count: countById.get(id) ?? 0,
  }));
  const linked = misconceptions.reduce((sum, misconception) => sum + misconception.count, 0);

  return {
    lessonNumber: lesson.lesson_number,
    students: submissions.length,
    responses,
    correct,
    incorrect,
    misconceptions,
    unlinked: incorrect - linked,
  };
}

export function recommendStrategy(
  lessonNumber: number,
  submissions: QuizSubmission[],
): StrategyRecommendation {
  const lesson = getLesson(lessonNumber);
  if (!lesson) {
    throw new Error(`Unknown lesson ${lessonNumber}.`);
  }
  const counts = countClassResponses(lesson, submissions);
  const analogyLabel = getLessonAnalogyLabel(lessonNumber);

  // Step 1: accuracy above 70%.
  if (10 * counts.correct > 7 * counts.responses) {
    return {
      lessonNumber,
      strategy: "engaged critiquing",
      decidedAtStep: 1,
      counts,
      analogyLabel,
      targetCandidates: [],
      target: null,
    };
  }

  // Step 2: the most frequent misconception accounts for more than 25% of incorrect answers.
  const maxCount = counts.misconceptions.reduce(
    (max, misconception) => Math.max(max, misconception.count),
    0,
  );
  if (4 * maxCount > counts.incorrect) {
    const targetCandidates = counts.misconceptions.filter(
      (misconception) => misconception.count === maxCount,
    );
    return {
      lessonNumber,
      strategy: "cognitive conflict",
      decidedAtStep: 2,
      counts,
      analogyLabel,
      targetCandidates,
      target: targetCandidates.length === 1 ? targetCandidates[0] : null,
    };
  }

  // Step 3: the lesson's analogy label.
  return {
    lessonNumber,
    strategy: analogyLabel === "recommend" ? "analogy" : "experience bridging",
    decidedAtStep: 3,
    counts,
    analogyLabel,
    targetCandidates: [],
    target: null,
  };
}

/**
 * The cognitive conflict target: the single candidate, or the teacher's choice
 * among tied candidates. Returns null for other strategies, and for an
 * unresolved tie when no choice is given.
 */
export function resolveCognitiveConflictTarget(
  recommendation: StrategyRecommendation,
  teacherChoice?: string,
): MisconceptionCount | null {
  if (recommendation.strategy !== "cognitive conflict") {
    return null;
  }
  if (teacherChoice === undefined) {
    return recommendation.target;
  }
  const chosen = recommendation.targetCandidates.find(
    (misconception) => misconception.id === teacherChoice,
  );
  if (!chosen) {
    throw new Error(`Misconception "${teacherChoice}" is not a target candidate for this class.`);
  }
  return chosen;
}

/** A percentage with one decimal place, rounded half up (display only). */
export function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    throw new Error("A percentage needs a positive denominator.");
  }
  const tenths = Math.floor((2000 * numerator + denominator) / (2 * denominator));
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/** The "Incorrect responses" line and every line under it. */
export function buildErrorLines(counts: ClassQuizCounts): string[] {
  const lines = [`Incorrect responses: ${counts.incorrect}`];
  if (counts.incorrect === 0) {
    return lines;
  }
  const withAnswers = counts.misconceptions
    .map((misconception, index) => ({ misconception, index }))
    .filter(({ misconception }) => misconception.count > 0)
    .sort((a, b) => b.misconception.count - a.misconception.count || a.index - b.index);
  for (const { misconception } of withAnswers) {
    lines.push(
      `  ${misconception.id}) ${misconception.statement}: ${misconception.count} of ${counts.incorrect} (${formatPercent(misconception.count, counts.incorrect)})`,
    );
  }
  if (counts.unlinked > 0) {
    lines.push(
      `  Not linked to a listed misconception: ${counts.unlinked} of ${counts.incorrect} (${formatPercent(counts.unlinked, counts.incorrect)})`,
    );
  }
  return lines;
}

export function buildLearnerSummary(
  recommendation: StrategyRecommendation,
  teacherChoice?: string,
): string {
  const { counts } = recommendation;
  const lines = [
    `Lesson: L${counts.lessonNumber} · Students: ${counts.students} · Responses: ${counts.responses}`,
    `Class accuracy: ${formatPercent(counts.correct, counts.responses)} (${counts.correct} of ${counts.responses} correct; blanks count as incorrect)`,
    ...buildErrorLines(counts),
    `Recommended strategy: ${getEngagementStrategyLabel(recommendation.strategy)}`,
  ];
  if (recommendation.strategy === "cognitive conflict") {
    const target = resolveCognitiveConflictTarget(recommendation, teacherChoice);
    if (target) {
      lines.push(`Target misconception: ${target.id}) ${target.statement}`);
    } else {
      const tied = recommendation.targetCandidates
        .map((misconception) => `${misconception.id}) ${misconception.statement}`)
        .join("; ");
      lines.push(`Target misconception (teacher chooses one): ${tied}`);
    }
  }
  return lines.join("\n");
}

function formatQuizItems(lesson: Lesson): string {
  return getMultipleChoiceItems(lesson)
    .map((item, index) => {
      const lines = [`Q${item.question_number ?? index + 1}. ${item.stem}`];
      for (const [option, text] of Object.entries(item.options)) {
        if (option === item.correct_answer) {
          lines.push(`${option}. ${text} (correct)`);
          continue;
        }
        const id = resolveOptionMisconception(lesson, item, option);
        lines.push(
          id === null
            ? `${option}. ${text}`
            : `${option}. ${text} [misconception ${id}: ${lesson.misconceptions[id]}]`,
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Values for the student-related variables of the chosen strategy's generation
 * prompt, keyed by variable name without brackets. Curricular variables and
 * the Experience Bridging [LEARNER_CONTEXT] are filled elsewhere.
 */
export function buildPromptVariables(
  recommendation: StrategyRecommendation,
  teacherChoice?: string,
): Record<string, string> {
  const lesson = getLesson(recommendation.lessonNumber);
  if (!lesson) {
    throw new Error(`Unknown lesson ${recommendation.lessonNumber}.`);
  }
  const variables: Record<string, string> = {
    CURRENT_UNDERSTANDING: buildLearnerSummary(recommendation, teacherChoice),
  };
  const errorLines = buildErrorLines(recommendation.counts).join("\n");

  switch (recommendation.strategy) {
    case "cognitive conflict": {
      const target = resolveCognitiveConflictTarget(recommendation, teacherChoice);
      if (!target) {
        throw new Error("Several misconceptions are tied; the teacher must choose the target first.");
      }
      variables.SELECTED_STRATEGY = "Cognitive Conflict";
      variables.MISCONCEPTION_OR_GAP = target.statement;
      break;
    }
    case "analogy":
      variables.MISCONCEPTION_OR_GAP = `No misconception accounts for more than 25% of incorrect responses.\n${errorLines}`;
      break;
    case "experience bridging":
      variables.KNOWLEDGE_GAP = `No misconception accounts for more than 25% of incorrect responses.\n${errorLines}`;
      break;
    case "engaged critiquing":
      variables.MISCONCEPTION_OR_GAP = `Accuracy is above 70%.\n${errorLines}`;
      variables.QUIZ_ITEMS = formatQuizItems(lesson);
      break;
  }
  return variables;
}
