// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentContentReviewView from "@/app/components/StudentContentReviewView";
import { conflictActivity } from "../fixtures/material-activities";
import type { UserContext } from "@/lib/auth";

vi.mock("@/app/components/PublishedSlidesReader", () => ({ default: ({ classId, assignmentId, publicationId, audience, onQuestion }: {
  classId: string; assignmentId: string; publicationId: string; audience: string; onQuestion?: () => void;
}) => <section aria-label="Published slides" data-class={classId} data-assignment={assignmentId} data-publication={publicationId} data-audience={audience}>
  <button onClick={onQuestion}>Write my slide question</button>
</section> }));

const student: UserContext = {
  geniusId: "student", userId: "student", name: "Test student",
  email: null, role: "student", classId: "class", assignmentId: "assignment",
};

const publishedItems = [
  { content_item_id: "item-a", content_json: JSON.stringify({ title: "Material A", body: "Body A" }) },
  { content_item_id: "item-b", content_json: JSON.stringify({ title: "Material B", body: "Body B" }) },
];

let savedRatings: { content_item_id: string; rating: number }[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  savedRatings = [];
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.startsWith("/api/content-publish")) return { ok: true, json: async () => ({ items: publishedItems }) };
    if (input.startsWith("/api/content-rating") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      savedRatings.push({ content_item_id: body.contentItemId, rating: body.rating });
      return { ok: true, json: async () => ({}) };
    }
    if (input.startsWith("/api/content-rating")) return { ok: true, json: async () => ({ ratings: savedRatings }) };
    if (input.startsWith("/api/review-questions")) return { ok: true, json: async () => ({ reviewQuestions: [] }) };
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ratingCard = async () => {
  const label = await screen.findByText("Rate the material");
  return label.parentElement as HTMLElement;
};

const ratingButtonsFor = (card: HTMLElement, title: string) => {
  const row = within(card).getByText(title).parentElement as HTMLElement;
  return within(row).getAllByRole("radio");
};

it("shows the rating card below the questions, locked until questions are submitted", async () => {
  render(<StudentContentReviewView user={student} ratingUnlocked={false} />);
  const card = await ratingCard();

  expect(screen.getByText("Your questions").compareDocumentPosition(card)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(within(card).getByText(/Submit your questions first/)).toBeTruthy();
  for (const button of ratingButtonsFor(card, "Material A")) expect((button as HTMLButtonElement).disabled).toBe(true);
  expect((within(card).getByRole("button", { name: "Submit rating" }) as HTMLButtonElement).disabled).toBe(true);
});

it("only saves ratings on Submit, once every material is rated, then locks them", async () => {
  const onRatingProgress = vi.fn();
  render(<StudentContentReviewView user={student} ratingUnlocked onRatingProgress={onRatingProgress} />);
  const card = await ratingCard();
  const submit = within(card).getByRole("button", { name: "Submit rating" }) as HTMLButtonElement;

  fireEvent.click(ratingButtonsFor(card, "Material A")[3]);
  expect(submit.disabled).toBe(true);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

  fireEvent.click(ratingButtonsFor(card, "Material B")[1]);
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);

  await within(card).findAllByText(/Thanks — you rated it/);
  expect(savedRatings).toEqual(
    expect.arrayContaining([
      { content_item_id: "item-a", rating: 4 },
      { content_item_id: "item-b", rating: 2 },
    ]),
  );
  expect(within(card).queryAllByRole("radio")).toHaveLength(0);
  expect(within(card).getByText("Thanks — you rated it 4 / 5.")).toBeTruthy();
  expect(within(card).getByText("Thanks — you rated it 2 / 5.")).toBeTruthy();
  await waitFor(() => expect(onRatingProgress).toHaveBeenLastCalledWith({ kind: "completed" }));
});

it("shows previously saved ratings as submitted and read-only", async () => {
  savedRatings = [
    { content_item_id: "item-a", rating: 5 },
    { content_item_id: "item-b", rating: 3 },
  ];
  render(<StudentContentReviewView user={student} ratingUnlocked />);
  const card = await ratingCard();

  await within(card).findAllByText(/Thanks — you rated it/);
  expect(within(card).queryByRole("button", { name: "Submit rating" })).toBeNull();
  expect(within(card).queryAllByRole("radio")).toHaveLength(0);
  expect(within(card).getByText("Thanks — you rated it 5 / 5.")).toBeTruthy();
  expect(within(card).getByText("Thanks — you rated it 3 / 5.")).toBeTruthy();
});


