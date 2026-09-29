"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UserContext } from "@/lib/auth";
import { resolveSurveyStatus } from "@/lib/survey-schedule";
import { findMissingAnswers, getSurveyAvailability } from "@/lib/survey-response";
import type { Survey, SurveyResponse } from "@/lib/types";

type Props = {
  user: UserContext;
};

type SaveState = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 800;

/**
 * Teacher-authored surveys as the student sees them (UC-SV-02, #79).
 * Lives inside the student's Assessment step, below the quiz.
 */
export default function StudentSurveysView({ user }: Props) {
  const classId = user.classId ?? "";
  const assignmentId = user.assignmentId ?? "";
  const studentId = user.userId;

  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [responses, setResponses] = useState<Record<string, SurveyResponse>>({});
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!classId || !assignmentId || !studentId) return;
    setLoading(true);
    try {
      const q = `classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`;
      const [surveyRes, responseRes] = await Promise.all([
        fetch(`/api/surveys?${q}`),
        fetch(`/api/survey-responses?${q}&studentId=${encodeURIComponent(studentId)}`),
      ]);
      if (surveyRes.ok) {
        const data = (await surveyRes.json()) as { surveys?: Survey[] };
        // Students never see drafts.
        setSurveys((data.surveys ?? []).filter((s) => resolveSurveyStatus(s) !== "draft"));
      }
      if (responseRes.ok) {
        const data = (await responseRes.json()) as { responses?: SurveyResponse[] };
        const byId: Record<string, SurveyResponse> = {};
        for (const r of data.responses ?? []) byId[r.survey_id] = r;
        setResponses(byId);
      }
    } finally {
      setLoading(false);
    }
  }, [classId, assignmentId, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    },
    [],
  );

  const openSurvey = openId ? surveys.find((s) => s.survey_id === openId) ?? null : null;
  const existing = openSurvey ? responses[openSurvey.survey_id] : undefined;
  const canEditAfterSubmit = openSurvey?.schedule?.allow_response_editing ?? false;
  const locked = existing?.status === "submitted" && !canEditAfterSubmit;

  const post = async (action: "save" | "submit", nextAnswers: Record<string, string>) => {
    if (!openSurvey) return null;
    const res = await fetch("/api/survey-responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId,
        assignmentId,
        surveyId: openSurvey.survey_id,
        studentId,
        studentName: user.name,
        answers: nextAnswers,
        action,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      response?: SurveyResponse;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
    return data.response ?? null;
  };

  const startSurvey = (survey: Survey) => {
    setOpenId(survey.survey_id);
    setAnswers({ ...(responses[survey.survey_id]?.answers ?? {}) });
    setReviewing(false);
    setConfirming(false);
    setError(null);
    setNotice(null);
    setSaveState("idle");
  };

  const changeAnswer = (fieldId: string, value: string) => {
    const next = { ...answers, [fieldId]: value };
    setAnswers(next);
    setConfirming(false);
    if (openSurvey && findMissingAnswers(openSurvey, next).length === 0) setError(null);
    // Drafts autosave; once submitted, changes only count when resubmitted.
    if (existing?.status === "submitted") return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setSaveState("saving");
    autosaveTimer.current = setTimeout(async () => {
      try {
        const saved = await post("save", next);
        if (saved) setResponses((prev) => ({ ...prev, [saved.survey_id]: saved }));
        setSaveState("saved");
      } catch {
        // Answers stay in the form; the student can keep going and retry.
        setSaveState("error");
      }
    }, AUTOSAVE_DELAY_MS);
  };

  const requestSubmit = () => {
    if (!openSurvey) return;
    const missing = findMissingAnswers(openSurvey, answers);
    if (missing.length > 0) {
      setReviewing(true);
      setError("Please answer every question before submitting.");
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const submit = async () => {
    if (!openSurvey) return;
    setConfirming(false);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setSubmitting(true);
    setError(null);
    try {
      const saved = await post("submit", answers);
      if (saved) setResponses((prev) => ({ ...prev, [saved.survey_id]: saved }));
      setNotice(saved?.is_late ? "Survey submitted (late)." : "Survey submitted. Thank you!");
      setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!classId || !assignmentId) return null;
  if (!loading && surveys.length === 0) return null;

  const missingIds = new Set(
    openSurvey ? findMissingAnswers(openSurvey, answers).map((m) => m.fieldId) : [],
  );

  return (
    <section
      aria-labelledby="student-surveys-heading"
      className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Surveys</p>
        <h2 id="student-surveys-heading" className="mt-1 text-xl font-semibold text-slate-900">
          Surveys from your teacher
        </h2>
      </div>

      {notice && <p className="text-sm font-semibold text-emerald-600">{notice}</p>}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* ---------------- list ---------------- */}
      {!openSurvey && (
        <ul className="flex flex-col gap-3">
          {loading && <li className="text-sm text-slate-500">Loading surveys…</li>}
          {surveys.map((s) => {
            const availability = getSurveyAvailability(s);
            const r = responses[s.survey_id];
            const label =
              r?.status === "submitted"
                ? r.is_late
                  ? "Submitted (late)"
                  : "Submitted"
                : !availability.open
                  ? availability.reason === "scheduled"
                    ? "Not open yet"
                    : "Closed"
                  : r
                    ? "In progress"
                    : "Not started";
            const canOpen = availability.open || r?.status === "submitted";
            return (
              <li
                key={s.survey_id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4"
              >
                <div>
                  <p className="font-semibold text-slate-800">{s.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {s.questions.length} question{s.questions.length === 1 ? "" : "s"}
                    {s.daily_experience_topic ? ` · ${s.daily_experience_topic}` : ""}
                    {s.schedule ? ` · Due ${new Date(s.schedule.due_at).toLocaleString()}` : ""}
                  </p>
                  {!availability.open && r?.status !== "submitted" && (
                    <p className="mt-0.5 text-xs text-amber-700">{availability.message}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-slate-600">
                    {label}
                  </span>
                  <button
                    type="button"
                    disabled={!canOpen}
                    onClick={() => startSurvey(s)}
                    className="rounded-full border border-[#BA0C2F] px-4 py-2 text-xs font-semibold text-[#BA0C2F] transition hover:bg-[#BA0C2F]/5 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                  >
                    {r?.status === "submitted" ? "View" : r ? "Continue" : "Start"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ---------------- answering / review ---------------- */}
      {openSurvey && (
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{openSurvey.title}</h3>
              {openSurvey.description && (
                <p className="mt-1 text-sm text-slate-600">{openSurvey.description}</p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                {openSurvey.questions.length} question{openSurvey.questions.length === 1 ? "" : "s"}
                {openSurvey.daily_experience_topic ? ` · ${openSurvey.daily_experience_topic}` : ""}
                {" · "}
                {existing?.status === "submitted" ? "Submitted" : existing ? "Draft saved" : "Not started"}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                There are no right or wrong answers. Answer every question, then submit.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="shrink-0 text-sm font-semibold text-slate-500 hover:text-slate-700"
            >
              ← Back
            </button>
          </div>

          {openSurvey.questions.map((q, qi) => (
            <div key={q.item_id} className="flex flex-col gap-2 border-t border-slate-100 pt-4">
              <p className="text-sm font-semibold text-slate-800">
                {qi + 1}. {q.stem} <span className="text-[#BA0C2F]">*</span>
              </p>
              {q.example && <p className="text-xs text-slate-500">{q.example}</p>}
              {q.response_fields.map((f) => {
                const value = answers[f.field_id] ?? "";
                const flagged = reviewing && missingIds.has(f.field_id);
                const cls = `rounded-xl border px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none disabled:bg-slate-50 ${
                  flagged ? "border-red-400" : "border-slate-200"
                }`;
                return (
                  <label key={f.field_id} className="flex flex-col gap-1">
                    <span className="sr-only">{f.label}</span>
                    {(f.text_length ?? "short") === "long" ? (
                      <textarea
                        rows={4}
                        value={value}
                        disabled={locked}
                        onChange={(e) => changeAnswer(f.field_id, e.target.value)}
                        className={cls}
                      />
                    ) : (
                      <input
                        value={value}
                        disabled={locked}
                        onChange={(e) => changeAnswer(f.field_id, e.target.value)}
                        className={cls}
                      />
                    )}
                    {flagged && <span className="text-xs text-red-600">This answer is required.</span>}
                  </label>
                );
              })}
            </div>
          ))}

          {!locked && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-400">
                {saveState === "saving" && "Saving…"}
                {saveState === "saved" && "Draft saved"}
                {saveState === "error" && (
                  <span className="text-red-600">Couldn’t save — your answers are kept here. Keep going and try again.</span>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setReviewing(true)}
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Review answers
                </button>
                <button
                  type="button"
                  onClick={requestSubmit}
                  disabled={submitting || confirming}
                  className="rounded-xl bg-[#BA0C2F] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#9a0a27] disabled:bg-slate-300"
                >
                  {submitting ? "Submitting…" : existing?.status === "submitted" ? "Resubmit" : "Submit survey"}
                </button>
              </div>
            </div>
          )}
          {confirming && (
            <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-amber-900">
                {canEditAfterSubmit
                  ? "Submit your survey? You can still change your answers later."
                  : "Submit your survey? You won’t be able to change your answers after this."}
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={submit}
                  className="rounded-xl bg-[#BA0C2F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#9a0a27]"
                >
                  Yes, submit
                </button>
              </div>
            </div>
          )}
          {reviewing && missingIds.size > 0 && (
            <p className="text-sm text-red-600">
              {missingIds.size} answer{missingIds.size === 1 ? " is" : "s are"} still missing (highlighted above).
            </p>
          )}
          {locked && (
            <p className="text-sm font-semibold text-emerald-600">
              You submitted this survey{existing?.is_late ? " (late)" : ""}. Your answers can’t be changed.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
