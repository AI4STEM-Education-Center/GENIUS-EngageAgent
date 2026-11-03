"use client";

import type { QuestionBoard } from "@/lib/class-questions";

// The student's "Class questions" tab (#182): the board the teacher
// published, grouped by theme, without names.
export default function StudentClassQuestions({ board }: { board: QuestionBoard }) {
  const themes = [...new Set(board.questions.map((q) => q.theme))];
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-white p-5">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-faint">Class Question Board</p>
        <h2 className="mt-1 text-2xl font-bold">Questions we’ll explore together</h2>
      </div>
      {themes.map((theme) => (
        <section key={theme || "questions"} aria-label={theme || "Questions"}>
          {theme && <h3 className="mb-2 font-semibold">{theme}</h3>}
          <ul className="grid gap-3 sm:grid-cols-2">
            {board.questions.filter((q) => q.theme === theme).map((q) => (
              <li key={q.id} className="rounded-lg border border-warn/20 bg-warn-light/60 p-3.5 text-[15px] leading-6">{q.text}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