it("keeps prediction before evidence while retaining the platform question-submission flow", async () => {
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input.startsWith("/api/content-publish")) return { ok: true, json: async () => ({ items: [{
      content_item_id: "inquiry", content_json: JSON.stringify({ title: "A bounce", body: "Do not flatten the full sequence into this body.", strategy: "cognitive conflict", activity: conflictActivity }),
      media: { image: "https://example.test/result.png" },
    }] }) };
    if (input.startsWith("/api/review-questions") && init?.method === "POST") return { ok: true, json: async () => ({ success: true }) };
    if (input.startsWith("/api/review-questions")) return { ok: true, json: async () => ({ reviewQuestions: [] }) };
    return { ok: true, json: async () => ({}) };
  });
  render(<StudentContentReviewView user={student} />);
  await screen.findByRole("region", { name: "A quick bounce" });
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.queryByText("Do not flatten the full sequence into this body.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: "It stays round." } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("img").getAttribute("src")).toBe("https://example.test/result.png");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.queryByLabelText("Your scientific question")).toBeNull();
  expect(screen.getByText("Record your scientific question in Your questions below.")).toBeTruthy();
  const question = "Why does the ball return to its original shape?";
  fireEvent.change(screen.getByPlaceholderText("What are you wondering about?"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: "Submit questions" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => input === "/api/review-questions" && init?.method === "POST" && String(init.body).includes(question))).toBe(true));
});

