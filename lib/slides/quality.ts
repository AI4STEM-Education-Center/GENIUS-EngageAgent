import { ANALOGY_OPENING_CONTRACT_VERSION, SIX_STEP_REVIEW_CONTRACT_VERSION, SLIDE_CONTRACT_VERSION, isSlideAsset, visibleVisualIds, type SlideDeck, type SlideDraft, type SlideStrategy } from "./model";
import { analogyMappingIndex, resolveAnalogyMethod } from "./analogy-methods";
import { analogyStudentFields } from "./analogy";

const sentenceCount = (text: string) => text.split(/[.!?]+(?:\s|$)/u).filter(part => part.trim()).length;
const strategyLabel = /\b(?:analogy|cognitive[ -]conflict|experience[ -]bridging)\b/iu;
// Topic orientation is allowed on page 1; only an explicit solved counter/energy
// correspondence is rejected here. Other semantic leakage belongs to AI review.
const counterEnergyMapping = /\b(?:counters?|trays?)\s+(?:represent\w*|track\w*|model\w*|symboli[sz]e\w*|stand(?:s)? for)\b[^.!?\n]{0,80}\benergy\b|\b(?:counters?|trays?)\s+(?:are|is)\s+(?:not\s+)?(?:literal\s+)?energy\b|\benergy\s+(?:is|isn't|is not)\s+(?:like\s+|represented by\s+)?(?:literal\s+)?counters?\b/iu;

// Only explicit output rules belong here; stage meaning is checked separately.
export function teachingErrors(draft: SlideDraft, lessonNumber?: number): string[] {
  const errors: string[] = [];
  const inquiryStrategy = draft.slides[1]?.stage === "prediction" || (draft.slides[0]?.stage === "experience" && draft.slides[1]?.stage === "notice");
  if (inquiryStrategy) {
    const publicFields = [
      { path: "Deck title", text: draft.title },
      ...draft.slides.flatMap((slide, index) => (["title", "body", "task"] as const).map(field => ({ path: `Slide ${index + 1}.${field}`, text: slide[field] }))),
      ...draft.visuals.flatMap(visual => (["caption", "alt"] as const).map(field => ({ path: `Image ${visual.id}.${field}`, text: visual[field] }))),
    ];
    draft.slides.forEach((slide, index) => {
      if (/^(?:(?:slide|step)\s+)?[1-7][.)]\s+/iu.test(slide.title.trim())) errors.push(`Slide ${index + 1}.title: remove the numbered prefix; the application already displays the page number.`);
    });
    for (const field of publicFields) {
      if (/\btoday we investigate\s*:/iu.test(field.text)) errors.push(`${field.path}: remove the repeated learning-target banner; the application displays it at the required stage.`);
      if (/\b(?:ask|invite|guide|prompt|encourage|help|have|tell)\s+(?:the\s+)?(?:students|learners)\b|\b(?:teacher|facilitator)\s+(?:should|will|can|asks?|says?|explains?|guides?)\b|\b(?:teacher notes?|lesson bridge|student-facing (?:content|materials?|text))\b/iu.test(field.text)) errors.push(`${field.path}: move teacher/writer directions into private teacher notes; address students directly.`);
      if (/\bnext,?\s+we\s+will\s+(?:investigate|explore|learn|study)\b/iu.test(field.text)) errors.push(`${field.path}: move the spoken lesson transition into private teacher notes.`);
      if (/^(?:present (?:a |the )?(?:familiar phenomenon|discrepant event)|activate (?:students['’]? )?prior knowledge)[.!:]?$/iu.test(field.text.trim())) errors.push(`${field.path}: replace the instructional-stage heading with a natural title for the situation or student task.`);
    }
    if (draft.slides.at(-1)?.body.trim()) errors.push(`Slide ${draft.slides.length}.body: leave this empty; move the recap and lesson transition into private teacher notes.`);
  }
  if (draft.slides[0]?.stage === "experience" && draft.slides[1]?.stage === "notice") {
    // Check literal target vocabulary only; semantic naming and scientific
    // equivalence are handled by the method-specific AI review.
    const conceptTerms: Record<number, RegExp> = {
      1: /\bdeformation\b/iu,
      2: /\b(?:energy|deformation)\b/iu,
      3: /\b(?:deformation|elasticity|elastic recovery)\b/iu,
      4: /\b(?:deformation|elasticity|elastic recovery)\b/iu,
      5: /\b(?:contact forces?|equal.and.opposite forces?)\b/iu,
      6: /\b(?:interaction forces?|contact forces?|acceleration|deformation)\b/iu,
      7: /\b(?:kinetic energy|energy)\b/iu,
      8: /\benergy\b/iu,
    };
    const targetTerm = lessonNumber === undefined ? undefined : conceptTerms[lessonNumber];
    if (targetTerm) {
      const earlyFields = [
        { path: "Deck title", text: draft.title },
        ...draft.slides.slice(0, 2).flatMap((slide, index) => (["title", "body", "task"] as const).map(field => ({ path: `Slide ${index + 1}.${field}`, text: slide[field] }))),
        ...draft.visuals.filter(visual => visual.id === "experience").flatMap(visual => (["caption", "alt"] as const).map(field => ({ path: `Image ${visual.id}.${field}`, text: visual[field] }))),
      ];
      for (const field of earlyFields) if (targetTerm.test(field.text)) errors.push(`${field.path}: introduce the scientific concept name only on slide 3; use concrete everyday wording before then.`);
    }
  }
  if (draft.analogyPlan) {
    for (const field of analogyStudentFields(draft.analogyMethod)) {
      if (strategyLabel.test(draft.analogyPlan[field])) errors.push(`Analogy ${field}: keep strategy names out of the student scaffold.`);
    }
    if (draft.analogyMethod === "six-step") {
      const included = draft.analogyPlan.boundaryDecision === "include";
      if (draft.slides.length !== (included ? 7 : 6)) errors.push(`Deck: use ${included ? 7 : 6} slides to match the analogy boundary decision.`);
      if (included && draft.slides[5]?.stage !== "limits") errors.push("Slide 6.stage: place the useful boundary immediately before the final question.");
      if (!included && draft.slides.some(slide => slide.stage === "limits")) errors.push("Deck: omit the boundary page when the analogy plan does not require it.");
    } else {
      const expected = draft.analogyPlan.boundaryDecision === "include" ? "limits" : "reflect";
      if (draft.slides[3]?.stage !== expected) errors.push(`Slide 4.stage: use ${expected} to match the analogy boundary decision.`);
    }
  }
  draft.slides.forEach((slide, i) => {
    for (const field of ["title", "body", "task"] as const) {
      if (strategyLabel.test(slide[field])) errors.push(`Slide ${i + 1}.${field}: keep the strategy name out of student text.`);
      if (/\b(?:no causal explanation is given|without (?:giving|providing) (?:the |a )?(?:mechanism|explanation)|without suggesting internal causes)\b/iu.test(slide[field])) errors.push(`Slide ${i + 1}.${field}: remove the writer instruction; describe the situation directly to students and keep production guidance in private notes.`);
    }
    if (sentenceCount(slide.task) > 1) errors.push(`Slide ${i + 1}.task: use one thinking-task sentence.`);
  });
  for (const visual of draft.visuals) {
    for (const field of ["caption", "alt"] as const) {
      if (strategyLabel.test(visual[field])) errors.push(`Image ${visual.id}.${field}: keep the strategy name out of student text.`);
    }
  }
  const analogueIndex = draft.slides.findIndex(slide => slide.stage === "analogue");
  const analogue = draft.slides[analogueIndex];
  const analogueVisual = draft.visuals.find(visual => visual.id === "analogue");
  if (analogue && /\b(?:counters?|trays?)\b/iu.test(`${analogue.body} ${analogueVisual?.prompt ?? ""}`)) {
    for (const field of ["title", "body", "task"] as const) {
      if (counterEnergyMapping.test(analogue[field])) errors.push(`Slide ${analogueIndex + 1}.${field}: save the concrete counter/energy correspondence for slide ${analogyMappingIndex(draft.analogyMethod) + 1}.`);
    }
    for (const field of ["caption", "alt"] as const) {
      if (analogueVisual && /\benergy\b/iu.test(analogueVisual[field])) errors.push(`Image analogue.${field}: describe counters/trays alone, without the later energy mapping.`);
    }
  }
  if (draft.analogyMethod === "reference-story") {
    for (const field of ["title", "body", "task"] as const) {
      if (counterEnergyMapping.test(draft.slides[0]?.[field] ?? "")) errors.push(`Slide 1.${field}: introduce both situations, but save the concrete counter/energy correspondence for slide 3.`);
    }
  }
  if (draft.analogyMethod === "six-step") {
    const studentFields = [
      ...draft.slides.flatMap((slide, i) => (["title", "body", "task"] as const).map(field => ({ path: `Slide ${i + 1}.${field}`, text: slide[field] }))),
      ...draft.visuals.flatMap(visual => (["caption", "alt"] as const).map(field => ({ path: `Image ${visual.id}.${field}`, text: visual[field] }))),
      { path: "Analogy responseStarter", text: draft.analogyPlan?.responseStarter ?? "" },
    ];
    for (const field of studentFields) {
      if (/\b(?:familiar situation|science situation)\b/iu.test(field.text)) errors.push(`${field.path}: remove the category label; use literal scene names only when needed.`);
      if (/\bnext,?\s+we\s+will\s+(?:investigate|explore|learn|study)\b/iu.test(field.text)) errors.push(`${field.path}: move the spoken lesson transition into private teacher notes.`);
    }
    if (draft.slides.at(-1)?.body.trim()) errors.push(`Slide ${draft.slides.length}.body: leave this empty; move the recap and lesson transition into private teacher notes.`);
    for (const [index, slide] of draft.slides.slice(0, 2).entries()) {
      for (const field of ["title", "body", "task"] as const) {
        if (counterEnergyMapping.test(slide[field])) errors.push(`Slide ${index + 1}.${field}: introduce the target without the later counter/energy correspondence; the familiar analogue first appears on slide 3.`);
      }
    }
  }
  const lastIndex = draft.slides.length - 1;
  const last = draft.slides[lastIndex]?.task ?? "";
  if (/[?？]/u.test(draft.slides[lastIndex]?.body ?? "")) {
    errors.push(`Slide ${lastIndex + 1}.body: recap the unresolved observation without supplying questions; the page already provides incomplete question starters.`);
  }
  if (draft.slides[1]?.stage === "prediction" && !/\b(?:write|record|draw|sketch)\b/iu.test(draft.slides[1].task)) {
    errors.push("Slide 2.task: explicitly ask students to write or record their prediction before seeing the result.");
  }
  if (draft.slides[1]?.stage === "prediction") {
    for (const [i, slide] of draft.slides.slice(0, 2).entries()) {
      for (const field of ["body", "task"] as const) {
        if (/(?:^|[.!?]\s+)(?:now\s+)?(?:watch|look at|study the (?:image|picture)|observe the (?:image|picture))\b/iu.test(slide[field])) {
          errors.push(`Slide ${i + 1}.${field}: describe or imagine the setup in words; no media is displayed before the prediction.`);
        }
        if (/\b(?:shape|outline)\s+changes?\b[^.!?]*\b(?:while|when|as)\s+(?:it|the (?:ball|object))\s+(?:is|gets|becomes)\s+(?:visibly\s+)?(?:squashed|flattened|deformed)\b/iu.test(slide[field])) {
          errors.push(`Slide ${i + 1}.${field}: do not ask whether shape changes while already stating that the object is flattened; describe contact neutrally and leave the shape for students to predict.`);
        }
      }
    }
  }
  if (draft.slides[3]?.stage === "compare") {
    const body = draft.slides[3].body;
    if (!/your prediction\s*:/iu.test(body) || !/what we observed in the activity\s*:/iu.test(body)) {
      errors.push("Slide 4.body: separate Your prediction: from What we observed in the activity: as two labeled entries.");
    } else {
      const observed = body.split(/what we observed in the activity\s*:/iu)[1]?.trim() ?? "";
      if (!/[a-z]{2,}/iu.test(observed) || /^(?:\[[^\]]*\]|TBD|see (?:the )?(?:image|picture)|(?:the )?(?:observed )?(?:result|outcome|observation))\s*[.!?]*$/iu.test(observed)) {
        errors.push("Slide 4.body: state the concrete illustrated outcome after What we observed in the activity:, without explaining its cause.");
      }
    }
  }
  if (!/\b(?:write|compose|formulate|draft|create)\b[^.!?]*\bquestion\b/iu.test(last)) {
    errors.push(`Slide ${lastIndex + 1}.task: ask students to write their own scientific question.`);
  }
  return errors;
}

export function imageContext(draft: SlideDraft, strategy: SlideStrategy, visualId: string) {
  return { visual: draft.visuals.find(visual => visual.id === visualId),
    ...(strategy === "cognitive conflict" ? { predictionContext: draft.slides.slice(0, 2).map(({ stage, title, body, task }) => ({ stage, title, body, task })) } : {}),
    ...(strategy === "analogy" && draft.analogyPlan ? { mapping: { ...(draft.analogyMethod === "six-step" ? {} : { hint: draft.analogyPlan.mappingHint }), starter: draft.analogyPlan.responseStarter, sharedRelation: draft.analogyPlan.sharedRelation } } : {}),
    ...(strategy === "analogy" && visualId === "variation" ? { baseline: draft.visuals.find(visual => visual.id === "target") } : {}),
    ...(draft.analogyMethod === "six-step" && visualId === "target" ? { phenomenon: draft.visuals.find(visual => visual.id === "phenomenon") } : {}),
    ...(strategy === "analogy" ? { analogyMethod: resolveAnalogyMethod(draft.analogyMethod) } : {}),
    slides: draft.slides.flatMap((slide, index) => visibleVisualIds(strategy, index, draft.analogyMethod, draft.analogyPlan?.boundaryDecision === "include").includes(visualId)
      ? [{ number: index + 1, stage: slide.stage, title: slide.title, body: slide.body, task: slide.task }] : []) };
}

export function imageReferenceId(draft: SlideDraft, id: string): string | undefined {
  if (id === "variation") return "target";
  if (draft.analogyMethod === "six-step" && id === "target") return "phenomenon";
  return undefined;
}

export function imageSourcePrompt(draft: SlideDraft, id: string): string {
  const prompt = draft.visuals.find(visual => visual.id === id)?.prompt ?? "";
  const reference = imageReferenceId(draft, id);
  return reference ? JSON.stringify([prompt, draft.visuals.find(visual => visual.id === reference)?.prompt]) : prompt;
}

export function imageMatchesPlan(deck: SlideDeck, id: string): boolean {
  const asset = deck.assets[id];
  const reference = imageReferenceId(deck.draft, id);
  return !!asset && asset.sourcePrompt === imageSourcePrompt(deck.draft, id)
    && (!reference || (!!deck.assets[reference] && imageMatchesPlan(deck, reference) && asset.referenceData === deck.assets[reference].data));
}

// Snapshots invalidate reviews after edits; they are not authorization tokens.
const reviewContract = (deck: SlideDeck) => deck.strategy === "analogy" ? (deck.draft.analogyMethod === "six-step" ? SIX_STEP_REVIEW_CONTRACT_VERSION : ANALOGY_OPENING_CONTRACT_VERSION) : SLIDE_CONTRACT_VERSION;
export const textCheckKey = (deck: SlideDeck) => JSON.stringify([reviewContract(deck), deck.lessonNumber, deck.strategy, deck.classroomContext ?? "", deck.promptProvenance, deck.draft]);
export const imageCheckKey = (deck: SlideDeck, id: string) => JSON.stringify([reviewContract(deck), deck.lessonNumber, deck.strategy, deck.classroomContext ?? "", imageContext(deck.draft, deck.strategy, id), ...(imageReferenceId(deck.draft, id) ? [deck.assets[imageReferenceId(deck.draft, id)!]?.data] : []), ...(deck.strategy === "analogy" && deck.draft.analogyPlan && id === "target" ? [deck.assets.analogue?.data, deck.draft.visuals.find(visual => visual.id === "analogue")] : [])]);

export function hasTeacherDecision(deck: SlideDeck): boolean {
  const decision = deck.teacherDecision;
  return !!decision && decision.reason.trim().length >= 10 && decision.reason.length <= 1000
    && decision.draftKey === textCheckKey(deck) && decision.checks === deck.checks && decision.assets === deck.assets;
}

export function reviewFindings(deck: SlideDeck): string[] {
  const findings: string[] = [];
  if (deck.checks?.text?.key === textCheckKey(deck) && deck.checks.text.model !== "output-rules") findings.push(...deck.checks.text.issues);
  for (const visual of deck.draft.visuals) {
    const asset = deck.assets[visual.id];
    const check = deck.checks?.images[visual.id];
    if (asset && imageMatchesPlan(deck, visual.id) && check?.key === imageCheckKey(deck, visual.id) && check.imageData === asset.data) findings.push(...check.issues);
  }
  return [...new Set(findings)];
}

export type ReviewAssessment = { complete: boolean; findings: string[]; pending: string[] };

/** Assess saved checks against the current text and actual pixels. Completeness
 * is not a pass: callers must also consider findings, layout and attempt failures. */
export function reviewAssessment(deck: SlideDeck): ReviewAssessment {
  const pending: string[] = [];
  const hasAiModel = (model: string | undefined) => !!model?.trim() && model.trim() !== "output-rules";
  const text = deck.checks?.text;
  if (!text) pending.push("Text: AI review has not been completed.");
  else if (text.key !== textCheckKey(deck)) pending.push("Text: the saved review is out of date after changes to the slides or their context.");
  else if (!hasAiModel(text.model)) pending.push("Text: a completed AI review is not recorded; automatic rules alone do not complete the review.");

  for (const visual of deck.draft.visuals) {
    const asset = deck.assets[visual.id];
    const check = deck.checks?.images[visual.id];
    if (!isSlideAsset(asset)) pending.push(`Image ${visual.id}: the current image is missing or invalid and has not been reviewed.`);
    else if (!imageMatchesPlan(deck, visual.id)) pending.push(`Image ${visual.id}: its image plan or reference has changed; the saved review is out of date.`);
    else if (!check) pending.push(`Image ${visual.id}: AI review has not been completed.`);
    else if (check.key !== imageCheckKey(deck, visual.id) || check.imageData !== asset.data) pending.push(`Image ${visual.id}: the image or slide text has changed since the saved review.`);
    else if (!hasAiModel(check.model)) pending.push(`Image ${visual.id}: a completed AI review is not recorded.`);
  }
  return {
    complete: pending.length === 0,
    findings: [...new Set([...teachingErrors(deck.draft, deck.lessonNumber), ...reviewFindings(deck)])],
    pending,
  };
}

// Review diagnostics only, including deterministic teaching rules and missing
// or stale checks. These inform optional refinement, never publication/export.
export function qualityErrors(deck: SlideDeck): string[] {
  const errors = teachingErrors(deck.draft, deck.lessonNumber);
  if (deck.checks?.text?.key !== textCheckKey(deck)) errors.push("Text: quality check pending after generation or edits.");
  else if (deck.checks.text.model === "output-rules") errors.push(...deck.checks.text.issues);
  for (const visual of deck.draft.visuals) {
    const asset = deck.assets[visual.id];
    if (!asset) continue;
    const check = deck.checks?.images[visual.id];
    if (!imageMatchesPlan(deck, visual.id)) errors.push(`Image ${visual.id}: regenerate the changed image plan or baseline.`);
    else if (!check || check.key !== imageCheckKey(deck, visual.id) || check.imageData !== asset.data) errors.push(`Image ${visual.id}: visual check pending after generation or edits.`);
  }
  return [...new Set(errors)];
}

export function preservedAssets(deck: SlideDeck | null, draft: SlideDraft): SlideDeck["assets"] {
  if (!deck) return {};
  return Object.fromEntries(draft.visuals.flatMap(visual => {
    const asset = deck.assets[visual.id];
    return asset && imageMatchesPlan({ ...deck, draft }, visual.id) ? [[visual.id, asset]] : [];
  }));
}
