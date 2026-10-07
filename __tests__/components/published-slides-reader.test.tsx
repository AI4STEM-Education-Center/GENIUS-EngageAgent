// @vitest-environment jsdom
import { clearVerifiedClientAuth, setVerifiedClientAuth } from "@/lib/client-auth";
import type { UserContext as EmbeddedUserContext } from "@/lib/auth";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PublishedSlidesReader from "@/app/components/PublishedSlidesReader";
import SlidePreview from "@/app/components/SlidePreview";
import { slideElements } from "@/lib/slides/layout";
import type { SlideDeck } from "@/lib/slides/model";
import type { PublishedSlideResponse } from "@/lib/slides/publication";
import { deckFixture } from "../fixtures/slides";
import { sixStepDeck } from "../fixtures/analogy-six-step";

const publicationId = "9b3951fe-578f-4df2-a20b-dd96b80ee70b";
const props = { classId: "ea-class-a", assignmentId: "ea-task-a", publicationId, audience: "student" as const };
const fetchMock = vi.fn();
const reply = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
function response(deck = deckFixture("cognitive conflict"), id = publicationId, suffix = "original"): PublishedSlideResponse {
  return { publicationId: id, manifest: { version: 1, title: deck.draft.title, lessonNumber: deck.lessonNumber, strategy: deck.strategy,
    pages: deck.draft.slides.map((slide, index) => ({ stage: slide.stage, title: slide.title, elements: slideElements(deck, index).map(element => {
      if (element.kind === "text") return element;
      return { id: element.id, kind: element.kind, frame: element.frame, fit: element.fit, alt: element.alt, assetId: element.id.replace(/^image-/u, "") };
    }) })) }, assets: Object.fromEntries(deck.draft.visuals.map(visual => [visual.id, { url: `https://files.example.test/${visual.id}.jpg?token=${suffix}`, width: 1536, height: 1024 }])) };
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
const textView = () => within(screen.getByRole("region", { name: "Slide text" }));
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(reply(response()));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const context = { font: "", measureText: (text: string) => ({ width: text.length * Number(context.font.match(/(\d+)px/u)?.[1] ?? 16) * .5 }) };
    return context as never;
  });
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute("open"); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["student", "teacher"] as const)("shows only the slide canvas while retaining an accessible transcript for %s readers", async audience => {
  const deck = deckFixture("experience bridging");
  deck.draft.slides[0].teacherNotes = ["PRIVATE TEACHER GUIDANCE"];
  fetchMock.mockResolvedValue(reply(response(deck)));
  const { container } = render(<PublishedSlidesReader {...props} audience={audience} />);
  await screen.findByText("Slide 1 of 5");
  const transcript = screen.getByRole("region", { name: "Slide text" });
  expect(transcript.classList.contains("sr-only")).toBe(true);
  expect(transcript.hasAttribute("aria-hidden")).toBe(false);
  expect(within(transcript).getByText(deck.draft.slides[0].body)).toBeTruthy();
  expect(within(transcript).getByText(deck.draft.visuals[0].alt)).toBeTruthy();
  expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelectorAll("image")).toHaveLength(1);
  expect(container.textContent).not.toContain("PRIVATE TEACHER GUIDANCE");
  fireEvent.click(screen.getByRole("button", { name: "Enlarge slides" }));
  expect(screen.getAllByRole("region", { name: "Slide text" })).toHaveLength(1);
  expect(within(screen.getByRole("dialog")).getByRole("region", { name: "Slide text" }).classList.contains("sr-only")).toBe(true);
});

