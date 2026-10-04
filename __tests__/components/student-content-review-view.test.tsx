// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentContentReviewView from "@/app/components/StudentContentReviewView";
import type { UserContext } from "@/lib/auth";

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
  const label = await screen.findByText("Material rating");
  return label.parentElement as HTMLElement;
};

const ratingButtonsFor = (card: HTMLElement, title: string) => {
  const row = within(card).getByText(title).parentElement as HTMLElement;
  return within(row).getAllByRole("button");
};

it("shows the rating card below the questions, locked until questions are submitted", async () => {
  render(<StudentContentReviewView user={student} ratingUnlocked={false} />);
  const card = await ratingCard();

  expect(screen.getByText("Your questions").compareDocumentPosition(card)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(within(card).getByText(/Submit your questions first/)).toBeTruthy();
  for (const button of ratingButtonsFor(card, "Material A")) expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(within(card).queryByRole("button", { name: "Submit" })).toBeNull();
});

it("only saves ratings on Submit, once every material is rated, then locks them", async () => {
  const onRatingProgress = vi.fn();
  render(<StudentContentReviewView user={student} ratingUnlocked onRatingProgress={onRatingProgress} />);
  const card = await ratingCard();
  const submit = within(card).getByRole("button", { name: "Submit" }) as HTMLButtonElement;

  fireEvent.click(ratingButtonsFor(card, "Material A")[3]);
  expect(submit.disabled).toBe(true);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

  fireEvent.click(ratingButtonsFor(card, "Material B")[1]);
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);

  await within(card).findByText(/Submitted - thanks for rating/);
  expect(savedRatings).toEqual(
    expect.arrayContaining([
      { content_item_id: "item-a", rating: 4 },
      { content_item_id: "item-b", rating: 2 },
    ]),
  );
  for (const button of ratingButtonsFor(card, "Material A")) expect((button as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(onRatingProgress).toHaveBeenLastCalledWith({ kind: "completed" }));
});

it("shows previously saved ratings as submitted and read-only", async () => {
  savedRatings = [
    { content_item_id: "item-a", rating: 5 },
    { content_item_id: "item-b", rating: 3 },
  ];
  render(<StudentContentReviewView user={student} ratingUnlocked />);
  const card = await ratingCard();

  await within(card).findByText(/Submitted - thanks for rating/);
  expect(within(card).queryByRole("button", { name: "Submit" })).toBeNull();
  for (const button of ratingButtonsFor(card, "Material B")) expect((button as HTMLButtonElement).disabled).toBe(true);
});
