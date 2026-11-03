// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ShareSlidesDialog from "@/app/components/ShareSlidesDialog";
import { deckFixture } from "../fixtures/slides";
import { sixStepDeck } from "../fixtures/analogy-six-step";

const mocks = vi.hoisted(() => ({ share: vi.fn() }));
vi.mock("@/lib/material-gallery-client", () => ({ shareSlideMaterial: mocks.share }));
const scope = { classId: "class-a", assignmentId: "task-a" };
const material = { id: "template-a", title: "Shared version", revision: 1, isOwner: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.share.mockResolvedValue(material);
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute("open"); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shares a teacher-reviewed independent copy without class context or changing the class draft", async () => {
  const deck = sixStepDeck(true);
  deck.classroomContext = "Private class notes and names";
  deck.focus = { misconceptions: ["a"], coreIdeas: [0] };
  deck.draft.slides[0].body = "Twenty-four students in our class saw this.";
  deck.draft.slides[0].teacherNotes = ["A class-specific note"];
  const original = structuredClone(deck);
  const onShared = vi.fn();
  render(<ShareSlidesDialog deck={deck} scope={scope} onClose={vi.fn()} onShared={onShared} />);
  const modal = screen.getByRole("dialog", { name: "Share with other teachers" });
  const share = within(modal).getByRole("button", { name: "Share to Gallery" }) as HTMLButtonElement;
  expect(share.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Gallery title"), { target: { value: "A reusable example" } });
  fireEvent.change(screen.getByLabelText("Shared slide 1 body"), { target: { value: "Observe the two objects." } });
  fireEvent.change(screen.getByLabelText("Shared slide 1 notes"), { target: { value: "Ask what students notice." } });
  fireEvent.change(screen.getByLabelText("Shared teaching plan familiarExperience"), { target: { value: "A familiar playground experience" } });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(share.disabled).toBe(false);
  fireEvent.click(share);
  await waitFor(() => expect(onShared).toHaveBeenCalledWith(material));
  expect(mocks.share).toHaveBeenCalledOnce();
  const [actualScope, source, metadata, signal] = mocks.share.mock.calls[0];
  expect(actualScope).toEqual(scope);
  expect(source.classroomContext).toBeUndefined();
  expect(source.checks).toBeUndefined();
  expect(source.promptProvenance).toBeUndefined();
  expect(source.draft.title).toBe("A reusable example");
  expect(source.draft.slides[0].body).toBe("Observe the two objects.");
  expect(source.draft.slides[0].teacherNotes).toEqual(["Ask what students notice."]);
  expect(source.draft.analogyPlan.familiarExperience).toBe("A familiar playground experience");
  expect(metadata).toMatchObject({ title: "A reusable example", sharingConfirmed: true, focus: { misconceptions: [], coreIdeas: [0] } });
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(deck).toEqual(original);
});

it("requires reconfirmation after any shared text is edited", () => {
  render(<ShareSlidesDialog deck={deckFixture("cognitive conflict")} scope={scope} onClose={vi.fn()} onShared={vi.fn()} />);
  const share = screen.getByRole("button", { name: "Share to Gallery" }) as HTMLButtonElement;
  fireEvent.click(screen.getByRole("checkbox"));
  expect(share.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("Shared slide 1 title"), { target: { value: "A revised shared title" } });
  expect(share.disabled).toBe(true);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(mocks.share).not.toHaveBeenCalled();
});

it("retains edited sharing text when upload fails and allows an explicit retry", async () => {
  mocks.share.mockRejectedValueOnce(new Error("The material library is temporarily unavailable."));
  const onShared = vi.fn();
  render(<ShareSlidesDialog deck={deckFixture("cognitive conflict")} scope={scope} onClose={vi.fn()} onShared={onShared} />);
  fireEvent.change(screen.getByLabelText("Gallery title"), { target: { value: "Retained title" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Share to Gallery" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The material library is temporarily unavailable.");
  expect((screen.getByLabelText("Gallery title") as HTMLInputElement).value).toBe("Retained title");
  expect(onShared).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Share to Gallery" }));
  await waitFor(() => expect(onShared).toHaveBeenCalledOnce());
  expect(mocks.share).toHaveBeenCalledTimes(2);
});
