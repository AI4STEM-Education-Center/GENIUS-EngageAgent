"use client";

import { Check, X } from "lucide-react";
import type { QuizReport } from "@/lib/quiz-report";

// One student's quiz feedback report (#182), shared by the student's
// "My quiz report" tab and the teacher's preview.
export default function QuizReportView({ report, name }: { report: QuizReport; name?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-line bg-white p-5">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-faint">My quiz report · Lesson {report.lessonNumber}</p>
        <h2 className="mt-1 text-2xl font-bold">{name ? `${name}’s answers` : "Your answers"}</h2>
        <p className="mt-2 text-ink-2">{report.correct} of {report.total} correct</p>
      </div>
      <ol aria-label="Quiz questions" className="flex flex-col gap-3">
        {report.items.map((item) => (
          <li key={item.number} className="rounded-xl border border-line bg-white p-5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-line-2 text-xs font-bold text-ink-2">{item.number}</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${item.isCorrect ? "bg-ok-light text-ok" : "bg-warn-light text-warn"}`}>
                {item.isCorrect ? <Check size={13} /> : <X size={13} />}{item.isCorrect ? "Correct" : "Not quite"}
              </span>
            </div>
            <p className="mt-2 text-[15px] leading-6">{item.stem}</p>
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-mute">Your answer</dt>
              <dd>{item.answer ? `${item.answer.key}. ${item.answer.text}` : "No answer"}</dd>
              {!item.isCorrect && item.correctAnswer && <>
                <dt className="text-mute">Correct answer</dt>
                <dd className="font-semibold">{item.correctAnswer.key}. {item.correctAnswer.text}</dd>
              </>}
              {item.confidence && <><dt className="text-mute">You felt</dt><dd>{item.confidence}</dd></>}
            </dl>
            {item.explanation && <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-sm"><b>Why:</b> {item.explanation}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
