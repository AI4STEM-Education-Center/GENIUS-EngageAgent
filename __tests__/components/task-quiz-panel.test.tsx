// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskQuizPanel from "@/app/components/assessment/TaskQuizPanel";
import TaskQuizPublishBar from "@/app/components/assessment/TaskQuizPublishBar";
import { useTaskQuiz } from "@/app/components/assessment/useTaskQuiz";
import { MisconceptionId, MISCONCEPTION_TEXT } from "@/lib/misconceptions";
import {
  applyItemChange, applyMatchResults, assertReplaceAllowed, createdMessage, emptyTaskQuiz, fileImportMessage, importedItem, linkImportMessage, notMatchedYet,
  parseItemChange, publishedBarLines, publishedMessage, ReplaceConfirmationError, studentQuizHeading, studentQuizItems, taskQuizView,
  type MatchResult, type TaskQuiz, type TaskQuizItem,
} from "@/lib/task-quiz";

const MC1 = MisconceptionId.NoVisibleDamageMeansWeakForce, MC2 = MisconceptionId.HeavierAlwaysCausesMoreDamage, MC3 = MisconceptionId.ForceNeededForConstantSpeed;
const task = { classId: "c1", assignmentId: "t1" };
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

const lessonOne = { number: 1, version: 2, title: "Lesson 1", objective: "Explain collisions", topic: "t", targetConcept: "c", coreIdeas: ["Forces come in pairs", "Energy moves"], misconceptions: [MC1, MC2] };
const lessonTwo = { ...lessonOne, number: 2, title: "Lesson 2", objective: "Explain springs", coreIdeas: ["Springs stretch"], misconceptions: [MC2] };
const card = (lesson: typeof lessonOne) => ({ ...lesson, misconceptions: lesson.misconceptions.map((id) => ({ id, text: MISCONCEPTION_TEXT[id] })) });

const provided = (id: string): TaskQuizItem => ({
  id, origin: "Lesson bank", stem: `${id} question?`, image: id === "L1" ? "/q1.png" : null, explanation: "Secret reason", answer: "A", answerSetBy: "lesson", answerSuggestion: null, confirmed: true, reviewed: false,
  options: ["A", "B", "C", "D"].map((letter) => ({
    letter, text: `${id} ${letter} text`, possibleNew: [],
    match: letter === "A" ? notMatchedYet() : letter === "B"
      ? { state: "matched", ids: [MC1], setBy: "lesson", confidence: null, reason: null }
      : { state: "no_misconception", ids: [], setBy: "lesson", confidence: null, reason: null },
  })),
});

const imported = (): TaskQuizItem[] => [
  importedItem("U1", "Uploaded one?", ["a1", "b1", "c1", "d1"], "A"),
  importedItem("U2", "Uploaded two?", ["a2", "b2", "c2", "d2"], null),
];
const aiItems = (count: number): TaskQuizItem[] => Array.from({ length: count }, (_, index) => {
  const item = importedItem(`AI${index}`, `AI question ${index}?`, ["a", "b", "c", "d"], "A");
  return {
    ...item, origin: "Created with AI" as const,
    options: item.options.map((option) => (option.letter === "A" ? option : option.letter === "B"
      ? { ...option, match: { state: "matched" as const, ids: [MC1], setBy: "ai" as const, confidence: "High" as const, reason: "Fits the idea" } }
      : { ...option, match: { state: "no_misconception" as const, ids: [], setBy: "ai" as const, confidence: "Low" as const, reason: "Plausible distractor; no listed idea fits." } })),
  };
});
const matchResults: MatchResult[] = [
  { itemId: "U1", answerSuggestion: null, options: {
    B: { ids: [MC1], noMisconception: false, confidence: "High", reason: "Reason B" },
    C: { ids: [], noMisconception: true, confidence: "Medium", reason: "Plausible distractor; no listed idea fits." },
    D: { ids: [MC3], noMisconception: false, confidence: "Low", reason: "Outside the lesson" },
  } },
  { itemId: "U2", answerSuggestion: { letter: "C", confidence: "High", reason: "C is what the idea says" }, options: {
    A: { ids: [MC2], noMisconception: false, confidence: "Medium", reason: "Reason A" },
    B: { ids: [MC1], noMisconception: false, confidence: "High", reason: "Reason B" },
    D: { ids: [], noMisconception: true, confidence: "Low", reason: "None fits" },
  } },
];

// A stand-in for app/api/task-quiz that uses the real rules from lib/task-quiz.ts.
let quiz: TaskQuiz;
let legacy: string | null;
let bar: ReturnType<typeof publishedBarLines> & { classSize: number | null };
let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
let held: Record<string, Promise<void> | undefined>;
let override: Record<string, (() => Response) | undefined>;

const callsTo = (path: string) => calls.filter((call) => call.url.split("?")[0] === path);
const save = (next: TaskQuiz) => { quiz = { ...next, revision: quiz.revision + 1 }; return taskQuizView(quiz); };
const replaced = (source: TaskQuiz["source"], items: TaskQuizItem[], detail: TaskQuiz["sourceDetail"], message: string, confirm: boolean) => {
  try {
    assertReplaceAllowed(quiz, source!, confirm);
  } catch (error) {
    if (error instanceof ReplaceConfirmationError) return reply({ error: error.message, code: "confirm_replace", reviewedCount: error.reviewedCount }, 409);
    throw error;
  }
  return reply({ message, quiz: save({ ...quiz, source, items, sourceDetail: detail }) });
};

