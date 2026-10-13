import type { Lesson, QuizItem, SurveyResponseField } from "./types";

import lesson1 from "@/data/lesson1.json";
import lesson2 from "@/data/lesson2.json";
import lesson3 from "@/data/lesson3.json";
import lesson4 from "@/data/lesson4.json";
import lesson5 from "@/data/lesson5.json";
import lesson6 from "@/data/lesson6.json";
import lesson7 from "@/data/lesson7.json";
import lesson8 from "@/data/lesson8.json";

type RawQuizItem = Omit<QuizItem, "type" | "response_fields" | "options"> & {
  type: string;
  options: Record<string, string | undefined>;
  response_fields?: Array<Omit<SurveyResponseField, "response_type" | "text_length"> & {
    response_type: string;
    text_length?: string;
  }>;
};

type RawLesson = Omit<Lesson, "misconceptions" | "quiz_items"> & {
  misconceptions: Lesson["misconceptions"];
  quiz_items: RawQuizItem[];
};

function normalizeQuizItemType(type: string): QuizItem["type"] {
  if (type === "multiple_choice" || type === "confidence_check" || type === "experience") {
    return type;
  }

  throw new Error(`Unsupported quiz item type: ${type}`);
}

function normalizeQuizItem(rawItem: RawQuizItem): QuizItem {
  const { response_fields, ...item } = rawItem;
  return {
    ...item,
    type: normalizeQuizItemType(rawItem.type),
    options: Object.fromEntries(
      Object.entries(item.options).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    ...(response_fields ? {
      response_fields: response_fields.map((field) => {
        if (field.response_type !== "text" && field.response_type !== "choice") {
          throw new Error(`Unsupported response field type: ${field.response_type}`);
        }
        if (field.text_length && field.text_length !== "short" && field.text_length !== "long") {
          throw new Error(`Unsupported response text length: ${field.text_length}`);
        }
        return {
          ...field,
          response_type: field.response_type,
          text_length: field.text_length as SurveyResponseField["text_length"],
        };
      }),
    } : {}),
  };
}

function normalizeLesson(rawLesson: RawLesson): Lesson {
  return {
    ...rawLesson,
    quiz_items: rawLesson.quiz_items.map(normalizeQuizItem),
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
