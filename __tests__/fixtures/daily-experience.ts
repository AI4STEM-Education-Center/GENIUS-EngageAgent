import type { LabelGrouping, StudentExtraction } from "@/lib/daily-experience-analysis";
import type { Survey, SurveyResponse } from "@/lib/types";

/**
 * Made-up survey + 20 student responses for the daily-experience analysis
 * (#114). No real student data. The responses deliberately include synonyms
 * ("football", "futbol"), typos ("socer", "bball"), watched-only activities,
 * the same activity mentioned twice, a blank response and an off-topic one.
 *
 * `expectedExtractions` and `expectedGrouping` are what a good LLM should
 * return for these responses; they drive the counting tests and later serve
 * as the reference for checking the real LLM steps.
 *
 * Expected ranking: Soccer 10 (6 do, 4 watched), Basketball 7 (4 do,
 * 3 watched), then Cooking / Video games (3 each, all do), Skateboarding 3
 * (2 do, 1 watched), Swimming 2. Two students are unclassified.
 */

const SURVEY_ID = "survey-daily";

const field = (n: number) => ({
  field_id: `f${n}`,
  label: "Your answer",
  response_type: "text" as const,
  text_length: "long" as const,
});

export const dailyExperienceSurvey: Survey = {
  survey_id: SURVEY_ID,
  class_id: "class",
  assignment_id: "assignment",
  title: "Things you do every day",
  daily_experience_topic: "Activities students do or watch, and moments when something went wrong",
  status: "published",
  questions: [
    {
      item_id: "q1", question_number: 1, category: "familiarity",
      stem: "What is one activity you do often or know well? (A sport, game, hobby, chore, or anything you do with family or friends.)",
      response_fields: [field(1)],
    },
    {
      item_id: "q2", question_number: 2, category: "experience_details",
      stem: "What do you usually do in that activity? What objects or equipment do you use?",
      response_fields: [field(2)],
    },
    {
      item_id: "q3", question_number: 3, category: "follow_up",
      stem: "Tell us about a moment in that activity when something fell, broke, got hurt, or went wrong. What happened?",
      response_fields: [field(3)],
    },
    {
      item_id: "q4", question_number: 4, category: "familiarity",
      stem: "What is a second activity you do, or have watched others do, in person or on a screen? What objects or equipment are involved?",
      response_fields: [field(4)],
    },
    {
      item_id: "q5", question_number: 5, category: "follow_up",
      stem: "Tell us about a moment in that second activity when something fell, broke, got hurt, or went wrong. What happened?",
      response_fields: [field(5)],
    },
  ],
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
};

const answers = (a1: string, a2: string, a3: string, a4: string, a5: string) =>
  ({ f1: a1, f2: a2, f3: a3, f4: a4, f5: a5 });

