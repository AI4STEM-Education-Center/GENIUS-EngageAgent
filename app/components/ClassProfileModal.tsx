"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { scopedTaskFetch, type ClientAuthScope } from "@/lib/client-auth";
import {
  CLASS_TYPES,
  EMPTY_CLASS_PROFILE,
  GROUP_ALTERNATIVES,
  SCHOOL_LOCALES,
  STUDENT_GROUPS,
  toggleGroupAlternative,
  toggleStudentGroup,
  type ClassProfile,
  type ClassProfileAnswers,
} from "@/lib/class-profile";

/** The class, plus the task when it is opened from inside one (the class page has no task). */
type Scope = ClientAuthScope & { classId: string };

/** Loads the class profile; null when the teacher hasn't been asked yet. */
export async function loadClassProfile(scope: Scope): Promise<ClassProfile | null> {
  const params = new URLSearchParams({ classId: scope.classId });
  if (scope.assignmentId) params.set("assignmentId", scope.assignmentId);
  const res = await scopedTaskFetch(scope, `/api/class-profile?${params}`);
  if (!res.ok) throw new Error("Couldn't load the class profile.");
  return ((await res.json()) as { classProfile: ClassProfile | null }).classProfile;
}

/**
 * Everything a teacher page needs for the class profile: loads it and shows
 * "Class profile saved" after a save. Call `openEditor` from a "Class profile"
 * button. The form never opens by itself: it is first answered when the class
 * is added (AddClassDialog), and only shown and edited from here on.
 */
export function useClassProfile({ classId, assignmentId, enabled }: Scope & { enabled: boolean }) {
  const [profile, setProfile] = useState<ClassProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadClassProfile({ classId, assignmentId })
      .then((loaded) => {
        if (cancelled) return;
        setProfile(loaded ?? null);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [classId, assignmentId, enabled]);

  useEffect(() => {
    if (!savedNotice) return;
    const timer = setTimeout(() => setSavedNotice(false), 3000);
    return () => clearTimeout(timer);
  }, [savedNotice]);

  const element = (
    <>
      {open && (
        <ClassProfileModal
          classId={classId}
          assignmentId={assignmentId}
          profile={profile}
          onClose={() => setOpen(false)}
          onSaved={(saved) => {
            setProfile(saved);
            setOpen(false);
            setSavedNotice(saved.status === "saved");
          }}
        />
      )}
      {savedNotice && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          Class profile saved
        </div>
      )}
    </>
  );

  return { profile, loaded, openEditor: () => setOpen(true), element };
}

type Props = {
  classId: string;
  assignmentId?: string;
  profile: ClassProfile | null;
  onClose: () => void;
  onSaved: (profile: ClassProfile) => void;
};

const toAnswers = (profile: ClassProfile | null): ClassProfileAnswers => {
  if (!profile) return EMPTY_CLASS_PROFILE;
  const { locale, groups, groupAlternative, classType, englishLearners, iepOr504 } = profile;
  return {
    locale: locale ?? null,
    groups: groups ?? [],
    groupAlternative: groupAlternative ?? null,
    classType: classType ?? null,
    englishLearners: englishLearners === true,
    iepOr504: iepOr504 === true,
  };
};

const choice = (selected: boolean) =>
  `rounded-xl border p-4 text-left transition ${
    selected ? "border-brand bg-brand-light ring-1 ring-brand" : "border-line bg-white hover:border-slate-300"
  }`;

/** Seeing or editing the class profile. Adding a class uses the same form (AddClassDialog). */
export default function ClassProfileModal({ classId, assignmentId, profile, onClose, onSaved }: Props) {
  const [answers, setAnswers] = useState<ClassProfileAnswers>(() => toAnswers(profile));
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setNotice("");
    try {
      const res = await scopedTaskFetch({ classId, assignmentId }, "/api/class-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, ...(assignmentId ? { assignmentId } : {}), profile: answers }),
      });
      const data = (await res.json()) as { classProfile?: ClassProfile; error?: string };
      if (!res.ok || !data.classProfile) throw new Error(data.error || "Couldn't save the class profile.");
      onSaved(data.classProfile);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't save the class profile.");
      setSaving(false);
    }
  };

  return (
    <ClassProfileForm
      eyebrow="Class profile"
      title="Tell EngageAgent about this class"
      answers={answers}
      onAnswers={setAnswers}
      notice={notice}
      onNotice={setNotice}
      saving={saving}
      saveLabel="Save"
      onClose={onClose}
      onSave={save}
    />
  );
}

type FormProps = {
  eyebrow?: string;
  title: string;
  /** Anything asked before the three questions, like the name of a new class. */
  intro?: ReactNode;
  answers: ClassProfileAnswers;
  onAnswers: (answers: ClassProfileAnswers) => void;
  notice: string;
  onNotice: (notice: string) => void;
  saving: boolean;
  saveLabel: string;
  canSave?: boolean;
  onClose: () => void;
  onSave: () => void;
};

