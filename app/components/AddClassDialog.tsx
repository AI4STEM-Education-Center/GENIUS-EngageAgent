"use client";

import { useEffect, useRef, useState } from "react";
import { EMPTY_CLASS_PROFILE, hasClassProfileAnswers, type ClassProfileAnswers } from "@/lib/class-profile";
import { ClassProfileForm } from "./ClassProfileModal";

export type AddedClass = { classroom: { id: string }; profileSaved?: boolean };

/**
 * Adding a class (#173): the class name and the class profile are one step, so
 * a class starts with its profile. Only the name is required; a teacher who
 * leaves the questions blank can add them later on the class page.
 */
export default function AddClassDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (added: AddedClass) => void }) {
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<ClassProfileAnswers>(EMPTY_CLASS_PROFILE);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

  // Runs after the form focuses the dialog, so typing starts in the name box.
  useEffect(() => nameInput.current?.focus(), []);

  const save = async () => {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createClass", name, ...(hasClassProfileAnswers(answers) ? { profile: answers } : {}) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.classroom) throw new Error(result.error || "Couldn't add the class.");
      onAdded(result);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't add the class.");
      setSaving(false);
    }
  };

  return (
    <ClassProfileForm
      title="Add a class"
      intro={
        <>
          <label htmlFor="new-class-name" className="mt-4 block text-sm font-medium text-ink">Class name</label>
          <input
            id="new-class-name"
            ref={nameInput}
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-2 focus:outline-brand-light"
          />
          <h3 className="mt-6 text-lg font-semibold text-ink">Tell EngageAgent about this class</h3>
          <p className="mt-1 text-sm text-mute">Optional. You can leave these blank and add them later on the class page.</p>
        </>
      }
      answers={answers}
      onAnswers={setAnswers}
      notice={notice}
      onNotice={setNotice}
      saving={saving}
      saveLabel="Add class"
      canSave={Boolean(name.trim())}
      onClose={onClose}
      onSave={save}
    />
  );
}
