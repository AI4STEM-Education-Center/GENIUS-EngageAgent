"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  Survey,
  SurveyQuestion,
  SurveyResponseType,
  SurveyQuestionPurpose,
} from "@/lib/types";

type Props = {
  classId: string;
  assignmentId: string;
};

const RESPONSE_TYPE_LABELS: Record<SurveyResponseType, string> = {
  short_answer: "Short answer",
  long_answer: "Long answer",
};

const PURPOSE_LABELS: Record<SurveyQuestionPurpose, string> = {
  familiarity: "Familiarity",
  follow_up: "Follow-up",
  unspecified: "Unspecified",
};

const newId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

const emptyQuestion = (order: number): SurveyQuestion => ({
  question_id: newId(),
  prompt: "",
  instructions: "",
  purpose: "unspecified",
  related_concept: "",
  order,
  response_type: "short_answer",
});

const emptyDraft = (classId: string, assignmentId: string): Survey => ({
  survey_id: "",
  class_id: classId,
  assignment_id: assignmentId,
  title: "",
  description: "",
  daily_experience_topic: "",
  status: "draft",
  questions: [emptyQuestion(1)],
  created_at: "",
  updated_at: "",
});

/** Returns a list of human-readable validation problems (empty = valid). */
export const validateSurvey = (survey: Survey): string[] => {
  const errors: string[] = [];
  if (!survey.title.trim()) errors.push("Survey title is required.");
  if (!survey.daily_experience_topic.trim())
    errors.push("Daily experience topic is required.");
  if (survey.questions.length === 0) errors.push("Add at least one question.");

  survey.questions.forEach((q, qi) => {
    const label = `Question ${qi + 1}`;
    if (!q.prompt.trim()) errors.push(`${label}: prompt is required.`);
    if (!q.response_type) errors.push(`${label}: response type is required.`);
  });

  return errors;
};

const inputClass =
  "rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none";
const labelClass = "text-xs font-semibold uppercase text-slate-500";

