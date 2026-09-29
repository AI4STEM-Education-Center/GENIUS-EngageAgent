import {
  getEngagementStrategyDescription,
  getEngagementStrategyLabel,
} from "./engagement-strategies";
import { getLesson } from "./quiz-data";
import type { Lesson } from "./types";

type StudentAnswers = Record<string, string | undefined>;

export type LessonGenerationContext = {
  lessonNumber: number;
  lessonTitle: string;
  learningObjective: string;
};

export type StrategyContext = {
  id: string;
  label: string;
  description: string;
};

export type ResolvedQuizEvidence = {
  itemId: string;
  questionNumber?: number;
  stem: string;
  selectedOption: string | null;
  selectedText: string | null;
  correctOption: string | null;
  correctText: string | null;
  isCorrect: boolean | null;
  confidenceOption: string | null;
  confidenceText: string | null;
  misconceptionCode: string | null;
  misconceptionText: string | null;
};

const splitMisconceptionCodes = (value: string | null | undefined) =>
  value
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean) ?? [];

const resolveMisconceptionText = (
  lesson: Lesson,
  misconceptionCode: string | null,
) => {
  const codes = splitMisconceptionCodes(misconceptionCode);
  if (codes.length === 0) {
    return null;
  }

  return codes
    .map((code) => lesson.misconceptions[code] ?? code)
    .join("; ");
};

const getConfidenceText = (
  lesson: Lesson,
  itemId: string,
  selectedOption: string | null,
) => {
  if (!selectedOption) {
    return null;
  }

  const confidenceItem = lesson.quiz_items.find(
    (item) => item.item_id === `${itemId}_confidence`,
  );
  if (!confidenceItem) {
    return null;
  }

  return confidenceItem.options[selectedOption] ?? null;
};

export const getLessonGenerationContext = (
  lessonNumber: number,
): LessonGenerationContext | null => {
  const lesson = getLesson(lessonNumber);
  if (!lesson) {
    return null;
  }

  return {
    lessonNumber: lesson.lesson_number,
    lessonTitle: lesson.lesson_title,
    learningObjective: lesson.learning_objective,
  };
};

export const getStrategyContext = (strategyId: string): StrategyContext => ({
  id: strategyId,
  label: getEngagementStrategyLabel(strategyId),
  description: getEngagementStrategyDescription(strategyId),
});

export const resolveQuizEvidence = (
  lessonNumber: number,
  answers: StudentAnswers,
): ResolvedQuizEvidence[] => {
  const lesson = getLesson(lessonNumber);
  if (!lesson) {
    return [];
  }

  return lesson.quiz_items
    .filter((item) => item.type === "multiple_choice")
    .map((item) => {
      const selectedOption = answers[item.item_id]?.trim().toUpperCase() ?? null;
      const correctOption = item.correct_answer?.trim().toUpperCase() ?? null;
      const confidenceOption =
        answers[`${item.item_id}_confidence`]?.trim().toUpperCase() ?? null;
      const isCorrect =
        selectedOption && correctOption
          ? selectedOption === correctOption
          : null;
      const misconceptionCode =
        selectedOption && correctOption && selectedOption !== correctOption
          ? item.distractor_misconception_map?.[selectedOption] ??
            item.matched_misconception ??
            null
          : null;

      return {
        itemId: item.item_id,
        questionNumber: item.question_number,
        stem: item.stem,
        selectedOption,
        selectedText: selectedOption ? item.options[selectedOption] ?? null : null,
        correctOption,
        correctText: correctOption ? item.options[correctOption] ?? null : null,
        isCorrect,
        confidenceOption,
        confidenceText: getConfidenceText(
          lesson,
          item.item_id,
          confidenceOption,
        ),
        misconceptionCode,
        misconceptionText: resolveMisconceptionText(lesson, misconceptionCode),
      };
    });
};
