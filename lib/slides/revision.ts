import type { SlideDeck } from "./model";

export function slideRevisionSummary(before: SlideDeck, after: SlideDeck): string {
  const textPages: number[] = [], notesPages: number[] = [];
  after.draft.slides.forEach((slide, i) => {
    const previous = before.draft.slides[i];
    if (!previous || slide.stage !== previous.stage || slide.title !== previous.title || slide.body !== previous.body ||
      slide.task !== previous.task || slide.videoUrl !== previous.videoUrl) textPages.push(i + 1);
    if (!previous || JSON.stringify(slide.teacherNotes) !== JSON.stringify(previous.teacherNotes)) notesPages.push(i + 1);
  });
  const pages = (numbers: number[]) => `slide${numbers.length === 1 ? "" : "s"} ${numbers.join(", ")}`;
  const changes: string[] = [];
  if (before.draft.title !== after.draft.title) changes.push("Deck title changed.");
  if (before.draft.slides.length !== after.draft.slides.length) changes.push(`Slide count changed from ${before.draft.slides.length} to ${after.draft.slides.length}.`);
  if (textPages.length) changes.push(`Student-facing content changed on ${pages(textPages)}.`);
  if (notesPages.length) changes.push(`Teacher notes changed on ${pages(notesPages)}.`);
  const assetIds = new Set([...Object.keys(before.assets), ...Object.keys(after.assets)]);
  if ([...assetIds].some(id => before.assets[id]?.data !== after.assets[id]?.data)) changes.push("Illustrations changed.");
  else if (before.draft.visuals.length !== after.draft.visuals.length || after.draft.visuals.some((visual, i) => {
    const previous = before.draft.visuals[i];
    return visual.id !== previous.id || visual.prompt !== previous.prompt || visual.caption !== previous.caption || visual.alt !== previous.alt;
  })) changes.push("Illustration details changed.");
  return changes.join(" ") || "Slide text, links, teacher notes and illustrations match the previous version.";
}

/** Keep the teacher's bounded request ahead of optional AI findings, including
 * when later automatic correction rounds introduce additional findings. */
export function slideRevisionFeedback(teacherRequest: string, findings: readonly string[], maxLength = 6000): string {
  const request = teacherRequest.trim();
  const uniqueFindings = [...new Set(findings.map(finding => finding.trim()).filter(Boolean))];
  return [
    request ? `Teacher revision request (priority over AI suggestions, within scientific and strategy requirements):\n${request}` : "",
    uniqueFindings.length ? `AI review findings (address within the teacher's requested scope):\n${uniqueFindings.join("\n")}` : "",
  ].filter(Boolean).join("\n\n").slice(0, maxLength);
}

export const SLIDE_REVISION_RULES = `REVISION SCOPE AND PRIORITY:
The Teacher revision request in correctionRequest defines the intended change and takes priority over AI review findings where they conflict, while scientific accuracy and the selected teaching strategy remain required. Retain that request throughout automatic corrections; AI suggestions do not authorize a broader redesign.
For a local revision, preserve the existing event, apparatus, actors, left/right orientation, motion directions, contact relationships, prediction property and outcome. Change only the requested fields and their directly affected dependencies. Preserve adequate titles, student tasks, teacher notes and image plans exactly. An image simplification is not permission to replace the story, add a new mechanism or reverse the motion to create a stronger discrepancy.
Change those established conditions only when the teacher explicitly requests it or a definite scientific error cannot be corrected without that change. Make the smallest scientifically necessary exception and explain it briefly in the affected PRIVATE teacher notes; do not silently substitute a different phenomenon or force a disagreement with a learner prediction.
Keep every directly affected title, body, task, teacher note, visual prompt, caption and alt text consistent with the same revised event. If an intended change affects what an image must show, update its visual prompt explicitly; never describe a new scene while keeping a contradictory old image plan. Leave unrelated image plans exactly unchanged so adequate images can be reused. Return the complete corrected draft in the existing schema and selected method.`;
