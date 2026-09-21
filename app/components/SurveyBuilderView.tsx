"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { UserContext } from "@/lib/auth";
import type {
  Survey,
  SurveyQuestion,
  SurveyResponseField,
  SurveyResponseType,
  SurveyQuestionPurpose,
} from "@/lib/types";

type Props = {
  user: UserContext;
};

const RESPONSE_TYPE_LABELS: Record<SurveyResponseType, string> = {
  short_text: "Short text",
  long_text: "Long text (paragraph)",
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  sentence_completion: "Sentence completion",
};

const PURPOSE_LABELS: Record<SurveyQuestionPurpose, string> = {
  familiarity: "Familiarity",
  follow_up: "Follow-up",
  unspecified: "Unspecified",
};

const isChoice = (t: SurveyResponseType) =>
  t === "single_choice" || t === "multiple_choice";

const newId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

const emptyField = (): SurveyResponseField => ({
  field_id: newId(),
  label: "",
  response_type: "short_text",
  required: true,
});

const emptyQuestion = (order: number): SurveyQuestion => ({
  question_id: newId(),
  prompt: "",
  instructions: "",
  purpose: "unspecified",
  related_concept: "",
  order,
  response_fields: [emptyField()],
});

const emptyDraft = (classId: string, assignmentId: string): Survey => ({
  survey_id: "",
  class_id: classId,
  assignment_id: assignmentId,
  title: "",
  description: "",
  student_instructions: "",
  lesson_number: undefined,
  status: "draft",
  questions: [emptyQuestion(1)],
  created_at: "",
  updated_at: "",
});

/** Returns a list of human-readable validation problems (empty = valid). */
const validateSurvey = (survey: Survey): string[] => {
  const errors: string[] = [];
  if (!survey.title.trim()) errors.push("Survey title is required.");
  if (survey.questions.length === 0)
    errors.push("Add at least one question.");

  survey.questions.forEach((q, qi) => {
    const label = `Question ${qi + 1}`;
    if (!q.prompt.trim()) errors.push(`${label}: prompt is required.`);
    if (!q.related_concept.trim())
      errors.push(`${label}: related concept is required.`);
    if (q.response_fields.length === 0)
      errors.push(`${label}: add at least one response field.`);

    q.response_fields.forEach((f, fi) => {
      const fLabel = `${label}, response ${fi + 1}`;
      if (!f.label.trim()) errors.push(`${fLabel}: label is required.`);
      if (isChoice(f.response_type)) {
        const options = (f.options ?? []).filter((o) => o.trim());
        if (options.length < 2)
          errors.push(`${fLabel}: choice questions need at least two options.`);
      }
      if (f.response_type === "sentence_completion") {
        if (!f.sentence_text?.trim())
          errors.push(`${fLabel}: sentence text is required.`);
        const blanks = (f.blanks ?? []).filter((b) => b.label.trim());
        if (blanks.length < 1)
          errors.push(`${fLabel}: add at least one blank with a label.`);
      }
    });
  });

  return errors;
};