/** Student answers, in student_id order (so they anonymize to S1..S20). */
const rawAnswers: Record<string, string>[] = [
  answers("Soccer", "I play defense. We use a ball, cleats and shin guards.", "I slid for the ball and my shin guard cracked.", "I watch basketball on TV with my dad.", "A player fell hard going for a rebound."),
  answers("football (the real kind, with your feet)", "Passing and shooting at the goal with a ball.", "The ball hit the goal post and bounced back into my face.", "", ""),
  answers("Futbol with my cousin Diego", "We kick the ball around in the park and use cones.", "Diego tripped over a cone and scraped his knee.", "Cooking with my grandma", "The pan was too hot and the oil splashed."),
  answers("socer", "I'm the goalie, I wear gloves.", "I dove for the ball and landed on my wrist.", "I also watch soccer games on my phone", "A player got a red card for a bad tackle."),
  answers("Soccer at recess", "Mostly kicking the ball against the wall.", "The ball went over the fence and broke a flower pot.", "Watching my brother skateboard", "He fell off a ramp and his board snapped."),
  answers("Soccer", "We do drills with a ball and a goal.", "Our goal net ripped when someone shot really hard.", "Video games", "My controller fell off the couch and stopped working."),
  answers("bball", "Shooting hoops in the driveway with a basketball.", "The ball bounced off the rim and hit the car.", "I watch soccer with friends", "Someone got hurt and was carried off on a stretcher."),
  answers("Basketball", "Dribbling and shooting, we use a ball and the hoop.", "I jammed my finger catching a pass.", "", ""),
  answers("Hoops", "Pickup games at the court with a basketball.", "The net tore off the hoop.", "Watching football on TV", "The goalkeeper ran into the post."),
  answers("Basketball", "Point guard, I use a ball and sneakers.", "I rolled my ankle landing.", "Swimming at the pool", "I hit my head on the lane rope."),
  answers("Skateboarding", "Tricks at the skate park, I use my board and a helmet.", "My wheel came off mid-trick and I fell.", "", ""),
  answers("Skateboard", "Riding to school on my board.", "I hit a rock and flew off.", "Watching basketball games", "The backboard glass shattered on a dunk."),
  answers("Cooking dinner", "I use pots, a stove and a knife to make pasta.", "The pot boiled over and the water put out the flame.", "", ""),
  answers("Baking", "Cookies with an oven, bowls and a mixer.", "I dropped the tray and the cookies broke.", "I watch basketball on TV", "A player crashed into the cameras."),
  answers("Minecraft", "Building houses on my laptop.", "My laptop fell and the screen cracked.", "", ""),
  answers("Video games", "Racing games with a controller.", "I threw my controller and it broke.", "Watching soccer on TV", "A player fell and hurt his knee."),
  answers("Swimming", "Laps at the pool with goggles.", "My goggles snapped in the middle of a race.", "", ""),
  answers("I don't really do anything", "", "", "I watch soccer on TV every weekend", "A player got kicked in the leg and limped off."),
  answers("", "", "", "", ""),
  answers("idk", "nothing", "no", "", ""),
];

export const dailyExperienceResponses: SurveyResponse[] = [
  ...rawAnswers.map((a, i) => ({
    survey_id: SURVEY_ID,
    class_id: "class",
    assignment_id: "assignment",
    student_id: `student-${String(i + 1).padStart(2, "0")}`,
    student_name: `Student ${i + 1}`,
    answers: a,
    status: "submitted" as const,
    submitted_at: "2026-10-02T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
  })),
  // Must be ignored: still a draft, and a response to a different survey.
  {
    survey_id: SURVEY_ID, class_id: "class", assignment_id: "assignment",
    student_id: "student-21", answers: answers("Chess", "", "", "", ""),
    status: "draft", updated_at: "2026-10-02T00:00:00.000Z",
  },
  {
    survey_id: "other-survey", class_id: "class", assignment_id: "assignment",
    student_id: "student-22", answers: answers("Tennis", "", "", "", ""),
    status: "submitted", updated_at: "2026-10-02T00:00:00.000Z",
  },
];

const act = (
  label: string,
  involvement: "do" | "watched",
  objects: string[],
  incident?: string,
) => ({ label, involvement, objects, ...(incident ? { incident } : {}) });

