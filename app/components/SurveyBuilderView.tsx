"use client";

import { useCallback, useEffect, useState } from "react";
import { resolveSurveyStatus, validateSchedule } from "@/lib/survey-schedule";
import type { Survey, SurveyItem, SurveyStatus } from "@/lib/types";

type Props = {
  classId: string;
  assignmentId: string;
};

/** Purpose options offered for teacher-authored surveys (UC-SV-01_V1). */
const PURPOSE_OPTIONS: Array<{ value: SurveyItem["category"]; label: string }> = [
  { value: "familiarity", label: "Familiarity" },
  { value: "follow_up", label: "Follow-up" },
  { value: "unspecified", label: "Unspecified" },
];

type TextLength = "short" | "long";

const RESPONSE_TYPE_OPTIONS: Array<{ value: TextLength; label: string }> = [
  { value: "short", label: "Short answer" },
  { value: "long", label: "Long answer" },
];

const newId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Splits an ISO timestamp into the local date/time strings the inputs use. */
const toLocalParts = (iso?: string) => {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
};

/** Combines the local date/time inputs back into an ISO timestamp. */
const toIso = (date: string, time: string) => {
  if (!date || !time) return "";
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};

const STATUS_STYLES: Record<SurveyStatus, string> = {
  draft: "bg-amber-100 text-amber-700",
  scheduled: "bg-sky-100 text-sky-700",
  published: "bg-emerald-100 text-emerald-700",
  closed: "bg-slate-200 text-slate-600",
};

const formatWhen = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};

const emptyPublishForm = {
  publishDate: "",
  publishTime: "",
  dueDate: "",
  dueTime: "",
  allowLate: false,
  allowEditing: false,
  showImmediately: true,
};

/**
 * V1 questions have exactly one free-text response field. It is stored in the
 * shared SurveyResponseField shape so teacher-authored surveys and the
 * built-in beginning-of-lesson surveys share one model.
 */