export default function SurveyBuilderView({ user }: Props) {
  const classId = user.classId ?? "";
  const assignmentId = user.assignmentId ?? "";
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
    // Deep clone so edits don't mutate the list until saved.
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

  const patchField = (
    qId: string,
    fId: string,
    patch: Partial<SurveyResponseField>,
  ) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((q) =>
              q.question_id === qId
                ? {
                    ...q,
                    response_fields: q.response_fields.map((f) =>
                      f.field_id === fId ? { ...f, ...patch } : f,
                    ),
                  }
                : q,
            ),
          }
        : d,
    );

  const addQuestion = () =>
    setDraft((d) =>
      d
        ? { ...d, questions: [...d.questions, emptyQuestion(d.questions.length + 1)] }
        : d,
    );

  const duplicateQuestion = (qId: string) =>
    setDraft((d) => {
      if (!d) return d;
      const source = d.questions.find((q) => q.question_id === qId);
      if (!source) return d;
      const copy: SurveyQuestion = {
        ...JSON.parse(JSON.stringify(source)),
        question_id: newId(),
        order: d.questions.length + 1,
        response_fields: source.response_fields.map((f) => ({
          ...JSON.parse(JSON.stringify(f)),
          field_id: newId(),
        })),
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

  const addField = (qId: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((q) =>
              q.question_id === qId
                ? { ...q, response_fields: [...q.response_fields, emptyField()] }
                : q,
            ),
          }
        : d,
    );

  const deleteField = (qId: string, fId: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((q) =>
              q.question_id === qId
                ? {
                    ...q,
                    response_fields: q.response_fields.filter(
                      (f) => f.field_id !== fId,
                    ),
                  }
                : q,
            ),
          }
        : d,
    );

  const changeFieldType = (
    qId: string,
    fId: string,
    type: SurveyResponseType,
  ) => {
    const patch: Partial<SurveyResponseField> = { response_type: type };
    if (isChoice(type)) patch.options = ["", ""];
    else patch.options = undefined;
    if (type === "sentence_completion") {
      patch.sentence_text = "";
      patch.blanks = [{ blank_id: newId(), label: "" }];
    } else {
      patch.sentence_text = undefined;
      patch.blanks = undefined;
    }
    patchField(qId, fId, patch);
  };

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
          studentInstructions: draft.student_instructions,
          lessonNumber: draft.lesson_number,
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

  const lessonOptions = useMemo(() => Array.from({ length: 8 }, (_, i) => i + 1), []);

  // ------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Engage Agent
            </p>
            <span className="rounded-full bg-[#BA0C2F]/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-[#BA0C2F]">
              Surveys
            </span>
          </div>
          <Link
            href="/"
            className="w-fit text-xs font-semibold text-slate-500 underline-offset-2 hover:underline"
          >
            ← Back to Engage Agent
          </Link>
        </header>

        {!hasContext && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            This survey builder is not linked to a class assignment. Open the Engage
            Agent from an assigned class in GENIUS to create surveys.
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {mode === "list" && (
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Surveys</h1>
                <p className="text-sm text-slate-500">
                  Create and edit surveys for this learning task.
                </p>
              </div>
              <button
                type="button"
                onClick={startNew}
                disabled={!hasContext}
                className="inline-flex items-center justify-center rounded-xl bg-[#BA0C2F] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#9a0a27] disabled:cursor-not-allowed disabled:bg-slate-300"
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
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
                <p className="text-sm font-semibold text-slate-700">No surveys yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Click “Add survey” to create your first one.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {surveys.map((s) => (
                  <li
                    key={s.survey_id}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-base font-semibold text-slate-800">
                          {s.title}
                        </p>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${
                            s.status === "active"
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
                        {s.lesson_number ? ` · Lesson ${s.lesson_number}` : ""}
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
          </section>
        )}

        {mode === "edit" && draft && !previewing && (
          <section className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-semibold text-slate-900">
                {draft.survey_id ? "Edit survey" : "New survey"}
              </h1>
              <button
                type="button"
                onClick={cancelEdit}
                className="text-sm font-semibold text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
            </div>

            {/* Survey details */}
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  Survey title <span className="text-[#BA0C2F]">*</span>
                </span>
                <input
                  value={draft.title}
                  onChange={(e) => patchDraft({ title: e.target.value })}
                  placeholder="e.g. Prior experience check"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  Description
                </span>
                <textarea
                  value={draft.description ?? ""}
                  onChange={(e) => patchDraft({ description: e.target.value })}
                  rows={2}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  Student instructions
                </span>
                <textarea
                  value={draft.student_instructions ?? ""}
                  onChange={(e) =>
                    patchDraft({ student_instructions: e.target.value })
                  }
                  rows={2}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Related lesson
                  </span>
                  <select
                    value={draft.lesson_number ?? ""}
                    onChange={(e) =>
                      patchDraft({
                        lesson_number: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                  >
                    <option value="">None</option>
                    {lessonOptions.map((n) => (
                      <option key={n} value={n}>
                        Lesson {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Status
                  </span>
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      patchDraft({
                        status: e.target.value as Survey["status"],
                      })
                    }
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Questions */}
            <div className="flex flex-col gap-4">
              {draft.questions.map((q, qi) => (
                <div
                  key={q.question_id}
                  className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
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
                    <span className="text-xs font-semibold uppercase text-slate-500">
                      Prompt <span className="text-[#BA0C2F]">*</span>
                    </span>
                    <input
                      value={q.prompt}
                      onChange={(e) =>
                        patchQuestion(q.question_id, { prompt: e.target.value })
                      }
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-slate-500">
                      Instructions or example
                    </span>
                    <input
                      value={q.instructions ?? ""}
                      onChange={(e) =>
                        patchQuestion(q.question_id, {
                          instructions: e.target.value,
                        })
                      }
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        Purpose <span className="text-[#BA0C2F]">*</span>
                      </span>
                      <select
                        value={q.purpose}
                        onChange={(e) =>
                          patchQuestion(q.question_id, {
                            purpose: e.target.value as SurveyQuestionPurpose,
                          })
                        }
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                      >
                        {(
                          Object.keys(PURPOSE_LABELS) as SurveyQuestionPurpose[]
                        ).map((p) => (
                          <option key={p} value={p}>
                            {PURPOSE_LABELS[p]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        Related concept <span className="text-[#BA0C2F]">*</span>
                      </span>
                      <input
                        value={q.related_concept}
                        onChange={(e) =>
                          patchQuestion(q.question_id, {
                            related_concept: e.target.value,
                          })
                        }
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                      />
                    </label>
                  </div>

                  {/* Response fields */}
                  <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      Response fields
                    </p>
                    {q.response_fields.map((f, fi) => (
                      <div
                        key={f.field_id}
                        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-500">
                            Response {fi + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteField(q.question_id, f.field_id)}
                            className="text-xs font-semibold text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold uppercase text-slate-500">
                              Label <span className="text-[#BA0C2F]">*</span>
                            </span>
                            <input
                              value={f.label}
                              onChange={(e) =>
                                patchField(q.question_id, f.field_id, {
                                  label: e.target.value,
                                })
                              }
                              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold uppercase text-slate-500">
                              Response type <span className="text-[#BA0C2F]">*</span>
                            </span>
                            <select
                              value={f.response_type}
                              onChange={(e) =>
                                changeFieldType(
                                  q.question_id,
                                  f.field_id,
                                  e.target.value as SurveyResponseType,
                                )
                              }
                              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                            >
                              {(
                                Object.keys(
                                  RESPONSE_TYPE_LABELS,
                                ) as SurveyResponseType[]
                              ).map((t) => (
                                <option key={t} value={t}>
                                  {RESPONSE_TYPE_LABELS[t]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] font-semibold uppercase text-slate-500">
                            Example / helper
                          </span>
                          <input
                            value={f.helper ?? ""}
                            onChange={(e) =>
                              patchField(q.question_id, f.field_id, {
                                helper: e.target.value,
                              })
                            }
                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                          />
                        </label>

                        {/* Choice options */}
                        {isChoice(f.response_type) && (
                          <div className="flex flex-col gap-2">
                            <span className="text-[11px] font-semibold uppercase text-slate-500">
                              Options (at least 2)
                            </span>
                            {(f.options ?? ["", ""]).map((opt, oi) => (
                              <div key={oi} className="flex items-center gap-2">
                                <input
                                  value={opt}
                                  onChange={(e) => {
                                    const options = [...(f.options ?? [])];
                                    options[oi] = e.target.value;
                                    patchField(q.question_id, f.field_id, {
                                      options,
                                    });
                                  }}
                                  placeholder={`Option ${oi + 1}`}
                                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const options = (f.options ?? []).filter(
                                      (_, idx) => idx !== oi,
                                    );
                                    patchField(q.question_id, f.field_id, {
                                      options,
                                    });
                                  }}
                                  className="text-xs font-semibold text-red-600 hover:underline"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() =>
                                patchField(q.question_id, f.field_id, {
                                  options: [...(f.options ?? []), ""],
                                })
                              }
                              className="w-fit text-xs font-semibold text-[#BA0C2F] hover:underline"
                            >
                              + Add option
                            </button>
                          </div>
                        )}

                        {/* Sentence completion */}
                        {f.response_type === "sentence_completion" && (
                          <div className="flex flex-col gap-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] font-semibold uppercase text-slate-500">
                                Sentence text
                              </span>
                              <input
                                value={f.sentence_text ?? ""}
                                onChange={(e) =>
                                  patchField(q.question_id, f.field_id, {
                                    sentence_text: e.target.value,
                                  })
                                }
                                placeholder="e.g. When two objects collide, ___ pushes on ___."
                                className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                              />
                            </label>
                            <span className="text-[11px] font-semibold uppercase text-slate-500">
                              Blanks
                            </span>
                            {(f.blanks ?? []).map((b, bi) => (
                              <div key={b.blank_id} className="flex items-center gap-2">
                                <input
                                  value={b.label}
                                  onChange={(e) => {
                                    const blanks = [...(f.blanks ?? [])];
                                    blanks[bi] = { ...blanks[bi], label: e.target.value };
                                    patchField(q.question_id, f.field_id, {
                                      blanks,
                                    });
                                  }}
                                  placeholder={`Blank ${bi + 1} label`}
                                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#BA0C2F] focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const blanks = (f.blanks ?? []).filter(
                                      (_, idx) => idx !== bi,
                                    );
                                    patchField(q.question_id, f.field_id, {
                                      blanks,
                                    });
                                  }}
                                  className="text-xs font-semibold text-red-600 hover:underline"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() =>
                                patchField(q.question_id, f.field_id, {
                                  blanks: [
                                    ...(f.blanks ?? []),
                                    { blank_id: newId(), label: "" },
                                  ],
                                })
                              }
                              className="w-fit text-xs font-semibold text-[#BA0C2F] hover:underline"
                            >
                              + Add blank
                            </button>
                          </div>
                        )}

                        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                          <input
                            type="checkbox"
                            checked={f.required ?? false}
                            onChange={(e) =>
                              patchField(q.question_id, f.field_id, {
                                required: e.target.checked,
                              })
                            }
                          />
                          Required
                        </label>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addField(q.question_id)}
                      className="w-fit rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-white"
                    >
                      + Add response field
                    </button>
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
            </div>

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
                Preview
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
          </section>
        )}

        {mode === "edit" && draft && previewing && (
          <SurveyPreview survey={draft} onBack={() => setPreviewing(false)} />
        )}
      </div>
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
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Preview</h1>
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-semibold text-slate-500 hover:text-slate-700"
        >
          ← Back to editing
        </button>
      </div>

      <div className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {survey.title || "Untitled survey"}
          </h2>
          {survey.description && (
            <p className="mt-1 text-sm text-slate-600">{survey.description}</p>
          )}
          {survey.student_instructions && (
            <p className="mt-2 text-sm italic text-slate-500">
              {survey.student_instructions}
            </p>
          )}
        </div>

        {survey.questions.map((q, qi) => (
          <div key={q.question_id} className="flex flex-col gap-3 border-t border-slate-100 pt-5">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {qi + 1}. {q.prompt || "(no prompt)"}
              </p>
              {q.instructions && (
                <p className="mt-0.5 text-xs text-slate-500">{q.instructions}</p>
              )}
            </div>
            {q.response_fields.map((f) => (
              <div key={f.field_id} className="flex flex-col gap-1 pl-4">
                <span className="text-xs font-semibold text-slate-600">
                  {f.label || "(no label)"}
                  {f.required ? " *" : ""}
                </span>
                {f.helper && (
                  <span className="text-[11px] text-slate-400">{f.helper}</span>
                )}
                {f.response_type === "short_text" && (
                  <input
                    disabled
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                  />
                )}
                {f.response_type === "long_text" && (
                  <textarea
                    disabled
                    rows={3}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                  />
                )}
                {isChoice(f.response_type) &&
                  (f.options ?? []).map((opt, oi) => (
                    <label
                      key={oi}
                      className="flex items-center gap-2 text-sm text-slate-600"
                    >
                      <input
                        type={
                          f.response_type === "multiple_choice"
                            ? "checkbox"
                            : "radio"
                        }
                        disabled
                        name={f.field_id}
                      />
                      {opt || `Option ${oi + 1}`}
                    </label>
                  ))}
                {f.response_type === "sentence_completion" && (
                  <div className="text-sm text-slate-600">
                    <p>{f.sentence_text}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {(f.blanks ?? []).map((b) => (
                        <span
                          key={b.blank_id}
                          className="rounded-lg border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500"
                        >
                          {b.label || "blank"}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