/** The dialog with the three class profile questions, used to add a class and to edit a profile. */
export function ClassProfileForm({ eyebrow, title, intro, answers, onAnswers: setAnswers, notice, onNotice: setNotice, saving, saveLabel, canSave = true, onClose, onSave }: FormProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move keyboard focus into the dialog when it opens.
  useEffect(() => dialogRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSave && !saving) onSave();
  };

  const pickGroup = (group: (typeof STUDENT_GROUPS)[number]["id"]) => {
    const result = toggleStudentGroup(answers, group);
    setAnswers(result.answers);
    setNotice(result.full ? "Up to three — remove one first" : "");
  };

  const rankOf = (group: string) => answers.groups.indexOf(group as (typeof answers.groups)[number]) + 1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-profile-title"
        className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl outline-none"
      >
        <form onSubmit={submit}>
          <div className="border-b border-line-2 px-6 pb-4 pt-6">
            {eyebrow && <p className="text-xs font-semibold uppercase tracking-widest text-faint">{eyebrow}</p>}
            <h2 id="class-profile-title" className="mt-1 text-2xl font-semibold text-ink">
              {title}
            </h2>
            {intro}
            <p className="mt-2 text-sm text-mute">Used only to tailor materials. Never used to describe or label students.</p>
          </div>

          <div className="grid gap-4 px-6 py-5">
            <fieldset className="rounded-2xl border border-line p-5">
              <legend className="float-left w-full font-semibold text-ink">
                <span className="mr-2 text-brand">1</span>Which best describes where your school is located?
              </legend>
              <div className="clear-left mt-3 grid gap-3 sm:grid-cols-4">
                {SCHOOL_LOCALES.map((locale) => (
                  <button
                    key={locale.id}
                    type="button"
                    aria-pressed={answers.locale === locale.id}
                    className={choice(answers.locale === locale.id)}
                    onClick={() => setAnswers({ ...answers, locale: locale.id })}
                  >
                    <span className="block text-ink">{locale.label}</span>
                    <span className="mt-1 block text-sm text-mute">{locale.description}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="rounded-2xl border border-line p-5">
              <legend className="float-left w-full font-semibold text-ink">
                <span className="mr-2 text-brand">2</span>Which groups are most represented in this class?
              </legend>
              <p className="clear-left pt-1 text-sm text-mute">Up to 3, most represented first.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {STUDENT_GROUPS.map((group) => {
                  const rank = rankOf(group.id);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      aria-pressed={rank > 0}
                      className={`${choice(rank > 0)} flex items-center gap-3`}
                      onClick={() => pickGroup(group.id)}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                          rank ? "border-brand bg-brand text-white" : "border-slate-300"
                        }`}
                      >
                        {rank || ""}
                      </span>
                      <span className="text-ink">{group.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                {GROUP_ALTERNATIVES.map((alternative) => (
                  <button
                    key={alternative.id}
                    type="button"
                    aria-pressed={answers.groupAlternative === alternative.id}
                    className={`${choice(answers.groupAlternative === alternative.id)} px-4 py-2 font-medium`}
                    onClick={() => {
                      setAnswers(toggleGroupAlternative(answers, alternative.id));
                      setNotice("");
                    }}
                  >
                    {alternative.label}
                  </button>
                ))}
              </div>
              {answers.groups.length > 0 && (
                <p className="mt-3 text-sm text-mute">
                  Order: {answers.groups.map((id) => STUDENT_GROUPS.find((g) => g.id === id)?.label).join(", ")}
                </p>
              )}
            </fieldset>

            <fieldset className="rounded-2xl border border-line p-5">
              <legend className="float-left w-full font-semibold text-ink">
                <span className="mr-2 text-brand">3</span>What type of class is this?
              </legend>
              <div className="clear-left mt-3 grid gap-3 sm:grid-cols-3">
                {CLASS_TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    aria-pressed={answers.classType === type.id}
                    className={choice(answers.classType === type.id)}
                    onClick={() => setAnswers({ ...answers, classType: type.id })}
                  >
                    <span className="text-ink">{type.label}</span>
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-2">
                <label className="flex items-center gap-3 text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-brand"
                    checked={answers.englishLearners}
                    onChange={(e) => setAnswers({ ...answers, englishLearners: e.target.checked })}
                  />
                  Includes English learners (ELs)
                </label>
                <label className="flex items-center gap-3 text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-brand"
                    checked={answers.iepOr504}
                    onChange={(e) => setAnswers({ ...answers, iepOr504: e.target.checked })}
                  />
                  Includes students with IEPs or Section 504 plans
                </label>
              </div>
            </fieldset>
          </div>

          <div className="flex items-center gap-3 border-t border-line-2 px-6 py-4">
            <p role="status" aria-live="polite" className="flex-1 text-sm text-brand">
              {notice}
            </p>
            <button
              type="button"
              disabled={saving}
              className="rounded-full px-4 py-2 text-sm font-semibold text-ink-2 hover:bg-canvas disabled:opacity-50"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !canSave}
              className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {saving ? "Saving…" : saveLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
