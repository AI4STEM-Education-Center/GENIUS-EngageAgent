import type { SlideDeck, SlideDraft, TeachingSlide } from "@/lib/slides/model";
import { imageCheckKey, imageSourcePrompt, textCheckKey } from "@/lib/slides/quality";
import { analogyMethodDraft } from "./analogy-methods";

export const tinyJpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")}`;
const page = (stage: string, title: string, body: string, task: string): TeachingSlide => ({
  stage, title, body, task, teacherNotes: ["Allow time for a learner response before advancing."],
});

export function sixStepDraft(includeLimits = false): SlideDraft {
  const reference = analogyMethodDraft();
  const phenomenon = page("phenomenon", "What holds up the loaded bridge?", "A bag rests in the center of a footbridge, and the bridge remains still.", "What do you think is holding up the bag?");
  const target = page("target", "Where does the load go?", "The same bridge deck rests on two supports, but the route taken by the bag's load is hidden.", "How could the load reach the supports from the middle?");
  const familiar = page("analogue", "Holding a loaded board", "Imagine two people holding opposite ends of a board while a bag rests in the middle.", "How do the people keep the loaded board from falling?");
  const mapping = page("mapping", "What could match?", "", "Which part could carry the bag's load to the bridge supports?");
  const apply = page("apply", "Use your route to explain", "Return to the bridge and think about the route you traced from the bag to its supports.", "Use the board comparison to explain why the bridge needs its supports.");
  const limits = page("limits", "Could both adjust?", "", "Which part of the comparison remains useful for following the load?");
  const question = page("question", "Your question about supports", "", "Write one question you now want to investigate about the bridge's supports.");
  return {
    title: phenomenon.title,
    analogyMethod: "six-step",
    analogyPlan: {
      ...reference.analogyPlan!,
      targetPhenomenon: "A loaded footbridge in a park remains still.",
      authenticityRationale: "People encounter loaded footbridges outside school; the deck supports loads between its ends.",
      discussionGoal: "How each system carries a central load to its supports.",
      mappingHint: "",
      targetDifficulty: "How a stationary load reaches the supports through a bridge deck cannot be seen directly.",
      sharedRelation: "A load resting between supports is carried through the board or deck to its supports.",
      openMapping: "Students connect the board carrying the bag to the bridge deck carrying the load to its supports.",
      applicationMode: "explain",
      applicationSupport: "The mapped board and hands support an explanation of a load's route through the deck to the bridge supports.",
      boundaryDecision: includeLimits ? "include" : "omit",
      boundaryReason: includeLimits ? "The short boundary prevents attributing deliberate adjustments to an inanimate support." : "Following the load through a stationary structure does not require a boundary to be understood.",
    },
    slides: [phenomenon, target, familiar, mapping, apply, ...(includeLimits ? [limits] : []), question],
    visuals: [
      { id: "phenomenon", prompt: "A real footbridge with a straight blue deck and two gray end supports. One bag rests in its center. Single still scene with natural surroundings, no people, labels or force arrows.", caption: "A bag resting on a footbridge", alt: "A bag rests in the center of a blue footbridge on two gray supports." },
      { ...reference.visuals[1], prompt: "Preserve the same blue bridge deck, gray supports and central bag shown in the phenomenon image. Simplify the background to isolate these target parts. No labels, people, arrows or new objects." },
      reference.visuals[0],
    ],
  };
}

export function sixStepDeck(includeLimits = false): SlideDeck {
  const draft = sixStepDraft(includeLimits);
  const deck: SlideDeck = {
    id: "six-step-analogy-deck", lessonNumber: 5, strategy: "analogy", draft,
    classroomContext: "Grade 10; students have carried a board together; no equations yet.",
    assets: Object.fromEntries(draft.visuals.map(visual => [visual.id, {
      data: tinyJpeg, width: 1536, height: 1024, sourcePrompt: imageSourcePrompt(draft, visual.id),
      ...(visual.id === "target" ? { referenceData: tinyJpeg } : {}),
    }])),
  };
  deck.checks = { text: { key: textCheckKey(deck), issues: [] }, images: Object.fromEntries(draft.visuals.map(visual => [visual.id, { key: imageCheckKey(deck, visual.id), imageData: tinyJpeg, issues: [] }])) };
  return deck;
}
