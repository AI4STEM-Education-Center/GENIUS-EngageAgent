"use client";

import { focusKind, lessonCoreIdeas, lessonFocusMisconceptions, MAX_FOCUS_ITEMS, type StrategyFocus } from "@/lib/strategy-focus";

type Props = { lessonNumber: number; strategy: string; value: StrategyFocus; onChange: (value: StrategyFocus) => void; disabled?: boolean };

/** Shares the focus contract with Step 2 (#178); generation receives IDs, not free text. */
export default function MaterialFocusPicker({ lessonNumber, strategy, value, onChange, disabled }: Props) {
  const kind = focusKind(strategy);
  if (!kind) return null;
  const options = kind === "misconceptions"
    ? lessonFocusMisconceptions(lessonNumber).map(item => ({ id: item.code, label: item.statement, code: item.id ?? item.code }))
    : lessonCoreIdeas(lessonNumber).map((label, index) => ({ id: index, label, code: String(index + 1) }));
  const picked: (number | string)[] = value[kind];
  return <fieldset className="rounded-xl border border-line bg-white p-5" disabled={disabled}>
    <legend className="px-1 text-sm font-semibold text-ink">Focus · {kind === "misconceptions" ? "Misconceptions to target" : "Core ideas to explore"}</legend>
    <p className="mb-3 text-sm text-mute">Choose one or two. These guide the material; they do not imply every student holds these ideas.</p>
    <div className="grid gap-2">
      {options.map(option => {
        const selected = picked.includes(option.id);
        return <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${selected ? "border-brand bg-brand-light" : "border-line"}`}>
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand" checked={selected}
            disabled={disabled || (!selected && picked.length >= MAX_FOCUS_ITEMS)}
            onChange={() => {
              const next = selected ? picked.filter(id => id !== option.id) : [...picked, option.id];
              onChange(kind === "misconceptions" ? { ...value, misconceptions: next as string[] } : { ...value, coreIdeas: next as number[] });
            }} />
          <span><span className="mr-2 font-semibold text-mute">{option.code}</span>{option.label}</span>
        </label>;
      })}
    </div>
    {!picked.length && <p role="status" className="mt-3 text-sm text-warn">Select at least one focus before generating materials.</p>}
  </fieldset>;
}
