// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LessonEditor from "@/app/components/lessons/LessonEditor";
import { emptyLessonDraft, emptyDraftQuizItem, lessonProblems, type LessonDraftContent } from "@/lib/lessons";
import { MisconceptionId } from "@/lib/misconceptions";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), goTo: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/app/components/AuthContext", () => ({ useAuth: () => ({ user: { geniusId: "t", userId: "t", name: "Ana", email: null, role: "teacher" }, loading: false, error: null }) }));
vi.mock("@/app/components/lessons/lesson-ui", async (original) => ({ ...await original<typeof import("@/app/components/lessons/lesson-ui")>(), goTo: mocks.goTo }));

// When a role query fails on a form this big, listing every role on the page takes minutes and hides the real error.
// The visibility check on every role query is also slow here, and nothing on this page hides anything with CSS.
configure({ _disableExpensiveErrorDiagnostics: true, defaultHidden: true } as Parameters<typeof configure>[0]);
vi.setConfig({ testTimeout: 30_000 });

// jsdom finds an element's labels by re-resolving every label on the page, and role
// queries ask this for every element. On a form this big that takes most of a test's
// time, so use the same rule directly: a label points at a control by id, or wraps it.
for (const proto of [HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement, HTMLButtonElement].map((type) => type.prototype)) {
  Object.defineProperty(proto, "labels", {
    configurable: true,
    get(this: HTMLElement) {
      const byId = this.id ? [...document.getElementsByTagName("label")].filter((label) => label.htmlFor === this.id) : [];
      const wrapping = this.closest("label");
      return wrapping && !wrapping.htmlFor ? [...byId, wrapping] : byId;
    },
  });
}

const MC1 = MisconceptionId.NoVisibleDamageMeansWeakForce, MC2 = MisconceptionId.HeavierAlwaysCausesMoreDamage, MC3 = MisconceptionId.ForceNeededForConstantSpeed;
const DRAFT_URL = "/api/lessons/9/draft", PUBLISH_URL = "/api/lessons/9/publish", IMAGE_URL = "/api/lessons/images";
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const stored = (content: LessonDraftContent, over = {}) => ({
  lessonId: "l", lessonNumber: 9, version: 1, content, revision: 5, updatedBy: { id: "b", name: "Bo" }, updatedAt: "2026-03-05T15:00:00Z", ...over,
});
const item = (id: string, over = {}) => ({
  ...emptyDraftQuizItem(id), stem: `${id}?`, options: { A: `${id}a`, B: `${id}b`, C: `${id}c`, D: `${id}d` },
  correct: "A" as const, matchedMisconception: MC1, explanation: `${id} because`, ...over,
});
const ready = (over: Partial<LessonDraftContent> = {}): LessonDraftContent => ({
  title: "Forces", objective: "Understand", topic: "Motion", targetConcept: "Pairs", coreIdeas: ["First", "Second", "Third"], misconceptions: [MC1, MC2],
  quizItems: [item("q1"), item("q2"), item("q3"), item("q4")], ...over,
});

type Handler = (init: RequestInit & { body?: BodyInit }) => unknown;
let routes: Record<string, Partial<Record<string, Handler>>>;
let calls: { url: string; method: string; body: unknown }[];
const callsTo = (url: string, method: string) => calls.filter((call) => call.url === url && call.method === method);

function serve(content: LessonDraftContent, over = {}) {
  let revision = 5;
  routes = {
    [DRAFT_URL]: {
      GET: () => reply({ draft: stored(content, over) }),
      PUT: (init) => { revision += 1; return reply({ draft: stored(JSON.parse(init.body as string).content, { ...over, revision, updatedBy: { id: "t", name: "Ana" } }) }); },
      POST: () => reply({ draft: stored(content, over) }),
      DELETE: () => reply({ lessonDeleted: true }),
    },
    [PUBLISH_URL]: {
      GET: () => reply({ version: 1, problems: [], changes: null, suggestedNote: "First version" }),
      POST: () => reply({ version: { version: 1, title: "Forces" } }, 201),
    },
    [IMAGE_URL]: { POST: () => reply({ url: "/api/lessons/images/abcdef.png" }, 201) },
  };
}