it("requires a typed prediction before rendering any future evidence and compares the learner's recorded prediction", async () => {
  const onQuestion = vi.fn();
  const { container } = render(<PublishedSlidesReader {...props} onQuestion={onQuestion} />);
  await screen.findByText("Slide 1 of 5");
  expect(container.querySelector("image")).toBeNull();
  expect(container.textContent).not.toContain("During and after contact");
  expect(screen.queryByRole("combobox")).toBeNull();
  next();
  expect((screen.getByRole("button", { name: "Next slide" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: "   ...   " } });
  expect((screen.getByRole("button", { name: "Next slide" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: "The ball stays round." } });
  next();
  expect(container.querySelector("image")?.getAttribute("href")).toContain("evidence.jpg");
  expect(textView().getByText("During and after contact")).toBeTruthy();
  next();
  expect(within(screen.getByRole("region", { name: "Your recorded prediction" })).getByText("The ball stays round.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
  expect((screen.getByLabelText("Your prediction") as HTMLTextAreaElement).readOnly).toBe(true);
  next(); next(); next();
  fireEvent.click(screen.getByRole("button", { name: "Write your scientific question" }));
  expect(onQuestion).toHaveBeenCalledOnce();
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("preserves stage order for six-step analogy including a boundary page and four-page experience bridging", async () => {
  for (const deck of [sixStepDeck(true), (() => { const value = deckFixture("experience bridging"); value.draft.slides.splice(3, 1); return value; })()]) {
    fetchMock.mockResolvedValue(reply(response(deck)));
    const view = render(<PublishedSlidesReader {...props} />);
    await screen.findByText(`Slide 1 of ${deck.draft.slides.length}`);
    for (let i = 0; i < deck.draft.slides.length; i++) {
      expect(textView().getByText(deck.draft.slides[i].title)).toBeTruthy();
      for (const future of deck.draft.slides.slice(i + 1)) expect(view.container.textContent).not.toContain(future.title);
      if (deck.strategy === "analogy" && i < 2) expect(view.container.querySelector('image[href*="analogue.jpg"]')).toBeNull();
      if (i < deck.draft.slides.length - 1) next();
    }
    expect((screen.getByRole("button", { name: "Next slide" }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
  }
});

it("lets a teacher jump to any slide and keeps enlarged reading on the current page", async () => {
  const { container } = render(<PublishedSlidesReader {...props} audience="teacher" />);
  await screen.findByText("Slide 1 of 5");
  fireEvent.change(screen.getByRole("combobox", { name: "Choose slide" }), { target: { value: "3" } });
  expect(textView().getByText("Compare with your prediction")).toBeTruthy();
  expect(screen.queryByLabelText("Your prediction")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Enlarge slides" }));
  expect(screen.getByRole("dialog", { name: "Enlarged slides" })).toBeTruthy();
  expect(container.querySelectorAll("image")).toHaveLength(1);
  next();
  expect(textView().getByText("A question to investigate")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close presentation" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Slide 5 of 5")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Enlarge slides" }));
  fireEvent.click(screen.getByRole("button", { name: "Enlarge slides" }));
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Enlarge slides" }));
  expect(screen.getByText("Slide 5 of 5")).toBeTruthy();
});

it("closes and unmounts an enlarged question page before focusing the existing question form", async () => {
  fetchMock.mockResolvedValue(reply(response(deckFixture("experience bridging"))));
  const onQuestion = vi.fn(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
    screen.getByLabelText("Existing question form").focus();
  });
  render(<><PublishedSlidesReader {...props} onQuestion={onQuestion} /><textarea aria-label="Existing question form" /></>);
  await screen.findByText("Slide 1 of 5");
  next(); next(); next(); next();
  fireEvent.click(screen.getByRole("button", { name: "Enlarge slides" }));
  fireEvent.click(screen.getByRole("button", { name: "Write your scientific question" }));
  expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce();
  expect(onQuestion).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(screen.getByLabelText("Existing question form"));
});

it("refreshes signed URLs after eight minutes without losing the page or committed prediction", async () => {
  vi.useFakeTimers();
  const view = render(<PublishedSlidesReader {...props} />);
  await act(async () => {});
  next(); fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: "It stays round." } }); next(); next();
  fetchMock.mockResolvedValue(reply(response(undefined, publicationId, "refreshed")));
  await act(async () => { await vi.advanceTimersByTimeAsync(8 * 60 * 1000); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Slide 4 of 5")).toBeTruthy();
  expect(screen.getByText("It stays round.")).toBeTruthy();
  expect(view.container.querySelector("image")?.getAttribute("href")).toContain("refreshed");
  view.rerender(<PublishedSlidesReader {...props} onQuestion={() => {}} />);
  expect(screen.getByText("Slide 4 of 5")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("renews a failed image once, bounds automatic retries and retains text when a refresh fails", async () => {
  const view = render(<PublishedSlidesReader {...props} audience="teacher" />);
  await screen.findByText("Slide 1 of 5");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
  fetchMock.mockResolvedValueOnce(reply({}, 503));
  fireEvent.error(view.container.querySelector("image")!);
  await screen.findByRole("alert");
  expect(textView().getByText("During and after contact")).toBeTruthy();
  expect(screen.getByText("Slide 3 of 5")).toBeTruthy();
  fireEvent.error(view.container.querySelector("image")!);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Retry slides" }));
  await act(async () => {});
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("offers retry for authorization or malformed payload errors without displaying unverified content", async () => {
  fetchMock.mockResolvedValueOnce(reply({}, 403)).mockResolvedValueOnce(reply({ ...response(), publicationId: "another-publication" }));
  render(<PublishedSlidesReader {...props} />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Sign in to this class to read these slides.");
  fireEvent.click(screen.getByRole("button", { name: "Retry slides" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The published slides could not be read. Please retry.");
  expect(screen.queryByRole("region", { name: "Slide text" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry slides" }));
  await screen.findByText("Slide 1 of 5");
});

it("aborts an old workspace request, ignores its late result and resets a different publication", async () => {
  let finish: (value: unknown) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<PublishedSlidesReader {...props} />);
  const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  const otherId = "556bfe5c-9d92-4d35-b84e-c651c569dcb1";
  fetchMock.mockResolvedValue(reply(response(deckFixture("experience bridging"), otherId)));
  view.rerender(<PublishedSlidesReader {...props} assignmentId="ea-task-b" publicationId={otherId} />);
  await screen.findByText("Slide 1 of 5");
  next();
  expect(oldSignal.aborted).toBe(true);
  await act(async () => { finish(reply(response())); });
  expect(textView().getByText("Look closely at the contact")).toBeTruthy();
  expect(screen.getByText("Slide 2 of 5")).toBeTruthy();
  view.rerender(<PublishedSlidesReader {...props} />);
  fetchMock.mockResolvedValue(reply(response()));
  view.unmount();
  expect((fetchMock.mock.calls.at(-1)![1].signal as AbortSignal).aborted).toBe(true);
});

it("keeps the existing teacher preview's SVG geometry and private notes outside the canvas", () => {
  const deck: SlideDeck = sixStepDeck();
  deck.draft.slides[0].teacherNotes = ["PRIVATE TEACHER PLAN"];
  const { container } = render(<SlidePreview deck={deck} index={0} />);
  expect(screen.getByRole("img", { name: `Slide 1: ${deck.draft.slides[0].title}` }).getAttribute("viewBox")).toBe("0 0 1280 720");
  const image = container.querySelector("image")!;
  const planned = slideElements(deck, 0).find(element => element.kind === "image")!;
  expect(image.getAttribute("x")).toBe(String(planned.frame.left));
  expect(image.getAttribute("height")).toBe(String(planned.frame.height));
  expect(container.textContent).not.toContain("PRIVATE TEACHER PLAN");
});

afterEach(clearVerifiedClientAuth);

it("reads a GENIUS task with its verified bearer without exposing it in the slide media", async () => {
  const host = { ...props, classId: "host-class", assignmentId: "host-task" };
  setVerifiedClientAuth("reader-token", host as unknown as EmbeddedUserContext);
  const view = render(<PublishedSlidesReader {...host} />);
  await screen.findByText("Slide 1 of 5");
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer reader-token");
  expect(fetchMock.mock.calls[0][0]).not.toContain("reader-token");
  expect(view.container.innerHTML).not.toContain("reader-token");
  view.rerender(<PublishedSlidesReader {...host} assignmentId="other-task" />);
  await screen.findByText("Slide 1 of 5");
  expect(fetchMock.mock.calls.at(-1)![1].headers).not.toHaveProperty("Authorization");
});

it.each([false, true])("directs an expired verified GENIUS reader to reopen its task (existing slides: %s)", async alreadyLoaded => {
  const host = { ...props, classId: "host-class", assignmentId: "host-task" };
  setVerifiedClientAuth("expired-reader-token", host as unknown as EmbeddedUserContext);
  if (alreadyLoaded) fetchMock.mockResolvedValueOnce(reply(response(deckFixture("experience bridging"))));
  fetchMock.mockResolvedValue(reply({}, 401));
  const view = render(<PublishedSlidesReader {...host} />);
  if (alreadyLoaded) {
    await screen.findByText("Slide 1 of 5");
    fireEvent.error(view.container.querySelector("image")!);
  }
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Your GENIUS session is no longer valid. Reopen this task in GENIUS to continue reading the slides.");
  if (alreadyLoaded) expect(screen.getByText("Slide 1 of 5")).toBeTruthy();
  expect(fetchMock.mock.calls.at(-1)![1].headers.Authorization).toBe("Bearer expired-reader-token");
});

it("keeps native sign-in guidance when an unrelated verified GENIUS identity exists", async () => {
  setVerifiedClientAuth("other-task-token", { classId: "host-class", assignmentId: "host-task" } as EmbeddedUserContext);
  fetchMock.mockResolvedValue(reply({}, 401));
  render(<PublishedSlidesReader {...props} />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Sign in to this class to read these slides.");
  expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
});

it("does not treat unverified URL context as a verified GENIUS session", async () => {
  window.history.replaceState({}, "", "/?classId=host-class&assignmentId=host-task&sso_token=unverified-token");
  try {
    fetchMock.mockResolvedValue(reply({}, 401));
    render(<PublishedSlidesReader {...props} classId="host-class" assignmentId="host-task" />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Sign in to this class to read these slides.");
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  } finally { window.history.replaceState({}, "", "/"); }
});
