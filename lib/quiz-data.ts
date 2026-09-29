import type { Lesson, QuizItem } from "./types";

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

type RawLesson = Omit<Lesson, "misconceptions" | "quiz_items"> & {
  misconceptions: Lesson["misconceptions"];
  quiz_items: RawQuizItem[];
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