it("restores video predictions only for the same student, class, task and published material without sending them to the server", async () => {
  fetchMock.mockImplementation(async (input: string) => {
    if (input.startsWith("/api/content-publish")) return { ok: true, json: async () => ({ items: [{
      content_item_id: "video-inquiry", content_json: JSON.stringify({ title: "A video inquiry", body: "A bounce", strategy: "cognitive conflict", activity: conflictActivity }),
      media: { video: "https://example.test/result.mp4" },
    }] }) };
    return { ok: true, json: async () => ({}) };
  });
  const view = render(<StudentContentReviewView user={student} />);
  await screen.findByRole("region", { name: "A quick bounce" });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: "My initial prediction." } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const storageKey = `engage:material-prediction:${JSON.stringify([student.geniusId, student.classId, student.assignmentId, "video-inquiry"])}`;
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual({ draft: "My initial prediction.", recorded: "My initial prediction." });
  view.unmount();
  const reopened = render(<StudentContentReviewView user={student} />);
  await screen.findByRole("region", { name: "A quick bounce" });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByLabelText("Your prediction")).toHaveProperty("value", "My initial prediction.");
  expect(screen.getByLabelText("Your prediction")).toHaveProperty("readOnly", true);
  reopened.rerender(<StudentContentReviewView user={{ ...student, geniusId: "another-student", userId: "another-student" }} />);
  await screen.findByRole("region", { name: "A quick bounce" });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByLabelText("Your prediction")).toHaveProperty("value", "");
  expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("reads slide publications in the student reader and submits through the existing question form", async () => {
  const publicationId = "4e96360b-17a4-4a54-84da-df0c5d2ef012";
  const onProgress = vi.fn();
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input.startsWith("/api/content-publish")) return { ok: true, json: async () => ({ items: [{
      content_item_id: "slides-deck", content_json: JSON.stringify({ type: "Slides", title: "A slide inquiry", body: "Legacy body must stay hidden.",
        strategy: "cognitive conflict", slides: { publicationId, lessonNumber: 8, slideCount: 5 }, activity: conflictActivity }),
      media: { image: "https://example.test/early-evidence.png" },
    }] }) };
    if (input.startsWith("/api/review-questions") && init?.method === "POST") return { ok: true, json: async () => ({ success: true }) };
    return { ok: true, json: async () => ({}) };
  });
  render(<StudentContentReviewView user={student} onProgress={onProgress} ratingUnlocked={false} />);
  const reader = await screen.findByRole("region", { name: "Published slides" });
  expect(reader.dataset).toMatchObject({ class: student.classId, assignment: student.assignmentId, publication: publicationId, audience: "student" });
  expect(screen.queryByText("Legacy body must stay hidden.")).toBeNull();
  expect(screen.queryByRole("region", { name: "Inquiry activity" })).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  await waitFor(() => expect(onProgress).toHaveBeenLastCalledWith({ kind: "active" }));
  fireEvent.click(within(reader).getByRole("button", { name: "Write my slide question" }));
  const question = screen.getByPlaceholderText("What are you wondering about?");
  expect(document.activeElement).toBe(question);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  fireEvent.change(question, { target: { value: "How does winding change where the toy stops?" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit questions" }));
  await waitFor(() => expect(onProgress).toHaveBeenLastCalledWith({ kind: "completed" }));
  const submission = fetchMock.mock.calls.find(([input, init]) => input === "/api/review-questions" && init?.method === "POST");
  expect(JSON.parse(String(submission?.[1]?.body))).toEqual({ classId: student.classId, assignmentId: student.assignmentId,
    studentId: student.userId, questions: ["How does winding change where the toy stops?"] });
  const rating = await ratingCard();
  expect(within(rating).getByText(/Submit your questions first/)).toBeTruthy();
  fireEvent.click(within(reader).getByRole("button", { name: "Write my slide question" }));
  expect(document.activeElement).toBe(screen.getByText("Your questions").parentElement);
});

it("refreshes submitted questions and ratings from another tab without discarding unsaved selections", async () => {
  let questions: string[] = [];
  fetchMock.mockImplementation(async (input: string) => {
    if (input.startsWith("/api/content-publish")) return { ok: true, json: async () => ({ items: publishedItems }) };
    if (input.startsWith("/api/content-rating")) return { ok: true, json: async () => ({ ratings: savedRatings }) };
    if (input.startsWith("/api/review-questions")) return { ok: true, json: async () => ({ reviewQuestions: [{ questions }] }) };
    return { ok: true, json: async () => ({}) };
  });
  render(<StudentContentReviewView user={student} ratingUnlocked />);
  const card = await ratingCard();
  fireEvent.click(ratingButtonsFor(card, "Material B")[3]);
  questions = ["How could we test friction?"];
  savedRatings = [{ content_item_id: "item-a", rating: 5 }];
  fireEvent.focus(window);
  await screen.findByText(questions[0]);
  await within(card).findByText("Thanks — you rated it 5 / 5.");
  expect(ratingButtonsFor(card, "Material B")[3].getAttribute("aria-checked")).toBe("true");
  expect((within(card).getByRole("button", { name: "Submit rating" }) as HTMLButtonElement).disabled).toBe(false);
});

it("keeps successfully submitted ratings locked when an earlier history request returns late", async () => {
  let releaseHistory!: (value: unknown) => void;
  let ratingReads = 0;
  const original = fetchMock.getMockImplementation() as (input: string, init?: RequestInit) => Promise<unknown>;
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input.startsWith("/api/content-rating") && !init?.method && ++ratingReads === 2) {
      return { ok: true, json: () => new Promise(resolve => { releaseHistory = resolve; }) };
    }
    return original(input, init);
  });
  render(<StudentContentReviewView user={student} ratingUnlocked />);
  const card = await ratingCard();
  fireEvent.focus(window);
  await waitFor(() => expect(releaseHistory).toBeTypeOf("function"));
  fireEvent.click(ratingButtonsFor(card, "Material A")[3]);
  fireEvent.click(ratingButtonsFor(card, "Material B")[3]);
  fireEvent.click(within(card).getByRole("button", { name: "Submit rating" }));
  await within(card).findAllByText(/Thanks — you rated it/);
  releaseHistory({ ratings: [] });
  await waitFor(() => expect(within(card).queryByRole("button", { name: "Submit rating" })).toBeNull());
  expect(within(card).queryAllByRole("radio")).toHaveLength(0);
});