beforeEach(() => {
  mocks.goTo.mockReset(); calls = [];
  serve(ready());
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit & { body?: BodyInit } = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
    const result = routes[url]?.[method]?.(init);
    return result ?? reply({ error: "no route" }, 500);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = async (props = { lessonNumber: 9 }) => { render(<LessonEditor {...props} />); await screen.findByLabelText("Lesson title"); };
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string | RegExp, value: string, scope: typeof screen | ReturnType<typeof within> = screen) => fireEvent.change(scope.getByLabelText(label), { target: { value } });
const question = (name: string) => within(screen.getByRole("region", { name }));
const lastPut = () => callsTo(DRAFT_URL, "PUT").at(-1)!.body as { content: LessonDraftContent; revision: number };
const value = (element: HTMLElement) => (element as HTMLInputElement).value;

describe("the form", () => {
  it("fills in every field type, and saves exactly that", async () => {
    serve(emptyLessonDraft());
    await open();
    type("Lesson title", "Forces");
    type("Learning objective", "Understand");
    type("Topic", "Motion");
    type("Target concept", "Pairs");

    press("Add core idea");
    type("Core idea 1", "Forces pair up");
    expect(document.activeElement).toBe(screen.getByLabelText("Core idea 1"));

    fireEvent.click(screen.getByRole("checkbox", { name: /^MC01/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^MC02/ }));

    press("Add quiz item");
    expect(document.activeElement).toBe(question("Q1").getByLabelText("Question"));
    const q = question("Q1");
    type("Question", "Which one?", q);
    for (const letter of ["A", "B", "C", "D"]) type(`Option ${letter}`, `Choice ${letter}`, q);
    fireEvent.change(q.getByLabelText("Correct answer"), { target: { value: "B" } });
    fireEvent.change(q.getByLabelText("Matched misconception"), { target: { value: MC2 } });
    expect(q.getByLabelText("Matched misconception").parentElement!.textContent).toContain("Heavier objects always cause more damage");
    fireEvent.click(within(q.getByRole("group", { name: "Misconceptions for option A" })).getByRole("checkbox", { name: /^MC01/ }));
    fireEvent.click(within(q.getByRole("group", { name: "Misconceptions for option A" })).getByRole("checkbox", { name: /^MC02/ }));
    fireEvent.click(within(q.getByRole("group", { name: "Misconceptions for option C" })).getByRole("checkbox", { name: /^MC02/ }));
    expect(q.queryByRole("group", { name: "Misconceptions for option B" })).toBeNull(); // B is the correct answer.
    expect(q.getByText("MC01, MC02")).toBeTruthy();
    type("Explanation", "Because", q);

    press("Save draft");
    expect(await screen.findByText("Draft saved")).toBeTruthy();
    const { content, revision } = lastPut();
    expect(revision).toBe(5);
    expect(content).toEqual({
      title: "Forces", objective: "Understand", topic: "Motion", targetConcept: "Pairs", coreIdeas: ["Forces pair up"], misconceptions: [MC1, MC2],
      quizItems: [{
        id: expect.stringMatching(/^[A-Za-z0-9_-]{1,40}$/), stem: "Which one?", image: null,
        options: { A: "Choice A", B: "Choice B", C: "Choice C", D: "Choice D" }, correct: "B", matchedMisconception: MC2,
        wrongOptionMisconceptions: { A: [MC1, MC2], C: [MC2] }, explanation: "Because",
      }],
    });
  });

  it("tells the teacher about the confidence question and the explanation's audience", async () => {
    await open();
    expect(screen.getByText(/How confident are you about your answer\?.*added automatically/)).toBeTruthy();
    expect(screen.queryByDisplayValue(/How confident/)).toBeNull();
    expect(question("Q1").getByText("Shown to students in feedback.")).toBeTruthy();
  });

  it("gives new quiz items different ids", async () => {
    serve(emptyLessonDraft());
    await open();
    press("Add quiz item"); press("Add quiz item");
    press("Save draft");
    await screen.findByText("Draft saved");
    const [a, b] = lastPut().content.quizItems;
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
  });

  it("reorders, edits and removes core ideas, keeping focus and announcing it", async () => {
    await open();
    press("Move core idea 2 up");
    expect(value(screen.getByLabelText("Core idea 1"))).toBe("Second");
    expect(value(screen.getByLabelText("Core idea 2"))).toBe("First");
    // It reached the top, so "up" is disabled; focus goes to the other arrow, not lost.
    expect((screen.getByRole("button", { name: "Move core idea 1 up" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move core idea 1 down" }));
    expect(screen.getByText("Core idea moved to position 1.")).toBeTruthy();
    press("Move core idea 1 down");
    expect(value(screen.getByLabelText("Core idea 2"))).toBe("Second");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move core idea 2 down" }));
    expect((screen.getByRole("button", { name: "Move core idea 3 down" }) as HTMLButtonElement).disabled).toBe(true);
    type("Core idea 2", "Edited");
    press("Remove core idea 1");
    expect(value(screen.getByLabelText("Core idea 1"))).toBe("Edited");
    expect(document.activeElement).toBe(screen.getByLabelText("Core idea 1"));
    press("Remove core idea 2");
    press("Remove core idea 1");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add core idea" }));
    press("Save draft");
    await screen.findByText("Draft saved");
    expect(lastPut().content.coreIdeas).toEqual([]);
  });

  it("keeps a core idea's box when it moves, so typing isn't interrupted", async () => {
    await open();
    const box = screen.getByLabelText("Core idea 2");
    press("Move core idea 2 up");
    expect(screen.getByLabelText("Core idea 1")).toBe(box);
  });

  it("reorders quiz items", async () => {
    await open();
    press("Move Q2 up");
    expect(value(question("Q1").getByLabelText("Question"))).toBe("q2?");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Q1 down" }));
    press("Move Q3 down");
    expect(value(question("Q4").getByLabelText("Question"))).toBe("q3?");
    press("Save draft");
    await screen.findByText("Draft saved");
    expect(lastPut().content.quizItems.map((each) => each.id)).toEqual(["q2", "q1", "q4", "q3"]);
  });

  it("asks before removing a filled-in quiz item, and removes an empty one straight away", async () => {
    await open();
    press("Remove Q2");
    expect(screen.getAllByRole("button", { name: "Keep Q2" })).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep Q2" }));
    press("Keep Q2");
    expect(screen.getByRole("region", { name: "Q4" })).toBeTruthy();
    press("Remove Q2");
    fireEvent.click(within(question("Q2").getByText(/Remove Q2 and everything/).parentElement!).getByRole("button", { name: "Remove Q2" }));
    expect(screen.queryByRole("region", { name: "Q4" })).toBeNull();
    expect(value(question("Q2").getByLabelText("Question"))).toBe("q3?");

    press("Add quiz item");
    expect(screen.getByRole("region", { name: "Q4" })).toBeTruthy();
    press("Remove Q4");
    expect(screen.queryByRole("region", { name: "Q4" })).toBeNull();
  });

  it("searches misconceptions by words or ID, and shows each picked one's ID and full text", async () => {
    await open();
    const all = within(screen.getByRole("group", { name: "All misconceptions" }));
    expect(all.getAllByRole("checkbox")).toHaveLength(31);
    type("Search misconceptions", "constant speed");
    expect(all.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("2 misconceptions found")).toBeTruthy();
    fireEvent.click(all.getByRole("checkbox", { name: /^MC03/ }));
    type("Search misconceptions", "mc03");
    expect(all.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("1 misconception found")).toBeTruthy();
    type("Search misconceptions", "nothing at all like this");
    expect(all.queryAllByRole("checkbox")).toHaveLength(0);
    expect(all.getByText("No misconceptions match that search.")).toBeTruthy();
    const picked = within(screen.getByRole("list", { name: "Misconceptions in this lesson" }));
    expect(picked.getByText("MC03")).toBeTruthy();
    expect(picked.getByText("A force is needed to keep something moving at constant speed.")).toBeTruthy();
    press("Save draft");
    await screen.findByText("Draft saved");
    expect(lastPut().content.misconceptions).toEqual([MC1, MC2, MC3]);
  });

  it("offers only the lesson's misconceptions on a quiz item", async () => {
    await open();
    const options = [...question("Q1").getByLabelText("Matched misconception").querySelectorAll("option")].map((option) => option.value);
    expect(options).toEqual(["", MC1, MC2]);
    expect(within(question("Q1").getByRole("group", { name: "Misconceptions for option B" })).getAllByRole("checkbox")).toHaveLength(2);
  });

  it("shows clearly when a removed misconception is still used, and can restore it", async () => {
    serve(ready({ quizItems: [item("q1", { wrongOptionMisconceptions: { B: [MC2] } }), item("q2", { matchedMisconception: MC2 }), item("q3"), item("q4")] }));
    await open();
    expect(screen.getByText("Used by Q1, Q2")).toBeTruthy();
    press(`Remove ${MC2} from this lesson`);
    expect(screen.getByText(/MC02 isn’t in this lesson any more, but Q1, Q2 still use it/)).toBeTruthy();
    // Next to the field, before any publish attempt.
    expect(question("Q2").getByText(/MC02 isn’t in this lesson any more. Choose another/)).toBeTruthy();
    expect(value(question("Q2").getByLabelText("Matched misconception"))).toBe(MC2);
    expect(question("Q1").getByText(/MC02 isn’t in this lesson any more. Untick it/)).toBeTruthy();
    press("Add MC02 back");
    expect(screen.queryByText(/isn’t in this lesson any more/)).toBeNull();
  });

  it("flags misconceptions left on an option that becomes the correct answer", async () => {
    serve(ready({ quizItems: [item("q1", { wrongOptionMisconceptions: { B: [MC1] } }), item("q2"), item("q3"), item("q4")] }));
    await open();
    fireEvent.change(question("Q1").getByLabelText("Correct answer"), { target: { value: "B" } });
    expect(question("Q1").getByText(/This is the correct answer, so it can’t have misconceptions/)).toBeTruthy();
    fireEvent.click(within(question("Q1").getByRole("group", { name: "Misconceptions for option B" })).getByRole("checkbox", { name: /^MC01/ }));
    expect(question("Q1").queryByRole("group", { name: "Misconceptions for option B" })).toBeNull();
    press("Save draft");
    await screen.findByText("Draft saved");
    expect(lastPut().content.quizItems[0].wrongOptionMisconceptions).toEqual({});
  });

  it("doesn't count unticking and re-ticking as a change", async () => {
    serve(ready({ quizItems: [item("q1", { wrongOptionMisconceptions: { B: [MC1], C: [MC1] } }), item("q2"), item("q3"), item("q4")] }));
    await open();
    const b = within(question("Q1").getByRole("group", { name: "Misconceptions for option B" }));
    fireEvent.click(b.getByRole("checkbox", { name: /^MC01/ }));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(b.getByRole("checkbox", { name: /^MC01/ }));
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("stops adding at the most a lesson can hold", async () => {
    serve(ready({ coreIdeas: Array.from({ length: 30 }, (_, index) => `Idea ${index}`), quizItems: Array.from({ length: 50 }, (_, index) => item(`q${index}`)) }));
    render(<LessonEditor lessonNumber={9} />);
    // By id: testing-library's queries over a form this big take minutes.
    await waitFor(() => expect(document.getElementById("lesson-add-item")).toBeTruthy());
    expect((document.getElementById("lesson-add-idea") as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById("lesson-add-item") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("saving", () => {
  it('sends the latest revision and shows "Draft saved"', async () => {
    await open();
    type("Lesson title", "New title");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    press("Save draft");
    const status = await screen.findByText("Draft saved");
    expect(status.getAttribute("role")).toBe("status");
    expect(lastPut().revision).toBe(5);
    type("Lesson title", "Newer title");
    expect(screen.queryByText("Draft saved")).toBeNull();
    press("Save draft");
    await screen.findByText("Draft saved");
    expect(lastPut().revision).toBe(6);
  });

  it("shows the edits again when coming back", async () => {
    serve(ready({ title: "Saved before" }));
    await open();
    expect(value(screen.getByLabelText("Lesson title"))).toBe("Saved before");
    expect(screen.getByText(/^Last saved by Bo/)).toBeTruthy();
  });

  it("keeps the unsaved state when the teacher types during a save", async () => {
    let finish: (value: unknown) => void = () => {};
    const respond = routes[DRAFT_URL].PUT!;
    routes[DRAFT_URL].PUT = (init) => new Promise((done) => { finish = () => done(respond(init)); });
    await open();
    type("Lesson title", "One");
    press("Save draft");
    await waitFor(() => expect(screen.getAllByText("Saving...").length).toBeGreaterThan(0));
    type("Lesson title", "Two");
    await act(async () => { finish(null); });
    expect(lastPut().content.title).toBe("One");
    expect(await screen.findByText("Unsaved changes")).toBeTruthy();
    expect(value(screen.getByLabelText("Lesson title"))).toBe("Two");
  });

  it("shows a refused save and keeps what was typed", async () => {
    routes[DRAFT_URL].PUT = () => reply({ error: "Q1: question is too long." }, 400);
    await open();
    type("Lesson title", "Keep me");
    press("Save draft");
    expect((await screen.findByText("Q1: question is too long.")).getAttribute("role")).toBe("alert");
    expect(value(screen.getByLabelText("Lesson title"))).toBe("Keep me");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("explains being signed out, and keeps what was typed", async () => {
    routes[DRAFT_URL].PUT = () => reply({ error: "Sign-in required." }, 401);
    await open();
    type("Lesson title", "Keep me");
    press("Save draft");
    expect((await screen.findByText(/signed out/)).getAttribute("role")).toBe("alert");
    expect(value(screen.getByLabelText("Lesson title"))).toBe("Keep me");
  });

  describe("when someone else changed it", () => {
    const conflict = async () => {
      routes[DRAFT_URL].PUT = () => reply({ error: "Someone else just changed this lesson." }, 409);
      await open();
      type("Lesson title", "My words");
      press("Save draft");
      return screen.findByText("Someone else changed this lesson while you were editing.");
    };

    it("says so, keeps what was typed, and stops further saves", async () => {
      await conflict();
      expect(screen.getByText("What you typed is still here, but it hasn't been saved.").closest("[role=alert]")).toBeTruthy();
      expect(value(screen.getByLabelText("Lesson title"))).toBe("My words");
      expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Publish version" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('"Keep my version" saves over theirs, using their revision', async () => {
      await conflict();
      routes[DRAFT_URL].POST = () => reply({ draft: stored(ready({ title: "Their words" }), { revision: 42, updatedBy: { id: "u", name: "Cy" } }) });
      routes[DRAFT_URL].PUT = (init) => reply({ draft: stored(JSON.parse(init.body as string).content, { revision: 43 }) });
      press("Keep my version");
      await screen.findByText("Draft saved");
      expect(lastPut()).toMatchObject({ revision: 42, content: { title: "My words" } });
      expect(value(screen.getByLabelText("Lesson title"))).toBe("My words");
      expect(screen.queryByText(/Someone else/)).toBeNull();
    });

    it('"Load the latest version" asks first, then replaces what was typed', async () => {
      await conflict();
      routes[DRAFT_URL].POST = () => reply({ draft: stored(ready({ title: "Their words" }), { revision: 42 }) });
      press("Load the latest version");
      const dialog = within(screen.getByRole("dialog", { name: "Load the latest version?" }));
      fireEvent.click(dialog.getByRole("button", { name: "Keep what I typed" }));
      expect(value(screen.getByLabelText("Lesson title"))).toBe("My words");
      press("Load the latest version");
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Load the latest version" }));
      await waitFor(() => expect(value(screen.getByLabelText("Lesson title"))).toBe("Their words"));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByText(/Someone else/)).toBeNull();
      routes[DRAFT_URL].PUT = (init) => reply({ draft: stored(JSON.parse(init.body as string).content, { revision: 43 }) });
      type("Lesson title", "Again");
      press("Save draft");
      await screen.findByText("Draft saved");
      expect(lastPut().revision).toBe(42);
    });
  });

  it("handles a draft someone else published or discarded", async () => {
    routes[DRAFT_URL].PUT = () => reply({ error: "This lesson has no draft." }, 404);
    await open();
    type("Lesson title", "My words");
    press("Save draft");
    expect(await screen.findByText("Someone else published or discarded this draft while you were editing.")).toBeTruthy();
    expect(value(screen.getByLabelText("Lesson title"))).toBe("My words");
    routes[DRAFT_URL].POST = () => reply({ draft: stored(ready(), { version: 3, revision: 1 }) });
    routes[DRAFT_URL].PUT = (init) => reply({ draft: stored(JSON.parse(init.body as string).content, { version: 3, revision: 2 }) });
    press("Keep my version");
    await screen.findByText("Draft saved");
    expect(lastPut()).toMatchObject({ revision: 1, content: { title: "My words" } });
    expect(screen.getByText("Lesson 9 · Draft version 3")).toBeTruthy();
  });

  it("handles a lesson someone else deleted, keeping what was typed on the page", async () => {
    routes[DRAFT_URL].PUT = () => reply({ error: "Lesson not found." }, 404);
    routes[DRAFT_URL].POST = () => reply({ error: "Lesson not found." }, 404);
    await open();
    type("Lesson title", "My words");
    press("Save draft");
    await screen.findByText(/published or discarded/);
    press("Keep my version");
    expect(await screen.findByText(/deleted this lesson while you were editing/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep my version" })).toBeNull();
    expect(value(screen.getByLabelText("Lesson title"))).toBe("My words");
  });
});

describe("publishing", () => {
  const withProblems = (content: LessonDraftContent) => { routes[PUBLISH_URL].GET = () => reply({ version: 1, problems: lessonProblems(content), changes: null, suggestedNote: "First version" }); };

  it("saves first, then shows each problem next to its field and publishes nothing", async () => {
    const broken = ready({ title: "", quizItems: [item("q1"), item("q2"), item("q3", { correct: null }), item("q4", { explanation: "" })] });
    serve(broken);
    withProblems({ ...broken });
    await open();
    type("Topic", "Saved first");
    press("Publish version");
    const heading = await screen.findByText(/problems to fix before this can be published. Nothing was published/);
    expect(heading.closest("[role=alert]")).toBeTruthy();
    expect(calls.findIndex((call) => call.method === "PUT")).toBeLessThan(calls.findIndex((call) => call.url === PUBLISH_URL));
    expect(lastPut().content.topic).toBe("Saved first");

    const title = screen.getByLabelText("Lesson title");
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(title.getAttribute("aria-describedby")!)!.textContent).toBe("Lesson title is required");
    const correct = question("Q3").getByLabelText("Correct answer");
    expect(correct.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(correct.getAttribute("aria-describedby")!)!.textContent).toBe("Q3: correct answer is not one of the options");
    expect(question("Q4").getByText("Q4: explanation is required", { selector: "form *, p" })).toBeTruthy();
    expect(question("Q1").getByLabelText("Correct answer").getAttribute("aria-invalid")).toBeNull();

    expect(document.activeElement).toBe(title);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(callsTo(PUBLISH_URL, "POST")).toHaveLength(0);
  });

  it("scrolls to the first problem", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const broken = ready({ quizItems: [item("q1"), item("q2"), item("q3", { correct: null }), item("q4")] });
    serve(broken); withProblems(broken);
    await open();
    press("Publish version");
    await screen.findByText(/1 problem to fix/);
    expect(scroll.mock.instances[0]).toBe(question("Q3").getByLabelText("Correct answer"));
    expect(document.activeElement).toBe(question("Q3").getByLabelText("Correct answer"));
    // @ts-expect-error jsdom has no scrollIntoView of its own.
    delete Element.prototype.scrollIntoView;
  });

  it("places list-level problems at their section", async () => {
    serve(emptyLessonDraft()); withProblems(emptyLessonDraft());
    await open();
    press("Publish version");
    await screen.findByText(/problems to fix/);
    const in_ = (name: string) => within(screen.getByRole("region", { name }));
    expect(in_("Core ideas").getByText("Add at least one core idea")).toBeTruthy();
    expect(in_("Misconceptions").getByText("Add at least one misconception")).toBeTruthy();
    expect(in_("Quiz items").getByText("Add at least four quiz items")).toBeTruthy();
  });

  it("clears a problem as it's fixed, and renumbers problems after a reorder", async () => {
    const broken = ready({ title: "", quizItems: [item("q1"), item("q2"), item("q3", { correct: null }), item("q4")] });
    serve(broken); withProblems(broken);
    await open();
    press("Publish version");
    await screen.findByText(/2 problems/);
    type("Lesson title", "Fixed");
    expect(screen.queryByText("Lesson title is required")).toBeNull();
    expect(screen.getByText(/1 problem/)).toBeTruthy();
    press("Move Q3 up");
    expect(question("Q2").getAllByText("Q2: correct answer is not one of the options").length).toBeGreaterThan(0);
    expect(question("Q3").queryByText(/correct answer is not/)).toBeNull();
    // Saving doesn't bring old, fixed problems back.
    press("Save draft");
    await screen.findByText("Draft saved");
    expect(screen.queryByText("Lesson title is required")).toBeNull();
    expect(screen.getByText(/1 problem/)).toBeTruthy();
  });

  it("jumps to a field from the list of problems", async () => {
    const broken = ready({ quizItems: [item("q1", { stem: "" }), item("q2"), item("q3"), item("q4", { stem: "" })] });
    serve(broken); withProblems(broken);
    await open();
    press("Publish version");
    await screen.findByText(/2 problems/);
    press("Q4: question is required");
    expect(document.activeElement).toBe(question("Q4").getByLabelText("Question"));
  });

  it("doesn't check or publish if the save fails", async () => {
    routes[DRAFT_URL].PUT = () => reply({ error: "Storage down" }, 503);
    await open();
    type("Lesson title", "x");
    press("Publish version");
    expect((await screen.findByText("Storage down")).getAttribute("role")).toBe("alert");
    expect(callsTo(PUBLISH_URL, "GET")).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("doesn't save again when nothing changed", async () => {
    await open();
    press("Publish version");
    await screen.findByRole("dialog");
    expect(callsTo(DRAFT_URL, "PUT")).toHaveLength(0);
  });

  it('asks for a change note, suggesting "First version", then shows the published message', async () => {
    await open();
    press("Publish version");
    const dialog = within(await screen.findByRole("dialog", { name: "Publish version 1" }));
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    expect(value(dialog.getByLabelText("Change note"))).toBe("First version");
    expect(dialog.getByText("This is the first version of this lesson.")).toBeTruthy();
    expect(callsTo(PUBLISH_URL, "POST")).toHaveLength(0);
    fireEvent.click(dialog.getByRole("button", { name: "Publish version 1" }));
    const done = await screen.findByRole("heading", { name: "Lesson 9 version 1 published" });
    expect(document.activeElement).toBe(done);
    expect(callsTo(PUBLISH_URL, "POST")[0].body).toEqual({ changeNote: "First version", revision: 5 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Lesson title")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Lessons" }).getAttribute("href")).toBe("/teacher/lessons");
    expect(screen.getByRole("link", { name: "History" }).getAttribute("href")).toBe("/teacher/lessons/9/history");
  });

  it("shows what changed since the current version, with no suggested note, for version N+1", async () => {
    serve(ready(), { version: 3 });
    routes[PUBLISH_URL].GET = () => reply({
      version: 3, problems: [], suggestedNote: "",
      changes: {
        basics: [{ field: "Topic", before: "Old topic", after: "Motion" }], coreIdeas: { added: [], removed: [], changed: [], reordered: false },
        misconceptions: { added: [MC2], removed: [] }, quizItems: { added: [], removed: [], changed: [], reordered: false }, hasChanges: true,
      },
    });
    routes[PUBLISH_URL].POST = () => reply({ version: { version: 3 } }, 201);
    await open();
    press("Publish version");
    const dialog = within(await screen.findByRole("dialog", { name: "Publish version 3" }));
    expect(dialog.getByText("What changed since version 2")).toBeTruthy();
    expect(dialog.getByText("Old topic").tagName).toBe("DEL");
    expect(dialog.getByText(/MC02: Heavier objects/)).toBeTruthy();
    expect(value(dialog.getByLabelText("Change note"))).toBe("");

    fireEvent.click(dialog.getByRole("button", { name: "Publish version 3" }));
    expect((await dialog.findByRole("alert")).textContent).toBe("Add a change note.");
    expect(callsTo(PUBLISH_URL, "POST")).toHaveLength(0);
    fireEvent.change(dialog.getByLabelText("Change note"), { target: { value: "   " } });
    fireEvent.click(dialog.getByRole("button", { name: "Publish version 3" }));
    expect(callsTo(PUBLISH_URL, "POST")).toHaveLength(0);

    fireEvent.change(dialog.getByLabelText("Change note"), { target: { value: "  Fixed the topic " } });
    fireEvent.click(dialog.getByRole("button", { name: "Publish version 3" }));
    expect(await screen.findByRole("heading", { name: "Lesson 9 version 3 published" })).toBeTruthy();
    expect(callsTo(PUBLISH_URL, "POST")[0].body).toMatchObject({ changeNote: "Fixed the topic" });
  });

  it("says when nothing changed since the current version", async () => {
    serve(ready(), { version: 2 });
    routes[PUBLISH_URL].GET = () => reply({
      version: 2, problems: [], suggestedNote: "",
      changes: { basics: [], coreIdeas: { added: [], removed: [], changed: [], reordered: false }, misconceptions: { added: [], removed: [] }, quizItems: { added: [], removed: [], changed: [], reordered: false }, hasChanges: false },
    });
    await open();
    press("Publish version");
    expect(await screen.findByText(/Nothing has changed since version 1/)).toBeTruthy();
  });

  it("cancels back to the form with nothing published, and Escape does the same", async () => {
    await open();
    const publish = screen.getByRole("button", { name: "Publish version" });
    publish.focus();
    fireEvent.click(publish);
    await screen.findByRole("dialog");
    press("Cancel");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(publish);
    press("Publish version");
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(callsTo(PUBLISH_URL, "POST")).toHaveLength(0);
  });

  it("keeps Tab inside the dialog", async () => {
    await open();
    press("Publish version");
    const dialog = await screen.findByRole("dialog");
    const publish = within(dialog).getByRole("button", { name: "Publish version 1" });
    publish.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Change note"));
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(publish);
  });

  it("goes back to the conflict message if someone changed it during publishing, keeping the form", async () => {
    routes[PUBLISH_URL].POST = () => reply({ error: "Someone else just changed this lesson." }, 409);
    await open();
    press("Publish version");
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish version 1" }));
    expect(await screen.findByText("Someone else changed this lesson while you were editing.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(value(screen.getByLabelText("Lesson title"))).toBe("Forces");
  });

  it("shows problems the server finds when publishing", async () => {
    routes[PUBLISH_URL].POST = () => reply({ error: "Fix these problems before publishing.", problems: [{ field: "topic", message: "Topic is required" }] }, 422);
    await open();
    press("Publish version");
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish version 1" }));
    expect(await screen.findByText(/1 problem to fix/)).toBeTruthy();
    expect(screen.getByLabelText("Topic").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows any other publish failure in the dialog, keeping the note", async () => {
    routes[PUBLISH_URL].POST = () => reply({ error: "Lessons are unavailable right now." }, 503);
    await open();
    press("Publish version");
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Change note"), { target: { value: "My note" } });
    fireEvent.click(dialog.getByRole("button", { name: "Publish version 1" }));
    expect((await dialog.findByRole("alert")).textContent).toContain("unavailable");
    expect(value(dialog.getByLabelText("Change note"))).toBe("My note");
  });

  it("won't publish while a picture is still uploading", async () => {
    routes[IMAGE_URL].POST = () => new Promise(() => {});
    await open();
    fireEvent.change(question("Q1").getByLabelText(/Add image/), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Publish version" }) as HTMLButtonElement).disabled).toBe(true));
  });
});

describe("discarding", () => {
  it("asks on the page first, then deletes and returns to the list. A never-published lesson is deleted with it", async () => {
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    await open();
    press("Discard draft");
    const dialog = within(screen.getByRole("dialog", { name: "Discard this draft?" }));
    expect(dialog.getByText(/never published, so the whole lesson is deleted/)).toBeTruthy();
    expect(callsTo(DRAFT_URL, "DELETE")).toHaveLength(0);
    fireEvent.click(dialog.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(mocks.goTo).toHaveBeenCalledWith("/teacher/lessons"));
    expect(callsTo(DRAFT_URL, "DELETE")).toHaveLength(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("says the published version stays for a later draft", async () => {
    serve(ready(), { version: 4 });
    await open();
    press("Discard draft");
    expect(screen.getByText(/changes for version 4 are deleted. Version 3 stays as it is/)).toBeTruthy();
  });

  it('"Keep editing" deletes nothing and keeps the edits', async () => {
    await open();
    type("Lesson title", "Still here");
    press("Discard draft");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(callsTo(DRAFT_URL, "DELETE")).toHaveLength(0);
    expect(value(screen.getByLabelText("Lesson title"))).toBe("Still here");
  });

  it("shows a failed discard in the dialog", async () => {
    routes[DRAFT_URL].DELETE = () => reply({ error: "Lessons are unavailable right now." }, 503);
    await open();
    press("Discard draft");
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Discard draft" }));
    expect((await dialog.findByRole("alert")).textContent).toContain("unavailable");
    expect(mocks.goTo).not.toHaveBeenCalled();
  });

  it("treats a draft that's already gone as discarded", async () => {
    routes[DRAFT_URL].DELETE = () => reply({ error: "This lesson has no draft." }, 404);
    await open();
    press("Discard draft");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(mocks.goTo).toHaveBeenCalledWith("/teacher/lessons"));
  });

  it("doesn't warn about unsaved changes on the way out", async () => {
    await open();
    type("Lesson title", "Thrown away");
    press("Discard draft");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(mocks.goTo).toHaveBeenCalled());
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("leaving with unsaved changes", () => {
  const leaving = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };

  it("has the browser warn only while there are unsaved changes", async () => {
    await open();
    expect(leaving()).toBe(false);
    type("Lesson title", "Changed");
    expect(leaving()).toBe(true);
    press("Save draft");
    await screen.findByText("Draft saved");
    expect(leaving()).toBe(false);
  });

  it("leaves straight away with nothing unsaved", async () => {
    await open();
    press("Lessons");
    expect(mocks.goTo).toHaveBeenCalledWith("/teacher/lessons");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks first with unsaved changes, and can stay", async () => {
    await open();
    type("Lesson title", "Changed");
    press("Lessons");
    const dialog = within(screen.getByRole("dialog", { name: "Leave without saving?" }));
    expect(mocks.goTo).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Keep editing" }));
    expect(mocks.goTo).not.toHaveBeenCalled();
    expect(value(screen.getByLabelText("Lesson title"))).toBe("Changed");
  });

  it("can leave without saving, with no second warning", async () => {
    await open();
    type("Lesson title", "Changed");
    press(/^History$/);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Leave without saving" }));
    expect(mocks.goTo).toHaveBeenCalledWith("/teacher/lessons/9/history");
    expect(callsTo(DRAFT_URL, "PUT")).toHaveLength(0);
    expect(leaving()).toBe(false);
  });

  it("can save and leave, and stays if the save fails", async () => {
    await open();
    type("Lesson title", "Changed");
    press("Lessons");
    const put = routes[DRAFT_URL].PUT!;
    routes[DRAFT_URL].PUT = () => reply({ error: "Storage down" }, 503);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save draft and leave" }));
    expect((await screen.findByText("Storage down")).getAttribute("role")).toBe("alert");
    expect(mocks.goTo).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    routes[DRAFT_URL].PUT = put;
    press("Lessons");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save draft and leave" }));
    await waitFor(() => expect(mocks.goTo).toHaveBeenCalledWith("/teacher/lessons"));
    expect(lastPut().content.title).toBe("Changed");
  });

  it("guards the header links too", async () => {
    const assign = vi.fn();
    const realWindow = window;
    await open();
    type("Lesson title", "Changed");
    vi.stubGlobal("window", new Proxy(realWindow, { get(target, key) { return key === "location" ? { assign } : Reflect.get(target, key); } }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "EngageAgent" })).getByRole("link", { name: "Gallery" }));
    expect(screen.getByRole("dialog", { name: "Leave without saving?" })).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Leave without saving" }));
    expect(assign).toHaveBeenCalledWith("/teacher/classes?view=gallery");
  });
});

describe("pictures", () => {
  const pick = (file: File, name = "Q1") => fireEvent.change(question(name).getByLabelText(/(Add|Replace) image/), { target: { files: [file] } });
  const png = () => new File(["fake"], "a.png", { type: "image/png" });

  it("uploads a picture, shows it, and saves it with the item", async () => {
    await open();
    expect(question("Q1").getByLabelText(/Add image for Q1/).getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
    pick(png());
    const picture = await question("Q1").findByRole("img", { name: "Picture for Q1" });
    expect(picture.getAttribute("src")).toBe("/api/lessons/images/abcdef.png");
    expect(callsTo(IMAGE_URL, "POST")[0].body).toBeInstanceOf(FormData);
    expect((callsTo(IMAGE_URL, "POST")[0].body as FormData).get("file")).toBeInstanceOf(File);
    expect(screen.getByText("Image added.")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    press("Save draft");
    await screen.findByText("Draft saved");
    expect(lastPut().content.quizItems[0].image).toBe("/api/lessons/images/abcdef.png");
    expect(lastPut().content.quizItems[1].image).toBeNull();
  });

  it("removes a picture", async () => {
    serve(ready({ quizItems: [item("q1", { image: "/quiz-images/a.png" }), item("q2"), item("q3"), item("q4")] }));
    await open();
    expect(question("Q1").getByLabelText(/Replace image for Q1/)).toBeTruthy();
    fireEvent.click(question("Q1").getByRole("button", { name: /Remove image/ }));
    expect(question("Q1").queryByRole("img")).toBeNull();
    press("Save draft");
    await screen.findByText("Draft saved");
    expect(lastPut().content.quizItems[0].image).toBeNull();
  });

  it("on a failed upload shows an error toast and saves the rest of the draft", async () => {
    routes[IMAGE_URL].POST = () => reply({ error: "Use a PNG, JPEG, or WebP image." }, 415);
    await open();
    type("Lesson title", "Rest of the draft");
    pick(png());
    const toast = await screen.findByText(/The image couldn't be uploaded. Use a PNG, JPEG, or WebP image. The rest of your draft is saved./);
    expect(toast.closest("[role=alert]")).toBeTruthy();
    expect(lastPut().content.title).toBe("Rest of the draft");
    expect(lastPut().content.quizItems[0].image).toBeNull();
    expect(question("Q1").queryByRole("img")).toBeNull();
    expect(screen.getByText("Draft saved")).toBeTruthy();
    press("Dismiss");
    expect(screen.queryByText(/The image couldn't be uploaded/)).toBeNull();
  });

  it("doesn't claim the draft was saved if that failed too, and keeps the edits", async () => {
    routes[IMAGE_URL].POST = () => reply({ error: "Storage down" }, 503);
    routes[DRAFT_URL].PUT = () => reply({ error: "Storage down" }, 503);
    await open();
    type("Lesson title", "Rest of the draft");
    pick(png());
    expect(await screen.findByText(/Your other edits are still on this page, but aren't saved yet/)).toBeTruthy();
    expect(value(screen.getByLabelText("Lesson title"))).toBe("Rest of the draft");
  });

  it("doesn't save again after a failed upload if nothing was unsaved", async () => {
    routes[IMAGE_URL].POST = () => reply({ error: "Storage down" }, 503);
    await open();
    pick(png());
    expect(await screen.findByText(/The rest of your draft is saved/)).toBeTruthy();
    expect(callsTo(DRAFT_URL, "PUT")).toHaveLength(0);
  });

  it("refuses a too-large file without sending it", async () => {
    await open();
    const big = new File([new Uint8Array(4_000_001)], "big.png", { type: "image/png" });
    pick(big);
    expect(await screen.findByText(/That image is too large. The limit is 4 MB./)).toBeTruthy();
    expect(callsTo(IMAGE_URL, "POST")).toHaveLength(0);
  });

  it("drops the picture quietly if its question was removed during the upload", async () => {
    let finish: (value: unknown) => void = () => {};
    routes[IMAGE_URL].POST = () => new Promise((done) => { finish = done; });
    serve(ready());
    routes[IMAGE_URL].POST = () => new Promise((done) => { finish = done; });
    await open();
    pick(png(), "Q4");
    await waitFor(() => expect(callsTo(IMAGE_URL, "POST")).toHaveLength(1));
    press("Remove Q4");
    fireEvent.click(within(question("Q4").getByText(/Remove Q4 and everything/).parentElement!).getByRole("button", { name: "Remove Q4" }));
    await act(async () => { finish(reply({ url: "/api/lessons/images/late.png" }, 201)); });
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("opening", () => {
  it("shows a load failure with a way to try again", async () => {
    routes[DRAFT_URL].GET = () => reply({ error: "Lessons are unavailable right now." }, 503);
    render(<LessonEditor lessonNumber={9} />);
    expect((await screen.findByRole("alert")).textContent).toContain("unavailable");
    routes[DRAFT_URL].GET = () => reply({ draft: stored(ready()) });
    press("Try again");
    expect(await screen.findByLabelText("Lesson title")).toBeTruthy();
  });

  it("explains a lesson with no draft and starts one only when asked", async () => {
    routes[DRAFT_URL].GET = () => reply({ error: "This lesson has no draft." }, 404);
    render(<LessonEditor lessonNumber={9} />);
    expect(await screen.findByRole("heading", { name: "This lesson has no draft" })).toBeTruthy();
    expect(callsTo(DRAFT_URL, "POST")).toHaveLength(0);
    press("Edit");
    expect(await screen.findByLabelText("Lesson title")).toBeTruthy();
    expect(callsTo(DRAFT_URL, "POST")).toHaveLength(1);
  });

  it("reports a lesson that doesn't exist at all", async () => {
    routes[DRAFT_URL].GET = () => reply({ error: "Lesson not found." }, 404);
    routes[DRAFT_URL].POST = () => reply({ error: "Lesson not found." }, 404);
    render(<LessonEditor lessonNumber={9} />);
    await screen.findByRole("heading", { name: "This lesson has no draft" });
    press("Edit");
    expect((await screen.findByRole("alert")).textContent).toBe("Lesson not found.");
  });
});