function server(url: string, init?: RequestInit) {
  const path = url.split("?")[0];
  const params = new URLSearchParams(url.split("?")[1] ?? "");
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
  calls.push({ url, method, body });
  const forced = override[path]?.();
  if (forced) return forced;
  const confirm = body?.confirmReplace === true || params.get("confirmReplace") === "1";
  switch (path) {
    case "/api/task-quiz":
      return reply({ quiz: taskQuizView(quiz), legacyStatus: legacy, ...(quiz.status === "published" ? { publishedBar: bar } : {}) });
    case "/api/task-quiz/lesson":
      if (method === "GET") {
        const wanted = params.get("lessonNumber");
        return reply({ lessons: [{ lessonNumber: 1, title: "Lesson 1", currentVersion: 2 }, { lessonNumber: 2, title: "Lesson 2", currentVersion: 1 }], lesson: card(wanted === "2" ? lessonTwo : lessonOne) });
      }
      if (quiz.items.some((item) => item.reviewed) && !confirm) {
        const count = quiz.items.filter((item) => item.reviewed).length;
        return reply({ error: `Replace the ${count} item${count === 1 ? "" : "s"} you've reviewed?`, code: "confirm_replace", reviewedCount: count }, 409);
      }
      return reply({ quiz: save({ ...quiz, lesson: body?.lessonNumber === 2 ? lessonTwo : lessonOne, source: "provided", sourceDetail: null, items: [provided("L1"), provided("L2")] }) });
    case "/api/task-quiz/anchoring":
      return reply({ quiz: save({ ...quiz, anchoringPhenomenon: String(body?.anchoringPhenomenon).trim() }) });
    case "/api/task-quiz/source":
      return replaced("provided", [provided("L1"), provided("L2")], null, "", confirm);
    case "/api/task-quiz/upload":
      return replaced("uploaded", imported(), { kind: "file", fileName: String(params.get("fileName")), fileKind: "docx", bytes: 9, storageKey: "k", at: "now" }, fileImportMessage(imported(), String(params.get("fileName"))), confirm);
    case "/api/task-quiz/link":
      return replaced("uploaded", imported(), { kind: "link", url: String(body?.url), site: "forms.gle", at: "now" }, linkImportMessage(imported(), "forms.gle"), confirm);
    case "/api/task-quiz/create":
      return replaced("ai", aiItems(Number(body?.count)), null, createdMessage(aiItems(Number(body?.count))), confirm);
    case "/api/task-quiz/match":
      return reply({ message: "Suggestions ready — review each item", quiz: save(applyMatchResults(quiz, matchResults)) });
    case "/api/task-quiz/item": {
      const change = parseItemChange(body!);
      if ("error" in change) return reply({ error: change.error }, 400);
      return reply({ quiz: save(applyItemChange(quiz, String(body?.itemId), change)) });
    }
    case "/api/task-quiz/preview":
      return reply({ heading: studentQuizHeading(quiz), items: studentQuizItems(quiz) });
    case "/api/task-quiz/publish":
      quiz = { ...quiz, status: "published", revision: quiz.revision + 1 };
      return reply({ message: publishedMessage(bar.classSize), publishedBar: bar, quiz: taskQuizView(quiz) }, 201);
    case "/api/task-quiz/source-file":
      return reply({ url: "/files/warm-up.docx", fileName: "Warm-up.docx" });
    default:
      throw new Error(`Unexpected request: ${url}`);
  }
}

const events = vi.hoisted(() => ({ picked: [] as number[], published: [] as number[], step2: 0 }));

function Harness() {
  const quizState = useTaskQuiz({ ...task, active: true, onLessonPicked: (n) => events.picked.push(n), onPublished: (n) => events.published.push(n) });
  return (
    <>
      {quizState.view && <p data-testid="status">{quizState.view.stepStatus}|{quizState.view.tabStatus}</p>}
      <TaskQuizPanel quiz={quizState} />
      <TaskQuizPublishBar quiz={quizState} onGoToStep2={() => { events.step2 += 1; }} />
    </>
  );
}

const start = async (over: Partial<TaskQuiz> = {}) => {
  quiz = { ...quiz, ...over };
  render(<Harness />);
  await screen.findByLabelText("Lesson");
  await waitFor(() => expect((screen.getByLabelText("Lesson") as HTMLSelectElement).disabled).toBe(quiz.status === "published"));
};
const withLesson = (over: Partial<TaskQuiz> = {}): Partial<TaskQuiz> => ({ lesson: lessonOne, source: "provided", items: [provided("L1"), provided("L2")], ...over });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const findItem = (number: number) => screen.findByRole("article", { name: `Item ${number}` });
const item = (number: number) => screen.getByRole("article", { name: `Item ${number}` });
const source = (name: RegExp) => within(screen.getByRole("group", { name: "Quiz source" })).getByRole("button", { name });
const uploadedFile = (size = 9, name = "Collisions warm-up.docx") => {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
};
const chooseFile = (file: File) => fireEvent.change(screen.getByLabelText("Upload a file"), { target: { files: [file] } });
const toast = () => screen.findByRole("status");
const alert = () => screen.findByRole("alert");

