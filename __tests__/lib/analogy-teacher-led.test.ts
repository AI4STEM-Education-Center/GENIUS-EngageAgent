import { expect, it } from "vitest";
import JSZip from "jszip";
import { draftErrors } from "@/lib/slides/model";
import { analogyPlanSchemaFor } from "@/lib/slides/analogy";
import { slidePrompt, slideCheckPrompt, slideOutputFormat } from "@/lib/slides/prompts";
import { reviewFields } from "@/lib/slides/review";
import { slideElements, layoutErrors, type MeasureText } from "@/lib/slides/layout";
import { buildPresentationBytes } from "@/lib/slides/export";
import { imageCheckKey, textCheckKey, teachingErrors, qualityErrors } from "@/lib/slides/quality";
import { sixStepDeck, sixStepDraft } from "../fixtures/analogy-six-step";
const measure: MeasureText = (text, element) => text.length * element.fontSize * .53;
const refresh = (deck: ReturnType<typeof sixStepDeck>) => {
  deck.checks!.text!.key = textCheckKey(deck);
  for (const id of Object.keys(deck.assets)) deck.checks!.images[id].key = imageCheckKey(deck, id);
};

it("allows sparse student pages and useful private guidance without relaxing legacy validation", () => {
  const draft = sixStepDraft();
  draft.slides.forEach(slide => { slide.body = ""; });
  draft.visuals.forEach(visual => { visual.caption = ""; });
  draft.analogyPlan!.responseStarter = "";
  draft.slides[3].teacherNotes = ["Purpose: explore the route of a load.", "Ask what carries the bag in each picture. Listen for the board and bridge deck as possible counterparts. If students are stuck, ask them to point to where each load is placed and where each support touches it. Invite another proposal, then ask how that proposal could help explain support of the same bridge. Keep these possible correspondences in the discussion rather than printing them on the slide."];
  expect(draftErrors(draft,"analogy")).toEqual([]);
  const deck = {...sixStepDeck(),draft};
  expect(layoutErrors(deck,measure)).toEqual([]);
  for(let i=0;i<draft.slides.length;i++) expect(slideElements(deck,i).filter(e=>e.kind === "text").every(e=>e.text.trim())).toBe(true);
  draft.slides[3].teacherNotes[1] = "a".repeat(901);
  expect(draftErrors(draft,"analogy").join("\n")).toContain("teacherNotes");
  draft.slides[3].task = "";
  expect(draftErrors(draft,"analogy").join("\n")).toContain("Slide 4.task");
});

it("keeps old six-step supplied hints private in preview, review context and native PPTX", async () => {
  const deck = sixStepDeck();
  const answer = "The loaded board corresponds to the bridge deck.";
  deck.draft.analogyPlan!.mappingHint = answer;
  delete deck.draft.analogyPlan!.targetPhenomenon;
  delete deck.draft.analogyPlan!.authenticityRationale;
  delete deck.draft.analogyPlan!.discussionGoal;
  deck.draft.slides[3].teacherNotes = ["Purpose: compare how the load reaches supports.",`${answer} Ask students which objects touch the bag, then which objects support them.`];
  refresh(deck);
  expect(draftErrors(deck.draft,"analogy")).toEqual([]);
  expect(qualityErrors(deck)).toEqual([]);
  for(let i=0;i<6;i++){
    const text=slideElements(deck,i).filter(e=>e.kind==='text').map(e=>e.text).join("\n");
    expect(text).not.toContain(answer);
    expect(text).not.toMatch(/Familiar situation|Science situation/);
  }
  const lesson={lessonNumber:5,lessonTitle:"Contact forces",learningObjective:"Follow a load"};
  for(const id of [undefined,"target"]){
    const context=JSON.parse(slideCheckPrompt(lesson,"analogy",deck.draft,id).user);
    expect(context.studentScaffold ?? context.studentFacingMappingScaffold).not.toHaveProperty("hint");
  }
  expect(reviewFields(deck.draft).find(field=>field.id==='analogy-plan-mappingHint')!.label).toContain("private");
  const zip=await JSZip.loadAsync(await buildPresentationBytes(deck,measure));
  for(let i=1;i<=6;i++) {
    const xml=await zip.file(`ppt/slides/slide${i}.xml`)!.async("string");
    expect(xml).not.toContain(answer);
    expect(xml).not.toMatch(/Familiar situation|Science situation/);
  }
  expect(await zip.file('ppt/notesSlides/notesSlide4.xml')!.async('string')).toContain(answer);
});

it("requires authenticity planning and an empty compatibility hint for new six-step generation", () => {
  const schema=analogyPlanSchemaFor("six-step");
  expect(schema.required).toEqual(expect.arrayContaining(["targetPhenomenon","authenticityRationale","discussionGoal"]));
  expect(schema.properties.mappingHint).toMatchObject({enum:[""]});
  const output = slideOutputFormat("analogy","six-step").json_schema.schema as {properties:{slides:{items:{anyOf:{properties:{stage:{enum:string[]};body:{enum?:string[];pattern:string}}}[]}}}};
  const question=output.properties.slides.items.anyOf.find(item=>item.properties.stage.enum[0]==="question")!;
  expect(question.properties.body.enum).toEqual([""]);
  const mapping=output.properties.slides.items.anyOf.find(item=>item.properties.stage.enum[0]==="mapping")!;
  expect(new RegExp(mapping.properties.body.pattern).test("")).toBe(true);
});

it("catches public category labels and teacher transitions but permits them in private guidance", () => {
  const draft=sixStepDraft();
  draft.slides[5].teacherNotes=["Next, we will investigate the load route."];
  expect(teachingErrors(draft)).toEqual([]);
  draft.slides[3].title="Familiar situation";
  draft.slides[5].body="Next, we will investigate the load route.";
  expect(teachingErrors(draft).join("\n")).toContain("category label");
  expect(teachingErrors(draft).join("\n")).toContain("private teacher notes");
});

it("allows an everyday energy-release event without forcing lesson eight's classroom cart into six-step planning", () => {
  const lesson={lessonNumber:8,lessonTitle:"Energy",learningObjective:"Model stored energy and transfers"};
  const prompt=slidePrompt(lesson,"analogy",undefined,"",undefined,{analogyMethod:"six-step"});
  const data=JSON.parse(prompt.user);
  expect(data.referenceVariables.TARGET_CONCEPT).toContain("authentic real-world event");
  expect(data.lessonFocus).toContain("not a compulsory opening phenomenon");
  expect(data.lessonFocus).toContain("Do not substitute a braking/dissipation story");
  const legacy=JSON.parse(slidePrompt(lesson,"analogy",undefined,"",undefined,{analogyMethod:"predict-transfer"}).user);
  expect(legacy.referenceVariables.TARGET_CONCEPT).toContain("cart-launcher");
});