export const expectedExtractions: StudentExtraction[] = [
  { student: "S1", activities: [act("soccer", "do", ["ball", "cleats", "shin guards"], "Shin guard cracked during a slide tackle"), act("basketball", "watched", [], "A player fell going for a rebound")] },
  { student: "S2", activities: [act("football", "do", ["ball", "goal"], "Ball bounced off the goal post into their face")] },
  { student: "S3", activities: [act("futbol", "do", ["ball", "cones"], "Tripped over a cone and scraped a knee"), act("cooking", "do", ["pan", "oil"], "Hot oil splashed from the pan")] },
  { student: "S4", activities: [act("socer", "do", ["ball", "gloves"], "Landed on their wrist diving for the ball"), act("soccer", "watched", [], "A player got a red card for a bad tackle")] },
  { student: "S5", activities: [act("soccer", "do", ["ball"], "Ball went over the fence and broke a flower pot"), act("skateboarding", "watched", ["skateboard", "ramp"], "Fell off a ramp and the board snapped")] },
  { student: "S6", activities: [act("soccer", "do", ["ball", "goal"], "Goal net ripped from a hard shot"), act("video games", "do", ["controller"], "Controller fell off the couch and broke")] },
  { student: "S7", activities: [act("bball", "do", ["basketball", "hoop"], "Ball bounced off the rim and hit a car"), act("soccer", "watched", [], "A player was carried off on a stretcher")] },
  { student: "S8", activities: [act("basketball", "do", ["ball", "hoop"], "Jammed a finger catching a pass")] },
  { student: "S9", activities: [act("hoops", "do", ["basketball"], "The net tore off the hoop"), act("football", "watched", [], "The goalkeeper ran into the post")] },
  { student: "S10", activities: [act("basketball", "do", ["ball", "sneakers"], "Rolled an ankle landing"), act("swimming", "do", ["lane rope"], "Hit their head on the lane rope")] },
  { student: "S11", activities: [act("skateboarding", "do", ["skateboard", "helmet"], "A wheel came off mid-trick")] },
  { student: "S12", activities: [act("skateboard", "do", ["skateboard"], "Hit a rock and flew off"), act("basketball", "watched", ["backboard"], "Backboard glass shattered on a dunk")] },
  { student: "S13", activities: [act("cooking", "do", ["pot", "stove", "knife"], "Pot boiled over and put out the flame")] },
  { student: "S14", activities: [act("baking", "do", ["oven", "bowl", "mixer"], "Dropped the tray and the cookies broke"), act("basketball", "watched", [], "A player crashed into the cameras")] },
  { student: "S15", activities: [act("minecraft", "do", ["laptop"], "Laptop fell and the screen cracked")] },
  { student: "S16", activities: [act("video games", "do", ["controller"], "Threw the controller and it broke"), act("soccer", "watched", [], "A player fell and hurt his knee")] },
  { student: "S17", activities: [act("swimming", "do", ["goggles"], "Goggles snapped during a race")] },
  { student: "S18", activities: [act("soccer", "watched", [], "A player was kicked in the leg and limped off")] },
  { student: "S19", activities: [] },
  { student: "S20", activities: [] },
];

export const expectedGrouping: LabelGrouping = {
  soccer: { category: "Sports", activity: "Soccer" },
  football: { category: "Sports", activity: "Soccer" },
  futbol: { category: "Sports", activity: "Soccer" },
  socer: { category: "Sports", activity: "Soccer" },
  basketball: { category: "Sports", activity: "Basketball" },
  bball: { category: "Sports", activity: "Basketball" },
  hoops: { category: "Sports", activity: "Basketball" },
  skateboarding: { category: "Sports", activity: "Skateboarding" },
  skateboard: { category: "Sports", activity: "Skateboarding" },
  swimming: { category: "Sports", activity: "Swimming" },
  cooking: { category: "Cooking & baking", activity: "Cooking" },
  baking: { category: "Cooking & baking", activity: "Cooking" },
  "video games": { category: "Games", activity: "Video games" },
  minecraft: { category: "Games", activity: "Video games" },
};

/**
 * A fake OpenAI client that answers like a well-behaved model, using the
 * expected output above. Extraction requests are matched by each student's
 * answers (not their S-number, which changes when only some students are
 * sent); grouping uses `expectedGrouping`. `calls` records every request.
 */
export const fakeAnalysisModel = () => {
  const keyFor = (answers: Record<string, string>) => JSON.stringify(answers);
  const byAnswers = new Map(
    rawAnswers.map((a, i) => [
      keyFor(Object.fromEntries(Object.entries(a).map(([k, v]) => [`Q${k.slice(1)}`, v.trim()]))),
      expectedExtractions[i].activities,
    ]),
  );
  const calls: { name: string; system: string; user: unknown; temperature?: number }[] = [];
  const create = async (params: {
    response_format: { json_schema: { name: string } };
    temperature?: number;
    messages: { role: string; content: string }[];
  }) => {
    const name = params.response_format.json_schema.name;
    const user = JSON.parse(params.messages[1].content);
    calls.push({ name, system: params.messages[0].content, user, temperature: params.temperature });
    const body =
      name === "daily_experience_extraction"
        ? {
            students: (user.students as { student: string; answers: Record<string, string> }[]).map((s) => ({
              student: s.student,
              activities: (byAnswers.get(keyFor(s.answers)) ?? []).map((a) => ({ ...a, incident: a.incident ?? "" })),
            })),
          }
        : { groups: (user.labels as string[]).map((label) => ({ label, ...expectedGrouping[label] })) };
    return { choices: [{ message: { content: JSON.stringify(body) } }] };
  };
  return { client: { chat: { completions: { create } } }, calls };
};
