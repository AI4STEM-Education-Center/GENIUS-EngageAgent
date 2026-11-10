"use client";

import { Users } from "lucide-react";
import { describeClassProfile } from "@/lib/class-profile";
import { useClassProfile } from "./ClassProfileModal";

/**
 * The class page's "Class profile" (#173): it is answered when the class is
 * added, and shown and edited here. Classes without one can add it here too.
 * Every task then shows it in Step 3, where it can also be edited.
 */
export default function ClassProfileSection({ classId, saveFailed = false }: { classId: string; saveFailed?: boolean }) {
  const classProfile = useClassProfile({ classId, enabled: true });
  const saved = classProfile.profile?.status === "saved";
  const summary = describeClassProfile(classProfile.profile);

  return (
    <section aria-labelledby="class-profile-heading" className="mt-6 max-w-xl rounded-md border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="class-profile-heading" className="flex items-center gap-2 text-lg font-semibold"><Users size={18} />Class profile</h2>
          <p className="mt-1 text-sm text-gray-600">Every task in this class uses it to tailor materials.</p>
        </div>
        {classProfile.loaded && (
          <button type="button" onClick={classProfile.openEditor} aria-label={saved ? "Edit class profile" : undefined}
            className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-gray-50">
            {saved ? "Edit" : "Add class profile"}
          </button>
        )}
      </div>
      {saved && (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          {[["Location", summary.location], ["Most represented groups", summary.groups], ["Class type", summary.classType], ["Supports", summary.supports]].map(([term, value]) => (
            <div key={term}><dt className="text-gray-500">{term}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>
          ))}
        </dl>
      )}
      {saveFailed && !saved
        ? <p role="alert" className="mt-3 text-sm text-red-800">Your class was added, but its profile didn&apos;t save. Please add it again.</p>
        : classProfile.loaded && !saved && <p className="mt-3 text-sm text-gray-500">Not set yet.</p>}
      {classProfile.element}
    </section>
  );
}
