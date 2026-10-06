import type { SlideDeck, SlideDraft, SlideStrategy, TeachingSlide } from "@/lib/slides/model";
import { STAGES } from "@/lib/slides/model";
import { imageCheckKey, imageSourcePrompt, textCheckKey } from "@/lib/slides/quality";

const slide = (title: string, body: string, task: string): Omit<TeachingSlide, "stage"> => ({ title, body, task, teacherNotes: ["Allow time for students to write before advancing."] });
const contents: Record<SlideStrategy, Omit<TeachingSlide, "stage">[]> = {
  analogy: [
    slide("Tracking energy transfers", "A spring can launch a cart, but its energy is invisible; moving counters between trays may help us follow the transfer.", "Point to where the counters are now and where they could move."),
    slide("Connect the trays to a launcher", "A compressed spring can launch a cart; consider energy in the spring and cart alongside the counters and trays.", "Which parts of the counter example could help you track energy?"),
    slide("Compare two starting positions", "The same launcher starts with its spring slightly compressed on the left and more compressed on the right; the cart remains held still.", "Predict how the cart's motion after release might differ and give a reason."),
    slide("Use the comparison", "Look again at the counters and the cart launcher as you think about tracking energy.", "Which part of the tray example helps you describe the launcher, and why?"),
    slide("Create your question card", "We compared starting setups; next lesson, investigate the unseen energy changes.", "Write one question you now want to investigate about the cart and spring."),
  ],
  "cognitive conflict": [
    slide("Deformation during contact", "We will investigate deformation during contact; imagine pressing a soft rubber ball against a table, then releasing it.", "What do you think happens to the ball during contact?"),
    slide("Record your prediction", "Focus on the ball's shape while the palm presses and after the palm is lifted.", "Write your prediction for the ball's shape at both moments."),
    slide("During and after contact", "This illustration shows the ball flattening under the palm, then returning to a round shape after release; these are not camera measurements.", "What visible shape difference do you notice?"),
    slide("Compare with your prediction", "Your prediction: recall your written idea.\nWhat we observed in the activity: the illustrated ball flattened under pressure, then became round.", "How does that result compare with your prediction, even if they match?"),
    slide("A question to investigate", "", "Write one scientific question about this change, starting with Why or How could we test."),
  ],
  "experience bridging": [
    slide("Remember touching something soft", "Recall catching a soft ball, or imagine pressing a soft sponge if that experience is unfamiliar.", "Describe one moment when your hand was touching the ball or sponge."),
    slide("Look closely at the contact", "Think back to the object's shape where your hand touched it, compared with its shape before contact.", "What shape change do you remember or imagine?"),
    slide("Recognize deformation", "Return to the contact you recalled; use the name deformation for the shape change you noticed.", "Where did deformation occur in your experience?"),
    slide("Another familiar shape change", "A seat cushion also changes shape when someone sits on it.", "What shape change does this experience share with the ball or sponge?"),
    slide("Your question about deformation", "", "Write one scientific question about deformation in that experience, starting with Why or What if."),
  ],
};

export function slideFixture(strategy: SlideStrategy): SlideDraft {
  const visuals = strategy === "analogy" ? [
    { id: "analogue", prompt: "Nine counters distributed between two shallow trays, five on the left and four on the right. One scene.", caption: "Nine counters shared between two trays", alt: "Two trays contain nine counters altogether." },
    { id: "target", prompt: "Side view: a blue cart held still against a spring attached to a fixed wall at left on a horizontal track. The spring has six coils, slightly compressed to 60 mm. Single setup, no time panels, no text or movement arrows.", caption: "Spring slightly compressed; cart held still", alt: "A blue cart is held against a slightly compressed spring attached to the left wall." },
    { id: "variation", prompt: "Same side view, blue cart, horizontal track and fixed wall on the left as baseline. The same six-coil spring is compressed further, to 30 mm; cart remains held still against it. Only initial compression changes. No text or movement arrows.", caption: "Same spring compressed further; cart held still", alt: "The same cart is held closer to the wall with the same spring more compressed." },
  ] : strategy === "cognitive conflict" ? [
    { id: "evidence", prompt: "Two side-by-side panels. Left: a palm visibly flattens a soft red ball against a table. Right: the lifted hand no longer touches the same ball, which has returned to round. Constant size and viewpoint. No text.", caption: "Illustration: during pressure (left), after release (right)", alt: "Left: a palm flattens a ball. Right: the lifted palm is above the now round ball." },
  ] : [
    { id: "experience", prompt: "One frozen moment of a hand catching a soft ball, with a visible shallow dent where the palm contacts the ball. No panels or text.", caption: "A hand touching a soft ball", alt: "A hand contacts a soft ball, with a shallow dent at the point of contact." },
  ];
  return { title: contents[strategy][0].title, slides: contents[strategy].map((item, i) => ({ ...item, stage: STAGES[strategy][i], teacherNotes: [...item.teacherNotes] })), visuals };
}
export const tinyImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZAAAAABJRU5ErkJggg==";
export function deckFixture(strategy: SlideStrategy): SlideDeck {
  const draft = slideFixture(strategy);
  const deck: SlideDeck = { id: "test-deck", lessonNumber: strategy === "analogy" ? 8 : 3, strategy, draft,
    assets: Object.fromEntries(draft.visuals.map(visual => [visual.id, { data: tinyImage, width: 1536, height: 1024, sourcePrompt: imageSourcePrompt(draft, visual.id), ...(visual.id === "variation" ? { referenceData: tinyImage } : {}) }])) };
  deck.checks = { text: { key: textCheckKey(deck), issues: [] }, images: Object.fromEntries(draft.visuals.map(visual => [visual.id, { key: imageCheckKey(deck, visual.id), imageData: tinyImage, issues: [] }])) };
  return deck;
}
