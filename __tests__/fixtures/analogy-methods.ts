import type { AnalogyMethod } from "@/lib/slides/analogy-methods";
import type { SlideDeck, SlideDraft, TeachingSlide } from "@/lib/slides/model";
import { imageCheckKey, imageSourcePrompt, textCheckKey } from "@/lib/slides/quality";
import { analogyPlanFixture } from "./analogy";
import { tinyImage } from "./slides";

const page = (stage: string, title: string, body: string, task: string): TeachingSlide => ({
  stage, title, body, task, teacherNotes: ["Allow time for students to write before advancing."],
});

// A single scientifically coherent pair makes method/reveal assertions independent
// of incidental wording in the older energy fixtures.
export function analogyMethodDraft(method: AnalogyMethod = "reference-story"): SlideDraft {
  const plan = analogyPlanFixture();
  if (method === "reference-story") {
    delete plan.changedInput;
    delete plan.fixedConditions;
    delete plan.predictionFocus;
    delete plan.predictionSupport;
  }
  const opening = page(method === "reference-story" ? "target" : "analogue", "How supports share a load", "Bridge supports carry a load we cannot see directly; two people holding a loaded board give us a familiar comparison.", "Point to the load in each picture.");
  const familiar = page("analogue", "Holding a loaded board", "Two people hold opposite ends of a board while a bag rests in its center.", "Which parts hold the board up?");
  const mapping = page("mapping", "Connect the two situations", "Compare the loaded board with the bridge and look for parts that do similar jobs.", "What could the board correspond to, and why?");
  const prediction = page("predict", "Move the same load", "The same bridge carries the same bag, first in the center and then nearer its left support.", "Predict which setup puts more load on the left support, and give a reason.");
  const reflection = page("reflect", "Use the useful comparison", "Return to the two pictures as you consider how a structure carries a load.", "Which part of the board example helps you think about the bridge?");
  const question = page("question", "Your question about supports", "We will investigate how a load is shared between a structure's supports.", "Write one question you now want to investigate about bridge supports.");
  const visuals = [
    { id: "analogue", prompt: "Two people hold opposite ends of a horizontal board with a bag resting in its center. Hands visibly touch the board. One still moment, no labels or arrows.", caption: "Two people holding a loaded board", alt: "Two people support a board with a bag in its center." },
    { id: "target", prompt: "A straight blue bridge deck rests on two gray supports at its ends. One bag rests in the center of the deck. One still moment, no people, labels or force arrows.", caption: "A loaded bridge on two supports", alt: "A bridge deck rests on two supports with a bag in its center." },
    ...(method === "predict-transfer" ? [{ id: "variation", prompt: "The identical blue bridge deck, gray end supports and camera angle. Move the same bag near the left support. All objects remain still; no other change, labels or force arrows.", caption: "Same bridge, load nearer the left support", alt: "The same bridge carries the same bag nearer its left support." }] : []),
  ];
  return { title: opening.title, analogyMethod: method, analogyPlan: plan, slides: method === "reference-story" ? [opening, familiar, mapping, reflection, question] : [opening, mapping, prediction, reflection, question], visuals };
}

export function analogyMethodDeck(method: AnalogyMethod = "reference-story"): SlideDeck {
  const draft = analogyMethodDraft(method);
  const deck: SlideDeck = {
    id: "analogy-method-deck", lessonNumber: 5, strategy: "analogy", draft,
    classroomContext: "Grade 10; students have carried a board together; no equations yet.",
    assets: Object.fromEntries(draft.visuals.map(visual => [visual.id, {
      data: tinyImage, width: 1536, height: 1024, sourcePrompt: imageSourcePrompt(draft, visual.id),
      ...(visual.id === "variation" ? { referenceData: tinyImage } : {}),
    }])),
  };
  deck.checks = { text: { key: textCheckKey(deck), issues: [] }, images: Object.fromEntries(draft.visuals.map(visual => [visual.id, { key: imageCheckKey(deck, visual.id), imageData: tinyImage, issues: [] }])) };
  return deck;
}