it("includes the verified assignment credential on student reads and feedback writes", async () => {
  const { setVerifiedClientAuth, clearVerifiedClientAuth } = await import("@/lib/client-auth");
  setVerifiedClientAuth("verified-test-token", student);
  try {
    render(<StudentContentReviewView user={student} ratingUnlocked />);
    const card = await ratingCard();
    fireEvent.change(screen.getByPlaceholderText("What are you wondering about?"), { target: { value: "How can we test this?" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit questions" }));
    fireEvent.click(ratingButtonsFor(card, "Material A")[3]);
    fireEvent.click(ratingButtonsFor(card, "Material B")[3]);
    fireEvent.click(within(card).getByRole("button", { name: "Submit rating" }));
    await within(card).findAllByText(/Thanks — you rated it/);
    for (const [, init] of fetchMock.mock.calls) expect(new Headers(init?.headers).get("authorization")).toBe("Bearer verified-test-token");
  } finally { clearVerifiedClientAuth(); }
});

it("validates empty questions and submits only the nonempty questions, then keeps the submitted list", async () => {
  render(<StudentContentReviewView user={student} />);
  await ratingCard();
  fireEvent.click(screen.getByRole("button", { name: "Submit questions" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Write at least one question before submitting.");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), { target: { value: "  How does the ball bend?  " } });
  fireEvent.click(screen.getByRole("button", { name: "Add another question" }));
  fireEvent.click(screen.getByRole("button", { name: "Add another question" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Question 3" }), { target: { value: "What changes its motion?" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit questions" }));
  await screen.findByText("How does the ball bend?");
  expect(screen.getByText("What changes its motion?")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  const request = fetchMock.mock.calls.find(([url, init]) => url === "/api/review-questions" && init?.method === "POST");
  expect(JSON.parse(String(request?.[1]?.body)).questions).toEqual(["How does the ball bend?", "What changes its motion?"]);
});

it("lets keyboard users choose a rating without saving before explicit submission", async () => {
  render(<StudentContentReviewView user={student} ratingUnlocked />);
  const card = await ratingCard();
  const choices = ratingButtonsFor(card, "Material A");
  choices[0].focus();
  fireEvent.keyDown(choices[0], { key: "ArrowRight" });
  expect(document.activeElement).toBe(choices[1]);
  expect(choices[1].getAttribute("aria-checked")).toBe("true");
  expect(choices[1].getAttribute("tabindex")).toBe("0");
  fireEvent.keyDown(choices[1], { key: "End" });
  expect(document.activeElement).toBe(choices[4]);
  expect(choices[4].getAttribute("aria-checked")).toBe("true");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("retries only failed ratings and reports completion only after all materials are saved", async () => {
  const onRatingProgress = vi.fn();
  const original = fetchMock.getMockImplementation() as (input: string, init?: RequestInit) => Promise<unknown>;
  let failB = true;
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input === "/api/content-rating" && init?.method === "POST" && JSON.parse(String(init.body)).contentItemId === "item-b" && failB) {
      return { ok: false, json: async () => ({}) };
    }
    return original(input, init);
  });
  render(<StudentContentReviewView user={student} ratingUnlocked onRatingProgress={onRatingProgress} />);
  const card = await ratingCard();
  fireEvent.click(ratingButtonsFor(card, "Material A")[4]);
  fireEvent.click(ratingButtonsFor(card, "Material B")[2]);
  fireEvent.click(within(card).getByRole("button", { name: "Submit rating" }));
  await within(card).findByRole("alert");
  expect(within(card).getByText("Thanks — you rated it 5 / 5.")).toBeTruthy();
  expect(onRatingProgress).not.toHaveBeenCalledWith({ kind: "completed" });
  expect(ratingButtonsFor(card, "Material B")[2].getAttribute("aria-checked")).toBe("true");
  failB = false;
  fireEvent.click(within(card).getByRole("button", { name: "Submit rating" }));
  await within(card).findByText("Thanks — you rated it 3 / 5.");
  await waitFor(() => expect(onRatingProgress).toHaveBeenLastCalledWith({ kind: "completed" }));
  const writes = fetchMock.mock.calls.filter(([url, init]) => url === "/api/content-rating" && init?.method === "POST");
  expect(writes.map(([, init]) => JSON.parse(String(init?.body)).contentItemId)).toEqual(["item-a", "item-b", "item-b"]);
});

it("offers retry when materials cannot load, and shows the waiting state for an empty task", async () => {
  const original = fetchMock.getMockImplementation() as (input: string, init?: RequestInit) => Promise<unknown>;
  let failing = true;
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input.startsWith("/api/content-publish")) return { ok: !failing, json: async () => ({ items: [] }) };
    return original(input, init);
  });
  render(<StudentContentReviewView user={student} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Waiting for your teacher");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Submit questions" })).toBeNull();
});

it("retains the reader and unfinished question when a background refresh fails", async () => {
  const original = fetchMock.getMockImplementation() as (input: string, init?: RequestInit) => Promise<unknown>;
  let failing = false;
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    if (failing && input.startsWith("/api/content-publish")) return { ok: false, json: async () => ({}) };
    return original(input, init);
  });
  render(<StudentContentReviewView user={student} ratingUnlocked />);
  const card = await ratingCard();
  fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), { target: { value: "My unfinished question" } });
  fireEvent.click(ratingButtonsFor(card, "Material A")[3]);
  failing = true;
  fireEvent.focus(window);
  await screen.findByText(/Materials could not refresh/);
  expect(screen.getByText("Body A")).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "Question 1" }) as HTMLTextAreaElement).value).toBe("My unfinished question");
  expect(ratingButtonsFor(card, "Material A")[3].getAttribute("aria-checked")).toBe("true");
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect((screen.getByRole("textbox", { name: "Question 1" }) as HTMLTextAreaElement).value).toBe("My unfinished question");
});
