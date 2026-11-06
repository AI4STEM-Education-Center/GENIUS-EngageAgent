"use client";

import type { ReactNode } from "react";
import type { FieldChange, LessonChanges } from "@/lib/lessons";
import { MISCONCEPTION_TEXT, type MisconceptionId } from "@/lib/misconceptions";
import { ui } from "./lesson-ui";

const shown = (value: string) => value.trim() ? value : "(empty)";

function Change({ field, before, after }: FieldChange) {
  return (
    <li className="min-w-0 break-words">
      <b className="font-semibold text-ink">{field}: </b>
      <del className="text-bad">{shown(before)}</del>
      <span aria-hidden="true"> → </span><span className="sr-only"> changed to </span>
      <ins className="text-ok no-underline">{shown(after)}</ins>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className={ui.eyebrow}>{title}</h4>
      <ul className="mt-2 grid gap-2 text-sm text-ink-2">{children}</ul>
    </section>
  );
}

const misconception = (id: MisconceptionId) => `${id}: ${MISCONCEPTION_TEXT[id] ?? ""}`;

/** The field-by-field list of what changed between two versions. */
export default function LessonChangesView({ changes, emptyMessage }: { changes: LessonChanges; emptyMessage: string }) {
  const { basics, coreIdeas: ideas, misconceptions, quizItems: items } = changes;
  if (!changes.hasChanges) return <p className={ui.hint}>{emptyMessage}</p>;
  return (
    <div className="grid min-w-0 gap-4">
      {basics.length > 0 && <Group title="Basics">{basics.map((change) => <Change key={change.field} {...change} />)}</Group>}
      {(ideas.added.length + ideas.removed.length + ideas.changed.length > 0 || ideas.reordered) && (
        <Group title="Core ideas">
          {ideas.added.map((idea) => <li key={`added-${idea}`} className="break-words"><b className="font-semibold text-ok">Added: </b>{idea}</li>)}
          {ideas.removed.map((idea) => <li key={`removed-${idea}`} className="break-words"><b className="font-semibold text-bad">Removed: </b>{idea}</li>)}
          {ideas.changed.map((idea) => <Change key={idea.before} field="Changed" before={idea.before} after={idea.after} />)}
          {ideas.reordered && <li>The order changed.</li>}
        </Group>
      )}
      {misconceptions.added.length + misconceptions.removed.length > 0 && (
        <Group title="Misconceptions">
          {misconceptions.added.map((id) => <li key={id} className="break-words"><b className="font-semibold text-ok">Added: </b>{misconception(id)}</li>)}
          {misconceptions.removed.map((id) => <li key={id} className="break-words"><b className="font-semibold text-bad">Removed: </b>{misconception(id)}</li>)}
        </Group>
      )}
      {(items.added.length + items.removed.length + items.changed.length > 0 || items.reordered) && (
        <Group title="Quiz items">
          {items.added.map((item) => <li key={item.id} className="break-words"><b className="font-semibold text-ok">Added Q{item.number}: </b>{shown(item.stem)}</li>)}
          {items.removed.map((item) => <li key={item.id} className="break-words"><b className="font-semibold text-bad">Removed: </b>{shown(item.stem)}</li>)}
          {items.changed.map((item) => (
            <li key={item.id} className="min-w-0 rounded-lg border border-line-2 p-3">
              <p className="break-words"><b className="font-semibold text-ink">Changed Q{item.number}: </b>{shown(item.stem)}</p>
              <ul className="mt-2 grid gap-1.5 border-l-2 border-line pl-3">
                {item.changes.map((change) => <Change key={change.field} {...change} />)}
              </ul>
            </li>
          ))}
          {items.reordered && <li>The order changed.</li>}
        </Group>
      )}
    </div>
  );
}
