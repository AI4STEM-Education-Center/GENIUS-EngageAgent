"use client";

import type { ReactNode } from "react";
import { Check, Lock } from "lucide-react";

export type StepTab<Id extends string> = {
  id: Id;
  title: string;
  /** Short status under the title, e.g. "Published", "Not available yet". */
  status: string;
  /** Shown in the circle: a step number or an icon. */
  marker: ReactNode;
  done?: boolean;
  locked?: boolean;
};

type Props<Id extends string> = {
  label: string;
  tabs: StepTab<Id>[];
  activeId: Id;
  onSelect: (id: Id) => void;
};

// The step bar under the header, shared by the teacher steps and the student
// tabs (#172). A finished step shows a check unless it is the open one; a
// locked step shows a lock and can't be opened.
export default function StepTabs<Id extends string>({ label, tabs, activeId, onSelect }: Props<Id>) {
  return (
    <nav aria-label={label} className="flex gap-0.5 overflow-x-auto border-b border-line bg-white px-5 sm:px-6">
      {tabs.map(tab => {
        const active = tab.id === activeId;
        const showDone = tab.done && !active;
        return (
          <button key={tab.id} type="button" onClick={() => onSelect(tab.id)} disabled={tab.locked}
            aria-current={active ? "step" : undefined}
            className={`flex h-[52px] shrink-0 items-center gap-2.5 whitespace-nowrap border-b-2 px-4 text-left text-[14.5px] transition ${
              active ? "border-brand font-semibold text-ink" : "border-transparent font-medium text-ink-2 hover:bg-canvas"
            } disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent`}>
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
              active ? "bg-brand text-white" : showDone ? "bg-ok text-white" : "bg-line-2 text-mute"
            }`}>
              {tab.locked ? <Lock size={13} /> : showDone ? <Check size={14} /> : tab.marker}
            </span>
            <span className="leading-tight">
              {tab.title}
              <span className="block text-xs font-medium text-mute">{tab.status}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
