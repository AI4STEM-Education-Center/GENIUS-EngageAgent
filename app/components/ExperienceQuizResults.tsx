"use client";

import { useState } from "react";
import { getLesson } from "@/lib/quiz-data";
import type { StudentAnswer } from "@/lib/types";

type Props = {
  lessonNumber: number | null;
  answers: StudentAnswer[];
};

/** Written experience responses stay with their quiz submission, without a score. */
export default function ExperienceQuizResults({ lessonNumber, answers }: Props) {
  const [selectedStudent, setSelectedStudent] = useState("");
  const lesson = lessonNumber ? getLesson(lessonNumber) : null;
  const questions = lesson?.quiz_items.filter((item) => item.type === "experience") ?? [];
  const submissions = answers.filter((submission) => submission.lesson_number === lessonNumber
    && questions.some((question) => question.response_fields?.some((field) => submission.answers[field.field_id]?.trim())));
  const submission = submissions.find((entry) => entry.student_id === selectedStudent) ?? submissions[0];

  // Legacy quiz-only records remain valid and are shown in the quiz summary.
  if (!submission || questions.length === 0) return null;

  return (
    <section aria-label="Experience responses" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Experience responses</h2>
          <p className="mt-1 text-sm text-slate-500">Written answers and confidence collected with the quiz. These questions are not graded.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {submissions.length} {submissions.length === 1 ? "student" : "students"}
        </span>
      </div>
      <label className="mt-4 block text-sm font-semibold text-slate-700">
        Student
        <select
          aria-label="Student experience responses"
          value={submission.student_id}
          onChange={(event) => setSelectedStudent(event.target.value)}
          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal sm:w-auto sm:min-w-64"
        >
          {submissions.map((entry) => <option key={entry.student_id} value={entry.student_id}>{entry.student_name}</option>)}
        </select>
      </label>
      <div className="mt-4 grid gap-4">
        {questions.map((question) => {
          const confidenceItem = lesson?.quiz_items.find((item) => item.item_id === `${question.item_id}_confidence`);
          const confidenceValue = confidenceItem ? submission.answers[confidenceItem.item_id] : undefined;
          const confidence = confidenceValue ? confidenceItem?.options[confidenceValue] : undefined;
          return (
            <div key={question.item_id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-800">{question.question_number}. {question.stem}</h3>
              <dl className="mt-3 space-y-2">
                {(question.response_fields ?? []).map((field) => <div key={field.field_id}>
                  <dt className="text-xs font-semibold text-slate-500">{field.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
                    {submission.answers[field.field_id]?.trim() || "No response recorded."}
                  </dd>
                </div>)}
              </dl>
              <p className="mt-3 text-xs text-slate-600"><span className="font-semibold">Confidence:</span> {confidence ?? "Not recorded"}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
