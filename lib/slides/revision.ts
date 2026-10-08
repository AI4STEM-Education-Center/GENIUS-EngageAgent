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