beforeEach(() => {
  quiz = emptyTaskQuiz(task.classId, task.assignmentId);
  legacy = null;
  bar = { ...publishedBarLines({ className: "Period 3", classSize: 24, submitted: 0 }), classSize: 24 };
  calls = []; held = {}; override = {};
  events.picked = []; events.published = []; events.step2 = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const wait = held[input.split("?")[0]];
    if (wait) await wait;
    return server(input, init);
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

/** Keeps a route waiting so "Reading…" and the like can be seen. */
const hold = (path: string) => { let release = () => {}; held[path] = new Promise<void>((resolve) => { release = () => { held[path] = undefined; resolve(); }; }); return () => act(async () => { release(); }); };

describe("UC 4.1: the lesson and the provided quiz", () => {
  it("shows the first lesson's card before anything is picked, and pins nothing just by looking", async () => {
    await start();
    const lesson = screen.getByRole("region", { name: "Lesson details" });
    expect(within(lesson).getByText("Learning objective")).toBeInTheDocument();
    expect(within(lesson).getByText("Explain collisions")).toBeInTheDocument();
    expect(within(lesson).getAllByRole("listitem").map((row) => row.textContent)).toEqual(expect.arrayContaining(["Forces come in pairs", "Energy moves", `${MC1}${MISCONCEPTION_TEXT[MC1]}`]));
    expect(lesson.querySelectorAll("ol > li")).toHaveLength(2);
    expect(screen.getByLabelText(/Anchoring phenomenon/)).toBeInTheDocument();
    expect(screen.getByText("(optional)")).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    expect(source(/Provided \(Lesson 1\)/)).toBeDisabled();
    expect(screen.getByTestId("status").textContent).toBe("Not started|");
  });

  it("picks the shown lesson, then lists the provided items, confirmed and ready", async () => {
    await start();
    fireEvent.click(button("Use this lesson"));
    const first = await findItem(1);
    expect(events.picked).toEqual([1]);
    expect(callsTo("/api/task-quiz/lesson").at(-1)?.body).toMatchObject({ ...task, lessonNumber: 1 });
    expect(source(/Provided \(Lesson 1\)/)).toHaveAttribute("aria-pressed", "true");
    expect(within(first).getByText("Lesson bank")).toBeInTheDocument();
    expect(within(first).getByText("L1 question?")).toBeInTheDocument();
    expect(within(first).getByRole("img", { name: "Visual reference for question 1" })).toHaveAttribute("src", "/q1.png");
    expect(within(first).getByText("Confirmed")).toBeInTheDocument();
    expect(within(first).getByText("Correct").parentElement).toHaveTextContent("L1 A text");
    expect(within(first).getByText(MC1)).toBeInTheDocument();
    expect(within(first).queryByRole("button", { name: "Confirm item" })).toBeNull();
    expect(within(item(2)).queryByRole("img")).toBeNull();
    expect(screen.getByTestId("status").textContent).toBe("Ready to publish|Ready");
    expect(screen.getByText("Quiz · 2 items confirmed")).toBeInTheDocument();
  });

  it("pinning goes through the picker when a lesson is chosen from the list", async () => {
    await start(withLesson());
    fireEvent.change(screen.getByLabelText("Lesson"), { target: { value: "2" } });
    await waitFor(() => expect(events.picked).toEqual([2]));
    expect(await screen.findByText("Explain springs")).toBeInTheDocument();
    expect(source(/Provided \(Lesson 2\)/)).toBeInTheDocument();
  });

  it("saves the anchoring phenomenon when the teacher leaves the box", async () => {
    await start(withLesson());
    const box = screen.getByLabelText(/Anchoring phenomenon/);
    fireEvent.blur(box);
    expect(callsTo("/api/task-quiz/anchoring")).toEqual([]);
    fireEvent.change(box, { target: { value: "Two carts collide" } });
    fireEvent.blur(box);
    await waitFor(() => expect(callsTo("/api/task-quiz/anchoring")[0]?.body).toMatchObject({ anchoringPhenomenon: "Two carts collide" }));
  });

  it("doesn't save the box again when it ends up the same as what's saved", async () => {
    await start(withLesson({ anchoringPhenomenon: "Two carts collide" }));
    const box = screen.getByLabelText(/Anchoring phenomenon/);
    fireEvent.change(box, { target: { value: " Two carts collide " } });
    fireEvent.blur(box);
    expect(callsTo("/api/task-quiz/anchoring")).toEqual([]);
  });

  it("ignores a slow reply older than what's already on screen", async () => {
    await start(withLesson({ revision: 5 }));
    await findItem(1);
    override["/api/task-quiz/anchoring"] = () => reply({ quiz: taskQuizView({ ...quiz, revision: 2, items: [] }) });
    const box = screen.getByLabelText(/Anchoring phenomenon/);
    fireEvent.change(box, { target: { value: "x" } });
    fireEvent.blur(box);
    await waitFor(() => expect(callsTo("/api/task-quiz/anchoring")).toHaveLength(1));
    await act(async () => {});
    expect(item(1)).toBeInTheDocument();
  });

  it("lets the teacher change a provided item's misconceptions, which takes it back to review if it loses a match", async () => {
    await start(withLesson());
    const first = await findItem(1);
    fireEvent.click(within(first).getByRole("button", { name: `Remove ${MC1} from option B` }));
    await within(first).findByText("Needs your review");
    expect(within(first).getByText("Not matched yet")).toBeInTheDocument();
    expect(callsTo("/api/task-quiz/item").at(-1)?.body).toMatchObject({ itemId: "L1", action: "setMatch", letter: "B", ids: [] });
    expect(screen.getByTestId("status").textContent).toBe("In progress|Needs review");
    expect(screen.getByText("Quiz · 1 of 2 confirmed")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 items need confirmation")).toBeInTheDocument();
    expect(button("Publish task")).toBeDisabled();
  });

  it("offers a retry when the quiz can't load", async () => {
    override["/api/task-quiz"] = () => reply({ error: "The quiz is unavailable right now." }, 503);
    render(<Harness />);
    expect((await alert()).textContent).toContain("The quiz is unavailable right now.");
    override = {};
    fireEvent.click(button("Try again"));
    expect(await screen.findByLabelText("Lesson")).toBeInTheDocument();
  });
});

describe("UC 4.2: upload or link", () => {
  const openUpload = async () => { await start(withLesson()); fireEvent.click(source(/Upload or link/)); };

  it("shows both choices side by side with the issue's words", async () => {
    await openUpload();
    expect(screen.getByRole("heading", { name: "Upload a file" })).toBeInTheDocument();
    expect(screen.getByText("Word, PDF, or PowerPoint")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add a link" })).toBeInTheDocument();
    expect(screen.getByText("Google Forms, Google Docs, Microsoft Forms, or a web page")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload a file")).toHaveAttribute("accept", ".docx,.pdf,.pptx");
    expect(screen.getByLabelText("Quiz link")).toBeInTheDocument();
    expect(button("Import")).toBeInTheDocument();
  });

  it("uploads the raw file, shows Reading… and the toast, then the cards for review", async () => {
    await openUpload();
    const release = hold("/api/task-quiz/upload");
    const file = uploadedFile();
    chooseFile(file);
    expect(await screen.findByRole("button", { name: "Reading…" })).toBeDisabled();
    await release();
    expect((await toast()).textContent).toContain("2 items read from Collisions warm-up.docx — 1 has no answer key");
    const call = callsTo("/api/task-quiz/upload")[0];
    expect(call.url).toContain("fileName=Collisions%20warm-up.docx");
    expect(call.url).not.toContain("confirmReplace");
    const sent = vi.mocked(fetch).mock.calls.find(([url]) => String(url).startsWith("/api/task-quiz/upload"))![1]!;
    expect(sent.body).toBe(file);
    const first = await findItem(1), second = item(2);
    expect(within(first).getByText("Uploaded")).toBeInTheDocument();
    expect(within(first).getByText("Needs your review")).toBeInTheDocument();
    expect(within(first).getAllByText("Not matched yet")).toHaveLength(3);
    expect(within(first).queryByText("No answer key")).toBeNull();
    expect(within(second).getByText("No answer key")).toBeInTheDocument();
    expect(within(second).getAllByText("Not matched yet")).toHaveLength(4);
    expect(screen.getByText("Collisions warm-up.docx")).toBeInTheDocument();
  });

  it("opens the stored file so the teacher can see where the items came from", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    await start(withLesson({ source: "uploaded", items: imported(), sourceDetail: { kind: "file", fileName: "Warm-up.docx", fileKind: "docx", bytes: 9, storageKey: "k", at: "now" } }));
    fireEvent.click(button("Warm-up.docx"));
    await waitFor(() => expect(open).toHaveBeenCalledWith("/files/warm-up.docx", "_blank", "noopener"));
  });

  it("refuses a file over 10 MB without uploading it", async () => {
    await openUpload();
    chooseFile(uploadedFile(10 * 1024 * 1024 + 1));
    expect((await alert()).textContent).toContain("Files up to 10 MB");
    expect(callsTo("/api/task-quiz/upload")).toEqual([]);
  });

  it("takes a file of exactly 10 MB", async () => {
    await openUpload();
    chooseFile(uploadedFile(10 * 1024 * 1024));
    await waitFor(() => expect(callsTo("/api/task-quiz/upload")).toHaveLength(1));
  });

  it("keeps the previous quiz when the file has no items", async () => {
    await openUpload();
    override["/api/task-quiz/upload"] = () => reply({ error: "No multiple-choice items found in notes.pdf" }, 422);
    chooseFile(uploadedFile(9, "notes.pdf"));
    expect((await alert()).textContent).toContain("No multiple-choice items found in notes.pdf");
    expect(quiz.source).toBe("provided");
    fireEvent.click(source(/Provided/));
    expect(await findItem(1)).toHaveTextContent("Lesson bank");
  });

  it("imports a link and says so", async () => {
    await openUpload();
    fireEvent.change(screen.getByLabelText("Quiz link"), { target: { value: " https://forms.gle/abc " } });
    fireEvent.click(button("Import"));
    expect((await toast()).textContent).toContain("2 items imported from forms.gle — 1 has no answer key");
    expect(callsTo("/api/task-quiz/link")[0].body).toMatchObject({ url: "https://forms.gle/abc" });
    expect(await screen.findByRole("link", { name: "forms.gle" })).toHaveAttribute("href", "https://forms.gle/abc");
  });

  it("shows Reading… on Import while a link is read", async () => {
    await openUpload();
    const release = hold("/api/task-quiz/link");
    fireEvent.change(screen.getByLabelText("Quiz link"), { target: { value: "https://forms.gle/abc" } });
    fireEvent.click(button("Import"));
    expect(await screen.findByRole("button", { name: "Reading…" })).toBeDisabled();
    await release();
  });

  it.each([
    ["a link that isn't a full URL", "Paste a full link starting with https://", 400],
    ["a private form", "This form isn't public — share it as 'Anyone with the link'", 422],
  ])("says why for %s, and leaves the quiz alone", async (_, message, status) => {
    await openUpload();
    override["/api/task-quiz/link"] = () => reply({ error: message }, status);
    fireEvent.change(screen.getByLabelText("Quiz link"), { target: { value: "forms" } });
    fireEvent.click(button("Import"));
    expect((await alert()).textContent).toContain(message);
    expect(quiz.source).toBe("provided");
    expect(quiz.items.map((entry) => entry.id)).toEqual(["L1", "L2"]);
  });

  it("marks an item without four options, blocks Confirm, and lets the teacher fix its options", async () => {
    const short = importedItem("S1", "Short one?", ["a", "b", "c"], "A");
    await start(withLesson({ source: "uploaded", items: [short] }));
    const row = await findItem(1);
    expect(within(row).getByText("Needs your review")).toBeInTheDocument();
    expect(within(row).getByText("This item needs exactly four options, A to D")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Confirm item" })).toBeDisabled();
    fireEvent.click(within(row).getByRole("button", { name: "Edit options" }));
    fireEvent.click(within(row).getByRole("button", { name: "Add option" }));
    expect(within(row).getByRole("button", { name: "Save options" })).toBeDisabled();
    fireEvent.change(within(row).getByLabelText("Option 4 text"), { target: { value: "d" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save options" }));
    await waitFor(() => expect(callsTo("/api/task-quiz/item").at(-1)?.body).toMatchObject({ action: "setOptions", options: ["a", "b", "c", "d"] }));
    await waitFor(() => expect(within(row).queryByText("This item needs exactly four options, A to D")).toBeNull());
    expect(within(row).queryByRole("button", { name: "Edit options" })).toBeNull();
    expect(within(row).getAllByText("Not matched yet")).toHaveLength(3);
  });

  it("can replace uploaded items with another file", async () => {
    await start(withLesson({ source: "uploaded", items: imported() }));
    expect(screen.queryByRole("heading", { name: "Upload a file" })).toBeNull();
    fireEvent.click(button("Replace with another file or link"));
    expect(screen.getByRole("heading", { name: "Upload a file" })).toBeInTheDocument();
    fireEvent.click(button("Keep these items"));
    expect(screen.queryByRole("heading", { name: "Upload a file" })).toBeNull();
  });
});

describe("UC 4.3: create with AI", () => {
  const openAi = async () => { await start(withLesson()); fireEvent.click(source(/Create with AI/)); };

  it("offers the three settings and sends what was chosen, showing Writing items…", async () => {
    await openAi();
    expect(screen.getByRole("heading", { name: "Create quiz items with AI" })).toBeInTheDocument();
    const options = (label: string) => within(screen.getByLabelText(label)).getAllByRole("option").map((option) => option.textContent);
    expect(options("Number of items")).toEqual(["3", "4", "5"]);
    expect(options("Focus")).toEqual(["All core ideas", "Core idea 1", "Core idea 2"]);
    expect(options("Reading level")).toEqual(["Grade 6", "Grade 7", "Grade 8"]);
    fireEvent.change(screen.getByLabelText("Number of items"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Focus"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Reading level"), { target: { value: "Grade 8" } });
    const release = hold("/api/task-quiz/create");
    fireEvent.click(button("Create items"));
    expect(await screen.findByRole("button", { name: "Writing items…" })).toBeDisabled();
    await release();
    expect((await toast()).textContent).toContain("4 items created with suggested misconception matches");
    expect(callsTo("/api/task-quiz/create")[0].body).toMatchObject({ count: 4, focus: 2, readingLevel: "Grade 8" });
  });

  it("shows AI items with suggested chips, a spark, and the confidence line", async () => {
    await openAi();
    fireEvent.click(button("Create items"));
    const first = await findItem(1);
    expect(within(first).getByText("Created with AI")).toBeInTheDocument();
    expect(within(first).getByText("Needs your review")).toBeInTheDocument();
    expect(within(first).getByText("AI · High confidence. Fits the idea")).toBeInTheDocument();
    expect(within(first).getAllByText("AI · Low confidence. Plausible distractor; no listed idea fits.")).toHaveLength(2);
    expect(within(first).getAllByLabelText("AI suggestion").length).toBeGreaterThanOrEqual(3);
    expect(within(first).getAllByText("No misconception")).toHaveLength(2);
    expect(within(first).getByRole("button", { name: "Confirm item" })).toBeEnabled();
    expect(screen.queryByText("Misconceptions not matched yet")).toBeNull();
    expect(screen.getByText("3 of 3 items need confirmation")).toBeInTheDocument();
  });

  it("leaves the quiz alone when AI fails", async () => {
    await openAi();
    override["/api/task-quiz/create"] = () => reply({ error: "Couldn't create items — try again" }, 502);
    fireEvent.click(button("Create items"));
    expect((await alert()).textContent).toContain("Couldn't create items — try again");
    expect(quiz.source).toBe("provided");
    expect(button("Create items")).toBeEnabled();
  });

  it("can run again, with no question asked, replacing the earlier AI items", async () => {
    await start(withLesson({ source: "ai", items: aiItems(3) }));
    fireEvent.click(within(await findItem(1)).getByRole("button", { name: "Confirm item" }));
    await within(item(1)).findByText("Confirmed");
    fireEvent.click(button("Create items"));
    await waitFor(() => expect(callsTo("/api/task-quiz/create")).toHaveLength(1));
    expect(callsTo("/api/task-quiz/create")[0].body?.confirmReplace).toBe(false);
    await within(await findItem(1)).findByText("Needs your review");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("UC 4.4: matching and confirming", () => {
  const matched = async () => {
    await start(withLesson({ source: "uploaded", items: imported() }));
    fireEvent.click(button("Match all items"));
    await toast();
    return { first: await findItem(1), second: item(2) };
  };

  it("shows the banner, Matching…, then suggestions", async () => {
    await start(withLesson({ source: "uploaded", items: imported() }));
    expect(screen.getByText("Misconceptions not matched yet")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 items need confirmation")).toBeInTheDocument();
    const release = hold("/api/task-quiz/match");
    fireEvent.click(button("Match all items"));
    expect(await screen.findByRole("button", { name: "Matching…" })).toBeDisabled();
    await release();
    expect((await toast()).textContent).toContain("Suggestions ready — review each item");
    expect(screen.getByText("AI · High confidence. C is what the idea says")).toBeInTheDocument();
    expect(within(item(1)).queryByText("Not matched yet")).toBeNull();
    expect(within(item(1)).getByRole("button", { name: "Confirm item" })).toBeDisabled(); // Option D's possible new misconception is still open.
  });

  it("leaves options not matched when matching fails", async () => {
    await start(withLesson({ source: "uploaded", items: imported() }));
    override["/api/task-quiz/match"] = () => reply({ error: "Couldn't match — try again" }, 502);
    fireEvent.click(button("Match all items"));
    expect((await alert()).textContent).toContain("Couldn't match — try again");
    expect(within(item(1)).getAllByText("Not matched yet")).toHaveLength(3);
  });

  it("sets a suggested answer, and the No answer key pill goes", async () => {
    const { second } = await matched();
    expect(within(second).getByText("No answer key")).toBeInTheDocument();
    expect(within(second).getByText("AI suggests this is the correct answer")).toBeInTheDocument();
    expect(within(second).queryByText("Not matched yet")).toBeNull(); // The option it suggests isn't a wrong one.
    expect(within(second).getByRole("button", { name: "Confirm item" })).toBeDisabled();
    expect(within(second).getByText("Set the correct answer")).toBeInTheDocument();
    fireEvent.click(within(second).getByRole("button", { name: "Set as answer" }));
    await waitFor(() => expect(within(second).queryByText("No answer key")).toBeNull());
    expect(callsTo("/api/task-quiz/item").at(-1)?.body).toMatchObject({ itemId: "U2", action: "setAnswer", letter: "C" });
    expect(within(second).getByText("Correct").parentElement).toHaveTextContent("c2");
    expect(within(second).getByRole("button", { name: "Confirm item" })).toBeEnabled();
  });

  it("sets another option's dashed letter as the answer, and that leaves the suggested one to match", async () => {
    const { second } = await matched();
    fireEvent.click(within(second).getByRole("button", { name: "Set A as the correct answer" }));
    await waitFor(() => expect(within(second).queryByText("No answer key")).toBeNull());
    expect(callsTo("/api/task-quiz/item").at(-1)?.body).toMatchObject({ action: "setAnswer", letter: "A" });
    expect(within(second).getByText("Correct").parentElement).toHaveTextContent("a2");
    expect(within(second).queryByRole("button", { name: /as the correct answer/ })).toBeNull();
    expect(within(second).getByText("Not matched yet")).toBeInTheDocument();
    expect(within(second).getByRole("button", { name: "Confirm item" })).toBeDisabled();
  });

  it("changes a match with + Add / change, and adds to the ones already there", async () => {
    const { first } = await matched();
    fireEvent.click(within(first).getByRole("button", { name: "+ Add / change option B" }));
    const select = within(first).getByRole("combobox", { name: "Misconception for option B" });
    expect(within(select).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(["", MC2, "__none"]);
    fireEvent.change(select, { target: { value: MC2 } });
    await waitFor(() => expect(callsTo("/api/task-quiz/item").at(-1)?.body).toMatchObject({ action: "setMatch", letter: "B", ids: [MC1, MC2], noMisconception: false }));
    expect(within(first).queryByRole("combobox")).toBeNull();
    await waitFor(() => expect(within(first).queryByText("AI · High confidence. Reason B")).toBeNull());
  });

  it("changes \"No misconception\" with Change, and can pick \"No misconception\" for an unmatched option", async () => {
    const { first } = await matched();
    expect(within(first).getByText("AI · Medium confidence. Plausible distractor; no listed idea fits.")).toBeInTheDocument();
    fireEvent.click(within(first).getByRole("button", { name: "Change option C" }));
    fireEvent.change(within(first).getByRole("combobox", { name: "Misconception for option C" }), { target: { value: MC2 } });
    await waitFor(() => expect(callsTo("/api/task-quiz/item").at(-1)?.body).toMatchObject({ letter: "C", ids: [MC2], noMisconception: false }));
    await waitFor(() => expect(within(first).queryByRole("button", { name: "Change option C" })).toBeNull());
    fireEvent.click(within(first).getByRole("button", { name: "+ Add / change option D" }));
    fireEvent.change(within(first).getByRole("combobox", { name: "Misconception for option D" }), { target: { value: "__none" } });
    await waitFor(() => expect(callsTo("/api/task-quiz/item").at(-1)?.body).toMatchObject({ letter: "D", ids: [], noMisconception: true }));
    await within(first).findByRole("button", { name: "Change option D" });
  });

  it("closes the picker without a change when nothing is chosen", async () => {
    const { first } = await matched();
    fireEvent.click(within(first).getByRole("button", { name: "+ Add / change option B" }));
    const before = calls.length;
    fireEvent.blur(within(first).getByRole("combobox", { name: "Misconception for option B" }));
    expect(within(first).queryByRole("combobox")).toBeNull();
    expect(calls.length).toBe(before);
  });

  it("removes one chip with ×, leaving the other", async () => {
    const twoIdeas = importedItem("T1", "Two?", ["a", "b", "c", "d"], "A");
    await start(withLesson({ source: "uploaded", items: [{ ...twoIdeas, options: twoIdeas.options.map((option) => (option.letter === "B" ? { ...option, match: { state: "matched" as const, ids: [MC1, MC2], setBy: "teacher" as const, confidence: null, reason: null } } : option)) }] }));
    fireEvent.click(within(await findItem(1)).getByRole("button", { name: `Remove ${MC1} from option B` }));
    await waitFor(() => expect(callsTo("/api/task-quiz/item").at(-1)?.body).toMatchObject({ letter: "B", ids: [MC2], noMisconception: false }));
  });

  it("adds a possible new misconception to this task's list, marked Added by you", async () => {
    const { first } = await matched();
    const label = `Possible new misconception: ${MISCONCEPTION_TEXT[MC3]}`;
    expect(within(first).getByText(label)).toBeInTheDocument();
    expect(within(first).getByText("AI · Low confidence. Outside the lesson")).toBeInTheDocument();
    fireEvent.click(within(first).getByRole("button", { name: "Add to lesson list and use" }));
    await waitFor(() => expect(within(first).queryByText(label)).toBeNull());
    expect(callsTo("/api/task-quiz/item").at(-1)?.body).toMatchObject({ action: "addPossibleNew", letter: "D", id: MC3 });
    expect(within(screen.getByRole("region", { name: "Lesson details" })).getByText("Added by you").closest("li")).toHaveTextContent(MC3);
    expect(within(first).getByText(MC3)).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Confirm item" })).toBeEnabled();
  });

  it("dismisses a possible new misconception, which leaves the option to match", async () => {
    const { first } = await matched();
    fireEvent.click(within(first).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(within(first).queryByText(/Possible new misconception/)).toBeNull());
    expect(callsTo("/api/task-quiz/item").at(-1)?.body).toMatchObject({ action: "dismissPossibleNew", letter: "D", id: MC3 });
    expect(within(first).getByText("Not matched yet")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Confirm item" })).toBeDisabled();
    expect(screen.getByText("Misconceptions not matched yet")).toBeInTheDocument();
  });

  it("confirms an item only when the rules are met, and the pills follow to Ready", async () => {
    await start(withLesson({ source: "ai", items: aiItems(2) }));
    expect(screen.getByTestId("status").textContent).toBe("In progress|Needs review");
    expect(screen.getByText("2 of 2 items need confirmation")).toBeInTheDocument();
    expect(button("Publish task")).toBeDisabled();
    expect(screen.getByText("Quiz · 0 of 2 confirmed")).toBeInTheDocument();
    fireEvent.click(within(await findItem(1)).getByRole("button", { name: "Confirm item" }));
    await within(item(1)).findByText("Confirmed");
    expect(screen.getByText("1 of 2 items need confirmation")).toBeInTheDocument();
    expect(within(item(1)).queryByLabelText("AI suggestion")).toBeNull();
    expect(within(item(1)).queryByText(/^AI · /)).toBeNull();
    expect(button("Publish task")).toBeDisabled();
    fireEvent.click(within(item(2)).getByRole("button", { name: "Confirm item" }));
    await within(item(2)).findByText("Confirmed");
    expect(screen.queryByText(/items need confirmation/)).toBeNull();
    expect(screen.getByTestId("status").textContent).toBe("Ready to publish|Ready");
    expect(button("Publish task")).toBeEnabled();
    expect(screen.getByText("Quiz · 2 items confirmed")).toBeInTheDocument();
  });
});

describe("UC 4.4 flow D: replacing reviewed items", () => {
  const reviewed = async () => {
    await start(withLesson({ source: "ai", items: aiItems(2) }));
    fireEvent.click(within(await findItem(1)).getByRole("button", { name: "Confirm item" }));
    await within(item(1)).findByText("Confirmed");
  };
  const dialog = () => screen.findByRole("alertdialog");

  it("asks when switching to Provided, and keeps the items on no", async () => {
    await reviewed();
    fireEvent.click(source(/Provided/));
    expect((await dialog())).toHaveTextContent("Replace the 1 item you've reviewed?");
    fireEvent.click(button("Keep them"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(quiz.source).toBe("ai");
    expect(source(/Create with AI/)).toHaveAttribute("aria-pressed", "true");
  });

  it("replaces on yes, with a fresh copy", async () => {
    await reviewed();
    fireEvent.click(source(/Provided/));
    await dialog();
    fireEvent.click(button("Replace"));
    await waitFor(() => expect(quiz.source).toBe("provided"));
    expect(callsTo("/api/task-quiz/source").at(-1)?.body).toMatchObject({ source: "provided", confirmReplace: true });
    expect(await findItem(1)).toHaveTextContent("Lesson bank");
    expect(source(/Provided/)).toHaveAttribute("aria-pressed", "true");
  });

  it("asks when switching to Upload, keeps the items until new ones arrive, then sends the yes", async () => {
    await reviewed();
    fireEvent.click(source(/Upload or link/));
    expect(await dialog()).toHaveTextContent("Replace the 1 item you've reviewed?");
    fireEvent.click(button("Replace"));
    expect(await screen.findByRole("heading", { name: "Upload a file" })).toBeInTheDocument();
    expect(quiz.source).toBe("ai");
    expect(screen.getByText("Your current 2 items stay in place until the new ones are ready.")).toBeInTheDocument();
    chooseFile(uploadedFile());
    await waitFor(() => expect(quiz.source).toBe("uploaded"));
    expect(callsTo("/api/task-quiz/upload")[0].url).toContain("confirmReplace=1");
  });

  it("sends the yes with a link too", async () => {
    await reviewed();
    fireEvent.click(source(/Upload or link/));
    await dialog();
    fireEvent.click(button("Replace"));
    fireEvent.change(await screen.findByLabelText("Quiz link"), { target: { value: "https://forms.gle/x" } });
    fireEvent.click(button("Import"));
    await waitFor(() => expect(callsTo("/api/task-quiz/link")[0]?.body).toMatchObject({ confirmReplace: true }));
  });

  it("asks when a lesson change would replace them, and leaves the picker alone on no", async () => {
    await reviewed();
    fireEvent.change(screen.getByLabelText("Lesson"), { target: { value: "2" } });
    expect(await dialog()).toHaveTextContent("Replace the 1 item you've reviewed?");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText("Lesson")).toHaveValue("1");
    expect(events.picked).toEqual([]);
    fireEvent.change(screen.getByLabelText("Lesson"), { target: { value: "2" } });
    await dialog();
    fireEvent.click(button("Replace"));
    await waitFor(() => expect(events.picked).toEqual([2]));
    expect(callsTo("/api/task-quiz/lesson").at(-1)?.body).toMatchObject({ lessonNumber: 2, confirmReplace: true });
  });

  it("asks when the server says someone else reviewed items meanwhile, and resends on yes", async () => {
    await start(withLesson({ source: "provided" }));
    fireEvent.click(source(/Upload or link/));
    quiz = { ...quiz, items: quiz.items.map((entry) => ({ ...entry, reviewed: true })) };
    chooseFile(uploadedFile());
    expect(await dialog()).toHaveTextContent("Replace the 2 items you've reviewed?");
    fireEvent.click(button("Replace"));
    await waitFor(() => expect(quiz.source).toBe("uploaded"));
    expect(callsTo("/api/task-quiz/upload").map((call) => call.url.includes("confirmReplace=1"))).toEqual([false, true]);
  });
});

describe("UC 4.5: preview and publish", () => {
  it("previews what students see, with no keys or misconceptions, and closes with Escape", async () => {
    await start(withLesson());
    fireEvent.click(button("Preview as student"));
    const dialog = await screen.findByRole("dialog", { name: "Lesson 1: Get ready for the lesson" });
    expect(within(dialog).getByText("L1 question?")).toBeInTheDocument();
    expect(within(dialog).getByText("L1 B text")).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: "Visual reference for question 1" })).toBeInTheDocument();
    expect(within(dialog).getAllByText("How confident are you about your answer?")).toHaveLength(2);
    expect(dialog.textContent).not.toMatch(/Correct|MC\d\d|Secret reason|No misconception/u);
    expect(button("Close preview")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("doesn't offer a preview with no items", async () => {
    await start();
    expect(button("Preview as student")).toBeDisabled();
    expect(button("Publish task")).toBeDisabled();
    expect(screen.getByText("Pick a lesson first.")).toBeInTheDocument();
  });

  it("says when the preview fails", async () => {
    await start(withLesson());
    override["/api/task-quiz/preview"] = () => reply({ error: "Pick a lesson and add a quiz item to preview it." }, 404);
    fireEvent.click(button("Preview as student"));
    expect((await alert()).textContent).toContain("Pick a lesson and add a quiz item to preview it.");
  });

  it("publishes, then locks everything and says so", async () => {
    await start(withLesson());
    await findItem(1);
    fireEvent.click(button("Publish task"));
    expect((await toast()).textContent).toContain("Task published to 24 students");
    expect(events.published).toEqual([1]);
    expect(callsTo("/api/task-quiz/publish")[0].body).toMatchObject({ ...task, revision: quiz.revision - 1 });
    expect(screen.getByLabelText("Lesson")).toBeDisabled();
    expect(screen.getByText("Locked after publishing")).toBeInTheDocument();
    expect(screen.getByLabelText(/Anchoring phenomenon/)).toBeDisabled();
    for (const name of [/Provided/, /Upload or link/, /Create with AI/]) expect(source(name)).toBeDisabled();
    expect(within(item(1)).queryByRole("button")).toBeNull();
    expect(within(item(1)).getByText(MC1)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish task" })).toBeNull();
    expect(screen.getByText("Task published to Period 3.")).toBeInTheDocument();
    expect(screen.getByText("Waiting for students — 0 of 24 submitted.")).toBeInTheDocument();
    expect(button("Preview as student")).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Go to Step 2/ })).toBeNull();
    expect(screen.getByTestId("status").textContent).toContain("Published");
  });

  it("shows an error and locks nothing when publishing fails, then can try again", async () => {
    await start(withLesson());
    await findItem(1);
    override["/api/task-quiz/publish"] = () => reply({ error: "Couldn't publish — try again" }, 503);
    fireEvent.click(button("Publish task"));
    expect((await alert()).textContent).toContain("Couldn't publish — try again");
    expect(events.published).toEqual([]);
    expect(screen.getByLabelText("Lesson")).toBeEnabled();
    expect(button("Publish task")).toBeEnabled();
    override = {};
    fireEvent.click(button("Publish task"));
    expect((await toast()).textContent).toContain("Task published to 24 students");
  });

  it("reloads when a stale publish loses to someone's newer save", async () => {
    await start(withLesson());
    await findItem(1);
    override["/api/task-quiz/publish"] = () => reply({ error: "Someone else just changed this quiz. Reload to see the latest." }, 409);
    const before = callsTo("/api/task-quiz").length;
    fireEvent.click(button("Publish task"));
    expect((await alert()).textContent).toContain("Someone else just changed this quiz");
    await waitFor(() => expect(callsTo("/api/task-quiz").length).toBe(before + 1));
  });

  it("treats a publish someone else won as published", async () => {
    await start(withLesson());
    await findItem(1);
    override["/api/task-quiz/publish"] = () => { quiz = { ...quiz, status: "published", revision: quiz.revision + 1 }; return reply({ message: publishedMessage(24), alreadyPublished: true, publishedBar: bar, quiz: taskQuizView(quiz) }); };
    fireEvent.click(button("Publish task"));
    await screen.findByText("Locked after publishing");
    expect(events.published).toEqual([1]);
  });

  it("keeps the submitted count up to date, and offers Step 2 once a student has submitted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    quiz = { ...quiz, ...withLesson(), status: "published" };
    render(<Harness />);
    await screen.findByText("Waiting for students — 0 of 24 submitted.");
    bar = { ...publishedBarLines({ className: "Period 3", classSize: 24, submitted: 3 }), classSize: 24 };
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByText("3 of 24 students submitted.")).toBeInTheDocument();
    fireEvent.click(button(/Go to Step 2/));
    expect(events.step2).toBe(1);
  });

  it("clears a good message by itself, but keeps a failure until it's closed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await start(withLesson());
    fireEvent.click(source(/Upload or link/));
    chooseFile(uploadedFile());
    await screen.findByRole("status");
    await act(async () => { await vi.advanceTimersByTimeAsync(6_100); });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(button("Replace with another file or link"));
    chooseFile(uploadedFile(11 * 1024 * 1024));
    await screen.findByRole("alert");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Files up to 10 MB");
    fireEvent.click(button("Close message"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so when the server can't be reached", async () => {
    await start(withLesson());
    await findItem(1);
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(button("Publish task"));
    expect((await alert()).textContent).toContain("Couldn't reach the server — try again");
    expect(button("Publish task")).toBeEnabled();
  });
});
