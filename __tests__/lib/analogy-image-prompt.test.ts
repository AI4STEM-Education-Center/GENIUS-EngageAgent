import { expect, it } from "vitest";
import { slideImagePrompt } from "@/lib/slides/prompts";
import { slideFixture } from "../fixtures/slides";

it("compresses a fixed-anchor launcher by moving the cart toward its unchanged anchor", () => {
  const draft = slideFixture("analogy");
  const prompt = slideImagePrompt(draft, "analogy", "variation");
  expect(prompt).toContain("Keep the fixed anchor at its original position");
  expect(prompt).toContain("slide the cart and any explicitly planned rigid connector toward that anchor");
  expect(prompt).not.toContain("Keep the cart and any explicitly planned connector fixed");
  expect(prompt).not.toContain("by advancing that rear anchor");
  const context = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
  expect(context.baseline).toEqual(draft.visuals.find(visual => visual.id === "target"));
  expect(context.visual).toEqual(draft.visuals.find(visual => visual.id === "variation"));
});

it("compresses an adjustable-anchor launcher without also moving its stationary cart", () => {
  const draft = slideFixture("analogy");
  draft.visuals[1] = { id: "target", prompt: "A cart held still on a horizontal track touches a spring plunger; the spring connects to an adjustable rear anchor. One pre-release setup.", caption: "Cart held still before release", alt: "Spring touches the stationary cart." };
  draft.visuals[2] = { id: "variation", prompt: "The SAME spring is more compressed by advancing its adjustable rear anchor toward the stationary cart. Keep the cart, touching plunger, spring turns and track unchanged.", caption: "More compression with cart position unchanged", alt: "The adjustable rear anchor moves toward the stationary cart." };
  const prompt = slideImagePrompt(draft, "analogy", "variation");
  expect(prompt).toContain("Keep the cart and any explicitly planned connector fixed");
  expect(prompt).toContain("by advancing that rear anchor");
  expect(prompt).toContain("Do not also move the cart or add a second spring");
  expect(prompt).not.toContain("Keep the fixed anchor at its original position");
  expect(prompt).not.toContain("slide the cart and any explicitly planned rigid connector toward that anchor");
  expect(prompt).toContain("Follow the plan about which endpoint stays fixed");
  expect(prompt).toContain("move linked objects or an explicitly adjustable anchor only as physically necessary");
});

it("does not change spring compression or either endpoint when the planned variation only adds mass", () => {
  const draft = slideFixture("analogy");
  draft.visuals[2] = { id: "variation", prompt: "The same cart on the same track, with one red mass block added on top. The spring has the same compression and touches the cart. Keep cart, plunger and fixed anchor positions unchanged.", caption: "Same compression with one added mass", alt: "One red mass block rests on the otherwise unchanged cart." };
  const prompt = slideImagePrompt(draft, "analogy", "variation");
  expect(prompt).toContain("Change ONLY the planned input");
  expect(prompt).not.toContain("approximately HALF its baseline length");
  expect(prompt).not.toContain("slide the cart and any explicitly planned rigid connector toward that anchor");
  expect(prompt).not.toContain("by advancing that rear anchor");
});

it("keeps the fixed-anchor branch when an adjustable anchor is explicitly excluded", () => {
  const draft = slideFixture("analogy");
  draft.visuals[2] = { id: "variation", prompt: "The same spring is more compressed as the cart and touching plunger move toward the original fixed anchor. No adjustable anchor, lengthening shaft, or additional mechanism.", caption: "Same spring compressed further", alt: "The cart is held closer to the original fixed anchor." };
  const prompt = slideImagePrompt(draft, "analogy", "variation");
  expect(prompt).toContain("Keep the fixed anchor at its original position");
  expect(prompt).toContain("slide the cart and any explicitly planned rigid connector toward that anchor");
  expect(prompt).not.toContain("Keep the cart and any explicitly planned connector fixed");
  expect(prompt).not.toContain("by advancing that rear anchor");
});

it("retains a positive adjustable-anchor instruction when the same sentence says not to move the cart", () => {
  const draft = slideFixture("analogy");
  draft.visuals[2] = { id: "variation", prompt: "The spring is more compressed by moving the adjustable rear anchor without moving the cart.", caption: "More compression", alt: "Shorter spring." };
  const prompt = slideImagePrompt(draft, "analogy", "variation");
  expect(prompt).toContain("Keep the cart and any explicitly planned connector fixed");
  expect(prompt).toContain("by advancing that rear anchor");
  expect(prompt).not.toContain("Keep the fixed anchor at its original position");
  expect(prompt).not.toContain("slide the cart and any explicitly planned rigid connector toward that anchor");
});

it.each(["Greater compression", "More initial compression", "Increased compression", "Increased initial compression"])("recognizes %s as a compression change without inventing an adjustable anchor", caption => {
  const draft = slideFixture("analogy");
  draft.visuals[2] = { id: "variation", prompt: "The same spring is unmistakably shorter as the cart approaches its original fixed anchor. No adjustable anchor, lengthening shaft, or additional mechanism.", caption, alt: "Same cart held closer to the fixed anchor." };
  const prompt = slideImagePrompt(draft, "analogy", "variation");
  expect(prompt).toContain("approximately HALF its baseline length");
  expect(prompt).toContain("Keep the fixed anchor at its original position");
  expect(prompt).not.toContain("by advancing that rear anchor");
});

it.each(["Do not use an adjustable rear anchor", "Never add an adjustable anchor", "Without moving the adjustable rear anchor", "Do not include any adjustable anchor"])("does not select the adjustable branch from a local exclusion: %s", exclusion => {
  const draft = slideFixture("analogy");
  draft.visuals[2] = { id: "variation", prompt: `The spring is more compressed as the cart moves toward its fixed anchor. ${exclusion}.`, caption: "Same spring compressed further", alt: "Cart closer to the original fixed anchor." };
  const prompt = slideImagePrompt(draft, "analogy", "variation");
  expect(prompt).toContain("Keep the fixed anchor at its original position");
  expect(prompt).not.toContain("by advancing that rear anchor");
});

it("keeps a direct-contact spring and cart free of required unplanned plungers or latches", () => {
  const draft = slideFixture("analogy");
  draft.visuals[1] = { id: "target", prompt: "A spring is attached to a fixed wall at left; its free right end directly touches the rear of a cart on a track. The cart is held still before release.", caption: "Spring directly touches the cart", alt: "Spring end meets the cart's rear surface." };
  draft.visuals[2] = { id: "variation", prompt: "The same spring is more compressed by moving the cart toward the same fixed wall. Its free end directly touches the cart's rear surface; both remain held still.", caption: "Greater compression with direct contact", alt: "Shorter spring directly touches the nearer cart." };
  for (const id of ["target", "variation"]) {
    const prompt = slideImagePrompt(draft, "analogy", id);
    expect(prompt).toContain("If the spring touches the cart directly, its free end must touch the cart");
    expect(prompt).toContain("do not add an unplanned plunger, rod or latch");
    expect(prompt).not.toContain("its plunger FLUSH against the cart bumper");
    expect(prompt).not.toContain("slide the cart and touching plunger");
    expect(prompt).not.toContain("Keep cart and touching plunger fixed");
    const context = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
    expect(context.visual).toEqual(draft.visuals.find(visual => visual.id === id));
  }
  expect(slideImagePrompt(draft, "analogy", "variation")).toContain("preserving direct contact and the length of every rigid part");
});
