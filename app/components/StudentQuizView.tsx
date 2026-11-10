"use client";

import { scopedClientAuthHeaders } from "@/lib/client-auth";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { UserContext } from "@/lib/auth";
import { findExistingStudentAnswer } from "@/lib/student-answer-lookup";
import { findMissingAnswers, getSurveyAvailability } from "@/lib/survey-response";
import { pickTaskSurvey } from "@/lib/survey-schedule";
import type { QuizItem, Survey, SurveyResponse } from "@/lib/types";
import type { StepProgress } from "@/lib/student-progress";
import { countAnswered, firstUnanswered, groupQuizItems } from "@/lib/student-quiz-progress";

type Props = {
  user: UserContext;
  onProgress?: (progress: StepProgress) => void;
};

type QuizStatusData = {
  lesson_number: number;
  status: "draft" | "published" | "closed";
};

export default function StudentQuizView({ user, onProgress }: Props) {
  const questionLabelId = useId();
  const [quizStatus, setQuizStatus] = useState<QuizStatusData | null>(null);
  const [questions, setQuestions] = useState<QuizItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [existingAnswers, setExistingAnswers] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const quizLoadInFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The learning task's survey is part of the same task as the quiz (#107, #111):
  // its questions follow the quiz questions and share one submit button.
  const [survey, setSurvey] = useState<Survey | null>(null);
  const surveyDrafts = useRef<Record<string, Record<string, string>>>({});
  const [surveyAnswers, setSurveyAnswers] = useState<Record<string, string>>({});
  const [surveySubmitted, setSurveySubmitted] = useState(false);
  const [surveyNote, setSurveyNote] = useState<string | null>(null);

  const classId = user.classId;
  const assignmentId = user.assignmentId;

  const loadQuiz = useCallback(async () => {
    if (!classId || !assignmentId) {
      setLoadError("Missing class or assignment context.");
      setLoading(false);
      return;
    }
    if (quizLoadInFlight.current) return;
    quizLoadInFlight.current = true;
    setRefreshing(true);
    setLoadError(null);

    try {
      // Fetch quiz status
      const statusRes = await fetch(
        `/api/quiz-status?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`,
        { headers: scopedClientAuthHeaders({ classId, assignmentId }), cache: "no-store" },
      );
      const statusData = await statusRes.json().catch(() => ({}));

      if (!statusRes.ok) {
        throw new Error(
          (statusData as { error?: string }).error ?? "Failed to load quiz status.",
        );
      }

      const qs = (statusData as { quizStatus?: QuizStatusData | null }).quizStatus ?? null;

      setQuizStatus(qs);

      // Load quiz questions only when the quiz is published. The survey below is
      // loaded either way: a teacher can publish a survey without a quiz (#111).
      if (qs?.status === "published") {
        // The quiz published for this task (#177). A task published the old way reads its lesson's quiz.
        const taskQuery = `classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`;
        const quizRes = await fetch(`/api/task-quiz/student?${taskQuery}`, { headers: scopedClientAuthHeaders({ classId, assignmentId }), cache: "no-store" });
        const quizData = await quizRes.json().catch(() => ({}));
        if (!quizRes.ok) throw new Error(quizData.error ?? "Failed to load quiz questions.");
        if (quizData.items) {
          setQuestions(quizData.items);
        } else {
          const lessonRes = await fetch(`/api/lessons/${qs.lesson_number}?${taskQuery}`, { cache: "no-store" });
          const lessonData = await lessonRes.json();
          if (!lessonRes.ok) throw new Error(lessonData.error ?? "Failed to load quiz questions.");
          setQuestions(lessonData.quiz_items ?? []);
        }

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
        }
      }

      // Load the learning task's survey, if the teacher published one.
      const query = `classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`;
      const surveysRes = await fetch(`/api/surveys?${query}`, { headers: scopedClientAuthHeaders({ classId, assignmentId }), cache: "no-store" });
      if (!surveysRes.ok) throw new Error("Unable to load the task survey. Please retry loading the assessment.");
      if (surveysRes.ok) {
        const data = (await surveysRes.json()) as { surveys?: Survey[] };
        const taskSurvey = pickTaskSurvey(data.surveys ?? []);
        if (taskSurvey) {
          const responsesRes = await fetch(
            `/api/survey-responses?${query}&surveyId=${encodeURIComponent(taskSurvey.survey_id)}&studentId=${encodeURIComponent(user.userId)}`,
            { headers: scopedClientAuthHeaders({ classId, assignmentId }), cache: "no-store" },
          );
          if (!responsesRes.ok) throw new Error("Unable to load your survey responses. Please retry loading the assessment.");
          const own = (((await responsesRes.json()) as { responses?: SurveyResponse[] }).responses ?? [])[0];
          const availability = getSurveyAvailability(taskSurvey);
          if (own?.status === "submitted") {
            setSurvey(taskSurvey);
            setSurveyAnswers(own.answers);
            setSurveySubmitted(true);
          } else if (availability.open) {
            setSurvey(taskSurvey);
            setSurveyAnswers({ ...own?.answers, ...surveyDrafts.current[taskSurvey.survey_id] });
          } else if (availability.reason !== "draft") {
            // Scheduled or closed: mention it, but don't hold up the quiz.
            setSurveyNote(availability.message);
          }
        }
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load quiz.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      quizLoadInFlight.current = false;
    }
  }, [classId, assignmentId, user.userId, user.email]);

  useEffect(() => {
    loadQuiz();
  }, [loadQuiz]);

  // A student may open the task before the teacher publishes its quiz.
  // Stop refreshing once it opens, so in-progress answers are never replaced.
  useEffect(() => {
    if (loading || quizStatus?.status === "published") return;
    const refresh = () => { void loadQuiz(); };
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loading, quizStatus?.status, loadQuiz]);

  useEffect(() => {
    if (loading) return;

    const quizOpen = quizStatus?.status === "published";
    const quizDone = !quizOpen || submitted;
    const surveyDone = !survey || surveySubmitted;
    if ((quizOpen || survey) && quizDone && surveyDone) {
      onProgress?.({ kind: "completed" });
    } else if (quizOpen || survey) {
      onProgress?.({ kind: "active" });
    } else {
      onProgress?.({ kind: "not-available" });
    }
  }, [loading, submitted, survey, surveySubmitted, quizStatus, onProgress]);

  const handleSelect = (itemId: string, option: string) => {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [itemId]: option }));
  };

  const handleConfidenceKey = (event: KeyboardEvent<HTMLButtonElement>, item: QuizItem, current: string) => {
    if (submitted) return;
    const options = Object.keys(item.options);
    const index = options.indexOf(current);
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else return; // Native buttons retain Enter and Space activation.
    event.preventDefault();
    handleSelect(item.item_id, options[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  const handleSurveyAnswer = (fieldId: string, value: string) => {
    if (surveySubmitted) return;
    if (survey) surveyDrafts.current[survey.survey_id] = { ...surveyDrafts.current[survey.survey_id], [fieldId]: value };
    setSurveyAnswers((prev) => ({ ...prev, [fieldId]: value }));
  };

  // One submit for the quiz and the survey. The quiz goes first; if the survey
  // part fails, the quiz answers stay saved and the student can retry just the
  // survey with the same button.
  const handleSubmit = async () => {
    if (!classId || !assignmentId) return;

    setSubmitting(true);
    setError(null);

    try {
      if (quizStatus?.status === "published" && !submitted) {
        const res = await fetch("/api/student-answers", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...scopedClientAuthHeaders({ classId, assignmentId }) },
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
      }

      if (survey && !surveySubmitted) {
        const res = await fetch("/api/survey-responses", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...scopedClientAuthHeaders({ classId, assignmentId }) },
          body: JSON.stringify({
            classId,
            assignmentId,
            surveyId: survey.survey_id,
            studentId: user.userId,
            studentName: user.name,
            answers: surveyAnswers,
            action: "submit",
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            `${quizStatus?.status === "published" ? "Your quiz answers were saved, but the survey answers" : "Your survey answers"} didn't go through${
              data.error ? ` (${data.error})` : ""
            }. Please try again.`,
          );
        }
        setSurveySubmitted(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setSubmitting(false);
    }
  };

  const refreshButton = (label: string, tone: "plain" | "bad") => (
    <button type="button" disabled={refreshing} onClick={() => void loadQuiz()}
      className={`mt-4 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${tone === "bad" ? "border-bad/30 text-bad" : "border-line text-ink-2 hover:bg-canvas"}`}>
      {refreshing ? "Refreshing..." : label}
    </button>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-ink-2" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-bad/20 bg-bad-light p-8 text-center">
        <p className="text-lg font-semibold text-bad">Unable to load quiz</p>
        <p className="mt-2 text-sm text-bad">{loadError}</p>
        {refreshButton("Retry loading quiz", "bad")}
      </div>
    );
  }

  const quizOpen = quizStatus?.status === "published";

  if ((!quizStatus || quizStatus.status === "draft") && !survey) {
    return (
      <div className="rounded-2xl border border-line bg-white p-8 text-center">
        <p className="text-lg font-semibold text-ink">No quiz available yet</p>
        <p className="mt-2 text-sm text-mute">
          Your teacher hasn&apos;t published the quiz for this assignment yet. Check back later.
        </p>
        {refreshButton("Refresh quiz", "plain")}
      </div>
    );
  }

  if (quizStatus?.status === "closed" && !survey) {
    return (
      <div className="rounded-2xl border border-line bg-white p-8 text-center">
        <p className="text-lg font-semibold text-ink">Quiz closed</p>
        <p className="mt-2 text-sm text-mute">
          This quiz is no longer accepting responses.
        </p>
        {refreshButton("Refresh quiz", "plain")}
      </div>
    );
  }

  const quizItems = quizOpen ? questions : [];
  const multipleChoiceQuestions = quizItems.filter((q) => q.type === "multiple_choice");
  const allAnswered = multipleChoiceQuestions.every((q) => answers[q.item_id]);
  const confidenceItems = quizItems.filter((q) => q.type === "confidence_check");
  const allConfidenceAnswered = confidenceItems.every((q) => answers[q.item_id]);
  const surveyComplete = !survey || findMissingAnswers(survey, surveyAnswers).length === 0;
  const allDone = (!quizOpen || submitted) && (!survey || surveySubmitted);
  const canSubmit =
    !refreshing && !loadError && (!quizOpen || submitted || (allAnswered && allConfidenceAnswered)) &&
    surveyComplete &&
    !allDone;

  const cards = groupQuizItems(quizItems);
  const progress = countAnswered(quizItems, answers, survey, surveyAnswers);
  const next = firstUnanswered(cards, answers, survey, surveyAnswers);
  const cardId = (itemId: string) => `${questionLabelId}-card-${itemId}`;

  // The count stays pinned while the student scrolls; "Next unanswered"
  // brings the first card with something left into view and focuses it.
  const goToNextUnanswered = () => {
    if (!next) return;
    const card = document.getElementById(cardId(next.itemId));
    card?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    card?.focus({ preventScroll: true });
  };

  const renderConfidence = (item: QuizItem, labelId: string) => {
    const selected = answers[item.item_id] ?? existingAnswers?.[item.item_id];
    return (
      <div role="radiogroup" aria-labelledby={labelId} aria-orientation="horizontal" className="mt-2.5 grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-line">
        {Object.entries(item.options).map(([key, value], optionIndex) => (
          <button key={key} type="button" role="radio" aria-checked={selected === key}
            tabIndex={selected === key || (!selected && optionIndex === 0) ? 0 : -1}
            disabled={submitted} onClick={() => handleSelect(item.item_id, key)} onKeyDown={event => handleConfidenceKey(event, item, key)}
            className={`min-h-12 min-w-0 break-words border-r border-line px-1 py-3 text-center text-xs font-medium leading-snug last:border-r-0 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:cursor-default sm:px-3 sm:text-sm ${selected === key ? "bg-brand text-white" : "bg-white text-ink-2 enabled:hover:bg-canvas"}`}>
            {value}
          </button>
        ))}
      </div>
    );
  };

  const eyebrow = "text-xs font-semibold uppercase tracking-[0.14em] text-faint";
  const numberBadge = "grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-line-2 text-[13px] font-bold text-ink-2";
  const cardClass = "scroll-mt-24 rounded-2xl border border-line bg-white p-5 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:p-6";
  const hasQuiz = cards.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-line bg-white p-6">
        {quizOpen && quizStatus && <p className={eyebrow}>Lesson {quizStatus.lesson_number}</p>}
        <h2 className="mt-1 text-[26px] font-bold tracking-tight text-ink">Get ready for the lesson</h2>
        {allDone && <p className="mt-2 text-sm font-semibold text-ok">Submitted — thank you!</p>}
        {surveyNote && !allDone && <p className="mt-2 text-sm text-mute">{surveyNote}</p>}
      </div>

      {progress.total > 0 && (
        <div className="sticky top-0 z-20 -mx-2 -my-2 flex flex-wrap items-center gap-x-4 gap-y-2 bg-canvas/95 px-2 py-2.5 backdrop-blur">
          <p className="font-semibold text-ink">{progress.done} of {progress.total} answered</p>
          <div role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}
            className="h-1.5 min-w-24 max-w-[440px] flex-1 overflow-hidden rounded-full bg-line-2">
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          {allDone
            ? <span className="rounded-full bg-ok-light px-3 py-1 text-xs font-semibold text-ok">Submitted</span>
            : next
              ? <button type="button" onClick={goToNextUnanswered} className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink hover:bg-canvas">Next unanswered</button>
              : <span className="rounded-full bg-ok-light px-3 py-1 text-xs font-semibold text-ok">All answered</span>}
        </div>
      )}

      {hasQuiz && <p className={`${eyebrow} mt-1`}>Part 1 · Quiz</p>}

      {cards.map(({ question, confidence }, index) => {
        const isConfidence = question.type === "confidence_check";
        const selected = answers[question.item_id] ?? existingAnswers?.[question.item_id];
        const stemId = `${questionLabelId}-${question.item_id}`;
        const confidenceId = `${questionLabelId}-${question.item_id}-confidence`;
        const number = question.question_number ?? index + 1;

        return (
          <section key={question.item_id} id={cardId(question.item_id)} tabIndex={-1} className={cardClass}>
            <div className="flex items-start gap-3.5">
              {!isConfidence && <span className={numberBadge}>{number}</span>}
              <div className="min-w-0 flex-1">
                <div>
                  <p id={stemId} className={isConfidence ? "text-sm text-mute" : "pt-0.5 text-[15px] font-semibold leading-snug text-ink"}>
                    {question.stem}
                  </p>
                  {!isConfidence && question.image && (
                    <img
                      src={question.image}
                      alt={`Visual reference for question ${number}`}
                      loading="lazy"
                      decoding="async"
                      className="mt-4 h-auto max-h-[28rem] w-full max-w-md rounded-xl border border-line bg-white object-contain"
                    />
                  )}
                  {isConfidence ? renderConfidence(question, stemId) : <div className="mt-4 grid gap-2.5">
                    {Object.entries(question.options).map(([key, value]) => {
                      const isSelected = selected === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => handleSelect(question.item_id, key)}
                          disabled={submitted}
                          className={`flex items-center gap-3.5 rounded-xl border px-4 py-3 text-left text-[15px] text-ink transition ${
                            isSelected ? "border-brand bg-brand-light" : "border-line bg-white enabled:hover:border-faint enabled:hover:bg-canvas"
                          } ${submitted ? "cursor-default" : "cursor-pointer"}`}
                        >
                          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-bold ${isSelected ? "bg-brand text-white" : "bg-line-2 text-ink-2"}`}>
                            {key}
                          </span>
                          <span>{value}</span>
                        </button>
                      );
                    })}
                  </div>}
                </div>
              </div>
            </div>
            {/* Full card width on phones so the four ratings fit; lined up with the question from sm up. */}
            {confidence && (
              <div className="mt-5 border-t border-dashed border-line pt-4 sm:ml-[42px]">
                <p id={confidenceId} className="text-sm text-mute">{confidence.stem}</p>
                {renderConfidence(confidence, confidenceId)}
              </div>
            )}
          </section>
        );
      })}

      {survey && <p className={`${eyebrow} mt-3`}>{hasQuiz ? `Part 2 · ${survey.title}` : survey.title}</p>}

      {survey &&
        survey.questions.map((item, index) => (
          <section key={item.item_id} id={cardId(item.item_id)} tabIndex={-1} className={cardClass}>
            <div className="flex items-start gap-3.5">
              <span className={numberBadge}>{cards.length + index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="pt-0.5 text-[15px] font-semibold leading-snug text-ink">{item.stem}</p>
                {item.example && <p className="mt-1 text-xs text-mute">{item.example}</p>}
                <div className="mt-3 grid gap-2">
                  {item.response_fields.map((field) => {
                    const value = surveyAnswers[field.field_id] ?? "";
                    const cls =
                      "w-full rounded-xl border border-line px-4 py-3 text-sm text-ink focus:border-brand focus:outline-none disabled:bg-canvas disabled:text-ink-2";
                    return (field.text_length ?? "short") === "long" ? (
                      <textarea
                        key={field.field_id}
                        aria-label={field.label}
                        rows={4}
                        value={value}
                        disabled={surveySubmitted}
                        onChange={(e) => handleSurveyAnswer(field.field_id, e.target.value)}
                        className={cls}
                      />
                    ) : (
                      <input
                        key={field.field_id}
                        aria-label={field.label}
                        value={value}
                        disabled={surveySubmitted}
                        onChange={(e) => handleSurveyAnswer(field.field_id, e.target.value)}
                        className={cls}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ))}

      {error && (
        <div role="alert" className="rounded-2xl border border-bad/20 bg-bad-light p-4 text-sm text-bad">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-mute"
        >
          {submitting
            ? "Submitting..."
            : allDone
              ? "Submitted"
              : "Submit answers"}
        </button>
      </div>
    </div>
  );
}
