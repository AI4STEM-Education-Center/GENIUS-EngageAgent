import type {
  Lesson,
  QuizItem,
  SurveyItem,
  SurveyResponseField,
} from "./types";

import lesson1 from "@/data/lesson1.json";
import lesson2 from "@/data/lesson2.json";
import lesson3 from "@/data/lesson3.json";
import lesson4 from "@/data/lesson4.json";
import lesson5 from "@/data/lesson5.json";
import lesson6 from "@/data/lesson6.json";
import lesson7 from "@/data/lesson7.json";
import lesson8 from "@/data/lesson8.json";

type RawQuizItem = Omit<QuizItem, "type"> & {
  type: string;
};

type RawSurveyResponseField = Omit<SurveyResponseField, "response_type"> & {
  response_type: string;
};

type RawSurveyItem = Omit<SurveyItem, "category" | "response_fields"> & {
  category: string;
  response_fields: RawSurveyResponseField[];
};

type RawLesson = Omit<Lesson, "misconceptions" | "quiz_items" | "survey_items"> & {
  misconceptions: Lesson["misconceptions"];
  quiz_items: RawQuizItem[];
  survey_items: RawSurveyItem[];
};

function normalizeQuizItemType(type: string): QuizItem["type"] {
  if (type === "multiple_choice" || type === "confidence_check") {
    return type;
  }

  throw new Error(`Unsupported quiz item type: ${type}`);
}

function normalizeQuizItem(rawItem: RawQuizItem): QuizItem {
  return {
    ...rawItem,
    type: normalizeQuizItemType(rawItem.type),
  };
}

function normalizeSurveyResponseType(
  responseType: string,
): SurveyResponseField["response_type"] {
  if (responseType === "text" || responseType === "choice") {
    return responseType;
  }

  throw new Error(`Unsupported survey response type: ${responseType}`);
}

function normalizeSurveyCategory(category: string): SurveyItem["category"] {
  if (category === "familiarity" || category === "experience_details") {
    return category;
  }

  throw new Error(`Unsupported survey category: ${category}`);
}

function normalizeSurveyItem(rawItem: RawSurveyItem): SurveyItem {
  return {
    ...rawItem,
    category: normalizeSurveyCategory(rawItem.category),
    response_fields: rawItem.response_fields.map((field) => ({
      ...field,
      response_type: normalizeSurveyResponseType(field.response_type),
    })),
  };
}

function normalizeLesson(rawLesson: RawLesson): Lesson {
  return {
    ...rawLesson,
    quiz_items: rawLesson.quiz_items.map(normalizeQuizItem),
    survey_items: rawLesson.survey_items.map(normalizeSurveyItem),
  };
}

const lessons: Lesson[] = [
  normalizeLesson(lesson1),
  normalizeLesson(lesson2),
  normalizeLesson(lesson3),
  normalizeLesson(lesson4),
  normalizeLesson(lesson5),
  normalizeLesson(lesson6),
  normalizeLesson(lesson7),
  normalizeLesson(lesson8),
];

export function getAllLessons(): Lesson[] {
  return lessons;
}

export function getLesson(lessonNumber: number): Lesson | null {
  return lessons.find((l) => l.lesson_number === lessonNumber) ?? null;
}

export function getLessonQuizItems(lessonNumber: number) {
  const lesson = getLesson(lessonNumber);
  if (!lesson) return [];
  return lesson.quiz_items;
}