export default function SurveyBuilderView({ classId, assignmentId }: Props) {
  const hasContext = Boolean(classId && assignmentId);

  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [draft, setDraft] = useState<Survey | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const loadSurveys = useCallback(async () => {
    if (!hasContext) return;
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/surveys?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}`,
      );
      if (!res.ok) throw new Error(`Failed to load surveys (${res.status}).`);
      const data = (await res.json()) as { surveys?: Survey[] };
      setSurveys(data.surveys ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load surveys.");
    } finally {
      setLoadingList(false);
    }
  }, [classId, assignmentId, hasContext]);

  useEffect(() => {
    void loadSurveys();
  }, [loadSurveys]);

  const startNew = () => {
    setDraft(emptyDraft(classId, assignmentId));
    setValidationErrors([]);
    setPreviewing(false);
    setSavedNotice(null);
    setMode("edit");
  };

  const startEdit = (survey: Survey) => {
    setDraft(JSON.parse(JSON.stringify(survey)) as Survey);
    setValidationErrors([]);
    setPreviewing(false);
    setSavedNotice(null);
    setMode("edit");
  };

  const cancelEdit = () => {
    setDraft(null);
    setMode("list");
    setPreviewing(false);
  };

  // ---- draft mutation helpers ----
  const patchDraft = (patch: Partial<Survey>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const patchQuestion = (qId: string, patch: Partial<SurveyQuestion>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((q) =>
              q.question_id === qId ? { ...q, ...patch } : q,
            ),
          }
        : d,
    );

  const addQuestion = () =>
    setDraft((d) =>
      d
        ? {
            ...d,
            questions: [...d.questions, emptyQuestion(d.questions.length + 1)],
          }
        : d,
    );

  const duplicateQuestion = (qId: string) =>
    setDraft((d) => {
      if (!d) return d;
      const source = d.questions.find((q) => q.question_id === qId);
      if (!source) return d;
      const copy: SurveyQuestion = {
        ...source,
        question_id: newId(),
        order: d.questions.length + 1,
      };
      return { ...d, questions: [...d.questions, copy] };
    });

  const deleteQuestion = (qId: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            questions: d.questions
              .filter((q) => q.question_id !== qId)
              .map((q, i) => ({ ...q, order: i + 1 })),
          }
        : d,
    );

  const moveQuestion = (qId: string, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const idx = d.questions.findIndex((q) => q.question_id === qId);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= d.questions.length) return d;
      const next = [...d.questions];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...d, questions: next.map((q, i) => ({ ...q, order: i + 1 })) };
    });

  const saveDraft = async () => {
    if (!draft) return;
    const problems = validateSurvey(draft);
    setValidationErrors(problems);
    if (problems.length > 0) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          assignmentId,
          surveyId: draft.survey_id || undefined,
          title: draft.title,
          description: draft.description,
          dailyExperienceTopic: draft.daily_experience_topic,
          status: draft.status,
          questions: draft.questions,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Save failed (${res.status}).`);
      }
      setSavedNotice("Survey saved.");
      await loadSurveys();
      setMode("list");
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------------
  if (!hasContext) {
    return (
      <p className="text-sm text-amber-700">
        This survey builder is not linked to a class assignment yet. Open the
        Engage Agent from an assigned class in GENIUS to create surveys.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ---------------- list ---------------- */}
      {mode === "list" && (
        <>
          <div className="flex items-center justify-between">
            <p className={labelClass}>Surveys</p>
            <button
              type="button"
              onClick={startNew}
              className="inline-flex items-center justify-center rounded-xl bg-[#BA0C2F] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#9a0a27]"
            >
              Add survey
            </button>
          </div>

          {savedNotice && (
            <p className="text-sm font-semibold text-emerald-600">{savedNotice}</p>
          )}

          {loadingList ? (
            <p className="text-sm text-slate-500">Loading surveys…</p>
          ) : surveys.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-semibold text-slate-700">
                No surveys yet for this learning task
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Click “Add survey” to create one.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {surveys.map((s) => (
                <li
                  key={s.survey_id}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-slate-800">
                        {s.title}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${
                          s.status === "published"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {s.questions.length} question
                      {s.questions.length === 1 ? "" : "s"}
                      {s.daily_experience_topic
                        ? ` · ${s.daily_experience_topic}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEdit(s)}
                    className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ---------------- edit ---------------- */}
      {mode === "edit" && draft && !previewing && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              {draft.survey_id ? "Edit survey" : "New survey"}
            </p>
            <button
              type="button"
              onClick={cancelEdit}
              className="text-sm font-semibold text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>

          {/* Survey details */}
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>
                Survey title <span className="text-[#BA0C2F]">*</span>
              </span>
              <input
                value={draft.title}
                onChange={(e) => patchDraft({ title: e.target.value })}
                placeholder="e.g. Prior experience check"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Description</span>
              <textarea
                value={draft.description ?? ""}
                onChange={(e) => patchDraft({ description: e.target.value })}
                rows={2}
                className={inputClass}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>
                  Daily experience topic <span className="text-[#BA0C2F]">*</span>
                </span>
                <input
                  value={draft.daily_experience_topic}
                  onChange={(e) =>
                    patchDraft({ daily_experience_topic: e.target.value })
                  }
                  placeholder="e.g. Collisions in everyday life"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Status</span>
                <select
                  value={draft.status}
                  onChange={(e) =>
                    patchDraft({ status: e.target.value as Survey["status"] })
                  }
                  className={inputClass}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </label>
            </div>
          </div>

          {/* Questions */}
          {draft.questions.map((q, qi) => (
            <div
              key={q.question_id}
              className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">
                  Question {qi + 1}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveQuestion(q.question_id, -1)}
                    disabled={qi === 0}
                    title="Move up"
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveQuestion(q.question_id, 1)}
                    disabled={qi === draft.questions.length - 1}
                    title="Move down"
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateQuestion(q.question_id)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteQuestion(q.question_id)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <label className="flex flex-col gap-1">
                <span className={labelClass}>
                  Prompt <span className="text-[#BA0C2F]">*</span>
                </span>
                <input
                  value={q.prompt}
                  onChange={(e) =>
                    patchQuestion(q.question_id, { prompt: e.target.value })
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Instructions or example</span>
                <input
                  value={q.instructions ?? ""}
                  onChange={(e) =>
                    patchQuestion(q.question_id, { instructions: e.target.value })
                  }
                  className={inputClass}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>
                    Purpose <span className="text-[#BA0C2F]">*</span>
                  </span>
                  <select
                    value={q.purpose}
                    onChange={(e) =>
                      patchQuestion(q.question_id, {
                        purpose: e.target.value as SurveyQuestionPurpose,
                      })
                    }
                    className={inputClass}
                  >
                    {(Object.keys(PURPOSE_LABELS) as SurveyQuestionPurpose[]).map(
                      (p) => (
                        <option key={p} value={p}>
                          {PURPOSE_LABELS[p]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Related concept</span>
                  <input
                    value={q.related_concept ?? ""}
                    onChange={(e) =>
                      patchQuestion(q.question_id, {
                        related_concept: e.target.value,
                      })
                    }
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>
                    Response type <span className="text-[#BA0C2F]">*</span>
                  </span>
                  <select
                    value={q.response_type}
                    onChange={(e) =>
                      patchQuestion(q.question_id, {
                        response_type: e.target.value as SurveyResponseType,
                      })
                    }
                    className={inputClass}
                  >
                    {(
                      Object.keys(RESPONSE_TYPE_LABELS) as SurveyResponseType[]
                    ).map((t) => (
                      <option key={t} value={t}>
                        {RESPONSE_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addQuestion}
            className="w-fit rounded-full border border-[#BA0C2F] px-5 py-2.5 text-sm font-semibold text-[#BA0C2F] transition hover:bg-[#BA0C2F]/5"
          >
            + Add question
          </button>

          {validationErrors.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700">
                Please fix the following:
              </p>
              <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
                {validationErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPreviewing(true)}
              className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100"
            >
              Preview survey
            </button>
            <button
              type="button"
              onClick={saveDraft}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-xl bg-[#BA0C2F] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#9a0a27] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {saving ? "Saving…" : "Save survey"}
            </button>
          </div>
        </>
      )}

      {/* ---------------- preview ---------------- */}
      {mode === "edit" && draft && previewing && (
        <SurveyPreview survey={draft} onBack={() => setPreviewing(false)} />
      )}
    </div>
  );
}

/** Read-only render of the survey as a student would see it. */
function SurveyPreview({
  survey,
  onBack,
}: {
  survey: Survey;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">
          Preview (student view)
        </p>
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-semibold text-slate-500 hover:text-slate-700"
        >
          ← Back to editing
        </button>
      </div>

      <div className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-8">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {survey.title || "Untitled survey"}
          </h2>
          {survey.description && (
            <p className="mt-1 text-sm text-slate-600">{survey.description}</p>
          )}
          {survey.daily_experience_topic && (
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[#BA0C2F]">
              {survey.daily_experience_topic}
            </p>
          )}
        </div>

        {survey.questions.map((q, qi) => (
          <div
            key={q.question_id}
            className="flex flex-col gap-2 border-t border-slate-100 pt-5"
          >
            <p className="text-sm font-semibold text-slate-800">
              {qi + 1}. {q.prompt || "(no prompt)"}
            </p>
            {q.instructions && (
              <p className="text-xs text-slate-500">{q.instructions}</p>
            )}
            {q.response_type === "short_answer" ? (
              <input
                disabled
                placeholder="Short answer"
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              />
            ) : (
              <textarea
                disabled
                rows={3}
                placeholder="Long answer"
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
