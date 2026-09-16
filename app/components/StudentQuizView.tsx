"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserContext } from "@/lib/auth";
import { findExistingStudentAnswer } from "@/lib/student-answer-lookup";
import type { QuizItem } from "@/lib/types";
import type { StepProgress } from "@/lib/student-progress";

type Props = {
  user: UserContext;
  onProgress?: (progress: StepProgress) => void;
};

type QuizStatusData = {
  lesson_number: number;
  status: "draft" | "published" | "closed";
};

export const notifyQuizSubmitted = (classId: string, assignmentId: string, geniusId: string) => {
  if (typeof window === "undefined" || window.parent === window) return;

  window.parent.postMessage(
    {
      type: "engage-agent.quiz-submitted",
      classId,
      assignmentId,
      geniusId,
    },
    "*",
  );
};

export default function StudentQuizView({ user, onProgress }: Props) {
  const [quizStatus, setQuizStatus] = useState<QuizStatusData | null>(null);
  const [questions, setQuestions] = useState<QuizItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [existingAnswers, setExistingAnswers] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const classId = user.classId;
  const assignmentId = user.assignmentId;

  const loadQuiz = useCallback(async () => {
    if (!classId || !assignmentId) {
      setError("Missing class or assignment context.");
      setLoading(false);
      return;
    }

    try {
      // Fetch quiz status
      const statusRes = await fetch(
        `/api/quiz-status?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`,
      );
      const statusData = await statusRes.json().catch(() => ({}));

      if (!statusRes.ok) {
        throw new Error(
          (statusData as { error?: string }).error ?? "Failed to load quiz status.",
        );
      }

      const qs = (statusData as { quizStatus?: QuizStatusData | null }).quizStatus ?? null;

      if (!qs || qs.status !== "published") {
        setQuizStatus(qs);
        setLoading(false);
        return;
      }

      setQuizStatus(qs);

      // Fetch quiz questions from lesson data
      const lessonRes = await fetch(`/api/lessons/${qs.lesson_number}`);
      const lessonData = await lessonRes.json();
      setQuestions(lessonData.quiz_items ?? []);

      const existingAnswer = await findExistingStudentAnswer({
        classId,
        assignmentId,
        lessonNumber: qs.lesson_number,
        userId: user.userId,
        email: user.email,
      });
      if (existingAnswer) {
        setExistingAnswers(existingAnswer.answer.answers);
        setAnswers(existingAnswer.answer.answers);
        setSubmitted(true);
        notifyQuizSubmitted(classId, assignmentId, user.geniusId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quiz.");
    } finally {
      setLoading(false);
    }
  }, [classId, assignmentId, user.geniusId, user.userId, user.email]);

  useEffect(() => {
    loadQuiz();
  }, [loadQuiz]);

  useEffect(() => {
    if (loading) return;

    if (submitted) {
      onProgress?.({ kind: "completed" });
    } else if (quizStatus?.status === "published") {
      onProgress?.({ kind: "active" });
    } else {
      onProgress?.({ kind: "not-available" });
    }
  }, [loading, submitted, quizStatus, onProgress]);

  const handleSelect = (itemId: string, option: string) => {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [itemId]: option }));
  };

  const handleSubmit = async () => {
    if (!classId || !assignmentId || !quizStatus) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/student-answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          assignmentId,
          studentId: user.userId,
          studentName: user.name,
          lessonNumber: quizStatus.lesson_number,
          answers,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as Record<string, string>).error ?? "Failed to submit answers.",
        );
      }

      setSubmitted(true);
      setExistingAnswers(answers);
      notifyQuizSubmitted(classId, assignmentId, user.geniusId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
        <p className="text-lg font-semibold text-rose-700">Unable to load quiz</p>
        <p className="mt-2 text-sm text-rose-600">{error}</p>
      </div>
    );
  }

  if (!quizStatus || quizStatus.status === "draft") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-lg font-semibold text-slate-700">No quiz available yet</p>
        <p className="mt-2 text-sm text-slate-500">
          Your teacher hasn&apos;t published the quiz for this assignment yet. Check back later.
        </p>
      </div>
    );
  }

  if (quizStatus.status === "closed") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-lg font-semibold text-slate-700">Quiz closed</p>
        <p className="mt-2 text-sm text-slate-500">
          This quiz is no longer accepting responses.
        </p>
      </div>
    );
  }

  const multipleChoiceQuestions = questions.filter((q) => q.type === "multiple_choice");
  const allAnswered = multipleChoiceQuestions.every((q) => answers[q.item_id]);
  // Check confidence items too
  const confidenceItems = questions.filter((q) => q.type === "confidence_check");
  const allConfidenceAnswered = confidenceItems.every((q) => answers[q.item_id]);
  const canSubmit = allAnswered && allConfidenceAnswered && !submitted;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Lesson {quizStatus.lesson_number} Quiz
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">
          Answer the questions below
        </h2>
        {submitted && (
          <p className="mt-2 text-sm font-semibold text-emerald-600">
            Your answers have been submitted.
          </p>
        )}
      </div>

      {questions.map((item, index) => {
        const isConfidence = item.type === "confidence_check";
        const selected = answers[item.item_id] ?? existingAnswers?.[item.item_id];

        return (
          <div
            key={item.item_id}
            className={`rounded-2xl border bg-white p-6 ${
              isConfidence
                ? "border-slate-100 bg-slate-50"
                : "border-slate-200"
            }`}
          >
            <div className="flex items-start gap-3">
              {!isConfidence && (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {item.question_number ?? index + 1}
                </span>
              )}
              <div className="flex-1">
                <p
                  className={`font-medium ${
                    isConfidence
                      ? "text-sm text-slate-500 italic"
                      : "text-sm text-slate-800"
                  }`}
                >
                  {item.stem}
                </p>
                <div className="mt-3 grid gap-2">
                  {Object.entries(item.options).map(([key, value]) => {
                    const isSelected = selected === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleSelect(item.item_id, key)}
                        disabled={submitted}
                        className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
                          isSelected
                            ? "border-[#BA0C2F] bg-[#BA0C2F]/5 text-slate-900"
                            : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                        } ${submitted ? "cursor-default" : "cursor-pointer"}`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                            isSelected
                              ? "bg-[#BA0C2F] text-white"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {key}
                        </span>
                        <span>{value}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="rounded-xl bg-[#BA0C2F] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#9a0a27] disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting
            ? "Submitting..."
            : submitted
              ? "Submitted"
              : "Submit answers"}
        </button>
      </div>
    </div>
  );
}