const emptyQuestion = (questionNumber: number): SurveyItem => ({
  item_id: newId(),
  question_number: questionNumber,
  category: "unspecified",
  stem: "",
  example: "",
  related_concept: "",
  response_fields: [
    {
      field_id: newId(),
      label: "Your answer",
      response_type: "text",
      text_length: "short",
    },
  ],
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

const textLengthOf = (q: SurveyItem): TextLength =>
  q.response_fields[0]?.text_length ?? "short";

/** Returns human-readable validation problems (empty = valid). */
export const validateSurvey = (survey: Survey): string[] => {
  const errors: string[] = [];
  if (!survey.title.trim()) errors.push("Survey title is required.");
  if (!survey.daily_experience_topic.trim())
    errors.push("Daily experience topic is required.");
  if (survey.questions.length === 0) errors.push("Add at least one question.");

  survey.questions.forEach((q, i) => {
    const label = `Question ${i + 1}`;
    if (!q.stem.trim()) errors.push(`${label}: prompt is required.`);
    if (q.response_fields.length === 0)
      errors.push(`${label}: a response type is required.`);
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

  // Publish settings (UC-SV-03, #80)
  const [publishTarget, setPublishTarget] = useState<Survey | null>(null);
  const [publishForm, setPublishForm] = useState(emptyPublishForm);
  const [publishing, setPublishing] = useState(false);
  const [publishErrors, setPublishErrors] = useState<string[]>([]);

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

  const patchDraft = (patch: Partial<Survey>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const patchQuestion = (itemId: string, patch: Partial<SurveyItem>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((q) =>
              q.item_id === itemId ? { ...q, ...patch } : q,
            ),
          }
        : d,
    );

  const setResponseType = (itemId: string, length: TextLength) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((q) =>
              q.item_id === itemId
                ? {
                    ...q,
                    response_fields: q.response_fields.length
                      ? q.response_fields.map((f, i) =>
                          i === 0 ? { ...f, text_length: length } : f,
                        )
                      : [
                          {
                            field_id: newId(),
                            label: "Your answer",
                            response_type: "text" as const,
                            text_length: length,
                          },
                        ],
                  }
                : q,
            ),
          }
        : d,
    );

  const renumber = (questions: SurveyItem[]) =>
    questions.map((q, i) => ({ ...q, question_number: i + 1 }));

  const addQuestion = () =>
    setDraft((d) =>
      d
        ? {
            ...d,
            questions: [...d.questions, emptyQuestion(d.questions.length + 1)],
          }
        : d,
    );

  const duplicateQuestion = (itemId: string) =>
    setDraft((d) => {
      if (!d) return d;
      const source = d.questions.find((q) => q.item_id === itemId);
      if (!source) return d;
      const copy: SurveyItem = {
        ...JSON.parse(JSON.stringify(source)),
        item_id: newId(),
        response_fields: source.response_fields.map((f) => ({
          ...f,
          field_id: newId(),
        })),
      };
      return { ...d, questions: renumber([...d.questions, copy]) };
    });

  const deleteQuestion = (itemId: string) =>
    setDraft((d) =>
      d
        ? { ...d, questions: renumber(d.questions.filter((q) => q.item_id !== itemId)) }
        : d,
    );

  const moveQuestion = (itemId: string, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const idx = d.questions.findIndex((q) => q.item_id === itemId);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= d.questions.length) return d;
      const next = [...d.questions];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...d, questions: renumber(next) };
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

  const openPublish = (survey: Survey) => {
    const publishParts = toLocalParts(survey.schedule?.publish_at);
    const dueParts = toLocalParts(survey.schedule?.due_at);
    setPublishTarget(survey);
    setPublishForm({
      publishDate: publishParts.date,
      publishTime: publishParts.time,
      dueDate: dueParts.date,
      dueTime: dueParts.time,
      allowLate: survey.schedule?.allow_late_submissions ?? false,
      allowEditing: survey.schedule?.allow_response_editing ?? false,
      showImmediately: survey.schedule?.show_immediately ?? true,
    });
    setPublishErrors([]);
    setSavedNotice(null);
  };

  const submitPublish = async () => {
    if (!publishTarget) return;
    const publishAt = toIso(publishForm.publishDate, publishForm.publishTime);
    const dueAt = toIso(publishForm.dueDate, publishForm.dueTime);

    const problems = validateSchedule({ publish_at: publishAt, due_at: dueAt });
    setPublishErrors(problems);
    if (problems.length > 0) return;

    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/surveys/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          assignmentId,
          surveyId: publishTarget.survey_id,
          publishAt,
          dueAt,
          allowLateSubmissions: publishForm.allowLate,
          allowResponseEditing: publishForm.allowEditing,
          showImmediately: publishForm.showImmediately,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          errors?: string[];
        };
        if (data.errors?.length) {
          setPublishErrors(data.errors);
          return;
        }
        throw new Error(data.error ?? `Publish failed (${res.status}).`);
      }
      setSavedNotice("Publish settings saved.");
      await loadSurveys();
      setPublishTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  };

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
      {mode === "list" && !publishTarget && (
        <>
          <div className="flex items-center justify-between">
            <p className={labelClass}>Teacher-created surveys</p>
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
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
              <p className="text-sm font-semibold text-slate-700">
                No teacher-created surveys yet
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Click “Add survey” to write your own questions for this learning task.
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
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${STATUS_STYLES[resolveSurveyStatus(s)]}`}
                      >
                        {resolveSurveyStatus(s)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {s.questions.length} question
                      {s.questions.length === 1 ? "" : "s"}
                      {s.daily_experience_topic
                        ? ` · ${s.daily_experience_topic}`
                        : ""}
                    </p>
                    {s.schedule && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        Opens {formatWhen(s.schedule.publish_at)} · Due{" "}
                        {formatWhen(s.schedule.due_at)}
                        {s.schedule.allow_late_submissions ? " · late allowed" : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(s)}
                      className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => openPublish(s)}
                      className="rounded-full border border-[#BA0C2F] px-4 py-2 text-xs font-semibold text-[#BA0C2F] transition hover:bg-[#BA0C2F]/5"
                    >
                      {s.schedule ? "Publish settings" : "Publish"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ---------------- publish settings (UC-SV-03, #80) ---------------- */}
      {publishTarget && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              {publishTarget.schedule ? "Edit publish settings" : "Publish survey"}
            </p>
            <button
              type="button"
              onClick={() => setPublishTarget(null)}
              className="text-sm font-semibold text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>
                  Publish date <span className="text-[#BA0C2F]">*</span>
                </span>
                <input
                  type="date"
                  value={publishForm.publishDate}
                  onChange={(e) =>
                    setPublishForm((f) => ({ ...f, publishDate: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>
                  Publish time <span className="text-[#BA0C2F]">*</span>
                </span>
                <input
                  type="time"
                  value={publishForm.publishTime}
                  onChange={(e) =>
                    setPublishForm((f) => ({ ...f, publishTime: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>
                  Due date <span className="text-[#BA0C2F]">*</span>
                </span>
                <input
                  type="date"
                  value={publishForm.dueDate}
                  onChange={(e) =>
                    setPublishForm((f) => ({ ...f, dueDate: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>
                  Due time <span className="text-[#BA0C2F]">*</span>
                </span>
                <input
                  type="time"
                  value={publishForm.dueTime}
                  onChange={(e) =>
                    setPublishForm((f) => ({ ...f, dueTime: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={publishForm.allowLate}
                  onChange={(e) =>
                    setPublishForm((f) => ({ ...f, allowLate: e.target.checked }))
                  }
                />
                Allow late submissions
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={publishForm.allowEditing}
                  onChange={(e) =>
                    setPublishForm((f) => ({ ...f, allowEditing: e.target.checked }))
                  }
                />
                Allow students to edit responses after submitting
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={publishForm.showImmediately}
                  onChange={(e) =>
                    setPublishForm((f) => ({
                      ...f,
                      showImmediately: e.target.checked,
                    }))
                  }
                />
                Show the survey immediately after the publish time
              </label>
            </div>
          </div>

          {/* Summary before publishing */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className={labelClass}>Summary</p>
            <dl className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
              <div>
                <dt className="inline font-semibold text-slate-700">Survey: </dt>
                <dd className="inline">{publishTarget.title}</dd>
              </div>
              <div>
                <dt className="inline font-semibold text-slate-700">Class: </dt>
                <dd className="inline">{classId}</dd>
              </div>
              <div>
                <dt className="inline font-semibold text-slate-700">Opens: </dt>
                <dd className="inline">
                  {formatWhen(
                    toIso(publishForm.publishDate, publishForm.publishTime),
                  ) || "—"}
                </dd>
              </div>
              <div>
                <dt className="inline font-semibold text-slate-700">Due: </dt>
                <dd className="inline">
                  {formatWhen(toIso(publishForm.dueDate, publishForm.dueTime)) ||
                    "—"}
                </dd>
              </div>
              <div>
                <dt className="inline font-semibold text-slate-700">Questions: </dt>
                <dd className="inline">{publishTarget.questions.length}</dd>
              </div>
              <div>
                <dt className="inline font-semibold text-slate-700">
                  Late submissions:{" "}
                </dt>
                <dd className="inline">
                  {publishForm.allowLate ? "Allowed" : "Not allowed"}
                </dd>
              </div>
            </dl>
          </div>

          {publishErrors.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700">
                Please fix the following:
              </p>
              <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
                {publishErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={submitPublish}
              disabled={publishing}
              className="inline-flex items-center justify-center rounded-xl bg-[#BA0C2F] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#9a0a27] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {publishing
                ? "Saving…"
                : publishTarget.schedule
                  ? "Save publish settings"
                  : "Publish"}
            </button>
          </div>
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

          {draft.questions.map((q, qi) => (
            <div
              key={q.item_id}
              className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">
                  Question {qi + 1}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveQuestion(q.item_id, -1)}
                    disabled={qi === 0}
                    title="Move up"
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveQuestion(q.item_id, 1)}
                    disabled={qi === draft.questions.length - 1}
                    title="Move down"
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateQuestion(q.item_id)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteQuestion(q.item_id)}
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
                  value={q.stem}
                  onChange={(e) =>
                    patchQuestion(q.item_id, { stem: e.target.value })
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Instructions or example</span>
                <input
                  value={q.example ?? ""}
                  onChange={(e) =>
                    patchQuestion(q.item_id, { example: e.target.value })
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
                    value={q.category}
                    onChange={(e) =>
                      patchQuestion(q.item_id, {
                        category: e.target.value as SurveyItem["category"],
                      })
                    }
                    className={inputClass}
                  >
                    {PURPOSE_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Related concept</span>
                  <input
                    value={q.related_concept ?? ""}
                    onChange={(e) =>
                      patchQuestion(q.item_id, {
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
                    value={textLengthOf(q)}
                    onChange={(e) =>
                      setResponseType(q.item_id, e.target.value as TextLength)
                    }
                    className={inputClass}
                  >
                    {RESPONSE_TYPE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
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
            key={q.item_id}
            className="flex flex-col gap-2 border-t border-slate-100 pt-5"
          >
            <p className="text-sm font-semibold text-slate-800">
              {qi + 1}. {q.stem || "(no prompt)"}
            </p>
            {q.example && <p className="text-xs text-slate-500">{q.example}</p>}
            {textLengthOf(q) === "short" ? (
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
