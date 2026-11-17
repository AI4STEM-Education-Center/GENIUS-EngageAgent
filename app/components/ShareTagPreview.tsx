import { getEngagementStrategyLabel } from "@/lib/engagement-strategies";
import type { GenerationRecord } from "@/lib/generation-record";
import type { StrategyFocus } from "@/lib/strategy-focus";

export function shareContextDefault(strategy: string, experience?: string) {
  return `${getEngagementStrategyLabel(strategy)} activity${experience ? ` using ${experience}` : ""}. Students observe, explain their reasoning and ask a scientific question.`;
}
export default function ShareTagPreview({ lessonNumber, strategy, focus, grade, quiz, experience, format, generation }: {
  lessonNumber: number; strategy: string; focus?: Partial<StrategyFocus>; grade: string; quiz: string; experience: string; format: "slides" | "video"; generation?: GenerationRecord;
}) {
  const focusText = [...(focus?.misconceptions || []), ...(focus?.coreIdeas || []).map(n => `Core idea ${n + 1}`)].join(" · ");
  return <section aria-label="Sharing tag preview" className="rounded-xl border border-line bg-canvas p-3">
    <h4 className="text-sm font-semibold">Tags other teachers will see</h4>
    <ul className="mt-2 flex flex-wrap gap-1.5">{[["Lesson", String(lessonNumber)], ["Strategy", getEngagementStrategyLabel(strategy)], ["Focus", focusText],
      ["Grade", grade], ["Prior quiz", quiz], ["Experience", experience], ["Format", format === "slides" ? "Slide deck" : "Video"]].map(([label, value]) =>
      <li key={label} className="rounded-md bg-white px-2 py-1 text-xs"><span className="text-mute">{label}: </span>{value || "Not supplied"}</li>)}</ul>
    <p className="mt-2 text-xs text-mute">{generation ? "An AI input record is available. These reviewed tags describe the version you are sharing." : "Original generation inputs were not recorded for this material. These tags are your description."}</p>
  </section>;
}
