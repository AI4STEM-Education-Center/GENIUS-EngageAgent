// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import AskEngageAgent from "@/app/components/AskEngageAgent";
import { MAX_ASK_HISTORY, MAX_ASK_MESSAGE } from "@/lib/ask-engageagent";
import { clearVerifiedClientAuth, setVerifiedClientAuth } from "@/lib/client-auth";
import type { UserContext } from "@/lib/auth";

type Reply = { ok: boolean; json: () => Promise<unknown> };
const answer = (text: string): Reply => ({ ok: true, json: async () => ({ answer: text }) });
let fetchMock: ReturnType<typeof vi.fn>;

const props: ComponentProps<typeof AskEngageAgent> = {
  role: "teacher", classId: "c1", assignmentId: "a1", page: "assessment", pageLabel: "Step 1 · First label", lessonNumber: 3,
};
const show = (changes: Partial<typeof props> = {}) => render(<AskEngageAgent {...props} {...changes} />);
const icon = () => screen.getByRole("button", { name: "Ask EngageAgent" });
const panel = () => screen.getByRole("dialog", { name: "Ask EngageAgent" });
const log = () => within(screen.getByRole("log", { name: "Conversation" }));
const input = () => screen.getByRole("textbox", { name: "Your question" }) as HTMLInputElement;
const sendButton = () => screen.getByRole("button", { name: "Send question" }) as HTMLButtonElement;
const suggestions = () => within(screen.getByRole("group", { name: "Suggested questions" })).getAllByRole("button").map(button => button.textContent);
const openPanel = () => fireEvent.click(icon());
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const pressEnter = () => fireEvent.keyDown(input(), { key: "Enter" });
const sentBody = (call = -1) => JSON.parse(fetchMock.mock.calls.at(call)![1].body as string);
const ask = async (text: string, reply?: string) => {
  type(text);
  pressEnter();
  if (reply) await log().findByText(reply);
};
const deferred = () => {
  let resolve!: (reply: Reply) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Reply>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  fetchMock = vi.fn(async () => answer("An answer."));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearVerifiedClientAuth(); });

describe("who sees it", () => {
  it("shows teachers a round icon fixed at the bottom right", () => {
    show();
    expect(icon().className).toMatch(/\bfixed\b/);
    expect(icon().className).toMatch(/\bbottom-4\b/);
    expect(icon().className).toMatch(/\bright-4\b/);
    expect(icon().className).toMatch(/\brounded-full\b/);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["student", "guest"] as const)("renders nothing for a %s", role => {
    const { container } = show({ role });
    expect(container.innerHTML).toBe("");
  });

  it.each([["class", { classId: "" }], ["assignment", { assignmentId: "" }]])("renders nothing without a %s, since the route needs one", (_name, change) => {
    const { container } = show(change);
    expect(container.innerHTML).toBe("");
  });

  it("sits below page modals and leaves room for them", () => {
    show();
    expect(icon().className).toMatch(/\bz-40\b/);
    openPanel();
    expect(panel().className).toMatch(/\bz-40\b/);
  });
});

describe("opening and closing", () => {
  it("opens a labelled panel with focus in the question box", () => {
    show();
    openPanel();
    expect(panel()).toBeTruthy();
    expect(document.activeElement).toBe(input());
    expect(screen.queryByRole("button", { name: "Ask EngageAgent" })).toBeNull();
    expect(screen.getByRole("log", { name: "Conversation" }).getAttribute("aria-live")).toBe("polite");
  });

  it("doesn't take focus when it first appears", () => {
    show();
    expect(document.activeElement).toBe(document.body);
  });

  it("closes with the x and returns focus to the icon", () => {
    show();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close Ask EngageAgent" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(icon());
  });

  it("closes with Escape and returns focus to the icon", () => {
    show();
    openPanel();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(icon());
  });

  it("keeps the thread and draft when closed and reopened", async () => {
    show();
    openPanel();
    await ask("First question", "An answer.");
    type("Half a thought");
    fireEvent.keyDown(input(), { key: "Escape" });
    openPanel();
    expect(log().getByText("First question")).toBeTruthy();
    expect(log().getByText("An answer.")).toBeTruthy();
    expect(input().value).toBe("Half a thought");
  });

  it("adds an answer that arrives while the panel is closed", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    show();
    openPanel();
    await ask("Slow question");
    fireEvent.keyDown(input(), { key: "Escape" });
    await act(async () => { pending.resolve(answer("Late answer.")); });
    expect(screen.queryByRole("dialog")).toBeNull();
    openPanel();
    expect(log().getByText("Late answer.")).toBeTruthy();
  });
});

describe("scope and suggestions", () => {
  it("shows the label it is given, so a renamed step follows", () => {
    show({ pageLabel: "Step 1 · A brand new name" });
    openPanel();
    expect(panel().textContent).toContain("Helping with: Step 1 · A brand new name");
  });

  it("updates the scope and suggestions when the tab changes and keeps the thread", async () => {
    const view = show();
    openPanel();
    const first = suggestions();
    await ask("Keep this question", "An answer.");

    view.rerender(<AskEngageAgent {...props} page="materials" pageLabel="Step 3 · Third label" />);
    expect(panel().textContent).toContain("Helping with: Step 3 · Third label");
    expect(panel().textContent).not.toContain("First label");
    expect(suggestions()).not.toEqual(first);
    expect(suggestions()).toContain("What does Check slides look for?");
    expect(log().getByText("Keep this question")).toBeTruthy();
    expect(log().getByText("An answer.")).toBeTruthy();
  });

  it.each(["assessment", "strategy", "materials", "discussion", "dashboard", "gallery"] as const)("offers suggestions on %s", page => {
    show({ page });
    openPanel();
    expect(suggestions().length).toBeGreaterThan(0);
  });

  it("gives each page its own suggestions", () => {
    const seen = new Set<string>();
    for (const page of ["assessment", "strategy", "materials", "discussion", "dashboard", "gallery"] as const) {
      const view = show({ page });
      openPanel();
      seen.add(JSON.stringify(suggestions()));
      view.unmount();
    }
    expect(seen.size).toBe(6);
  });

  it("doesn't suggest questions that would need student data or name a step", () => {
    for (const page of ["assessment", "strategy", "materials", "discussion", "dashboard", "gallery"] as const) {
      const view = show({ page });
      openPanel();
      for (const question of suggestions()) expect(question).not.toMatch(/who hasn.t|for this class|Step \d|slide 3/i);
      view.unmount();
    }
  });

  it("sends a suggestion when it is selected and keeps focus in the box", async () => {
    show({ page: "strategy" });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "How is the strategy recommended?" }));
    expect(sentBody().message).toBe("How is the strategy recommended?");
    expect(document.activeElement).toBe(input());
    await log().findByText("An answer.");
  });
});

describe("sending", () => {
  it("sends the page, lesson and class on Enter and shows the answer", async () => {
    show({ page: "strategy", lessonNumber: 5 });
    openPanel();
    await ask("  How does this work?  ", "An answer.");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ask-engageagent");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(sentBody()).toEqual({ classId: "c1", assignmentId: "a1", page: "strategy", lessonNumber: 5, message: "How does this work?", history: [] });
    expect(log().getByText("How does this work?")).toBeTruthy();
    expect(input().value).toBe("");
  });

  it("sends the page at the moment of asking", async () => {
    const view = show({ page: "strategy" });
    openPanel();
    await ask("One", "An answer.");
    view.rerender(<AskEngageAgent {...props} page="gallery" pageLabel="Gallery" lessonNumber={null} />);
    await ask("Two");
    expect(sentBody()).toMatchObject({ page: "gallery", lessonNumber: null });
    await waitFor(() => expect(log().getAllByText("An answer.")).toHaveLength(2));
  });

  it("sends with the button too", async () => {
    show();
    openPanel();
    type("From the button");
    fireEvent.click(sendButton());
    await log().findByText("An answer.");
    expect(sentBody().message).toBe("From the button");
  });

  it("doesn't send a blank question", () => {
    show();
    openPanel();
    expect(sendButton().disabled).toBe(true);
    type("   ");
    expect(sendButton().disabled).toBe(true);
    pressEnter();
    fireEvent.submit(input().closest("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't send while an input method is still composing", () => {
    show();
    openPanel();
    type("かんじ");
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps what can be typed", () => {
    show();
    openPanel();
    expect(input().maxLength).toBe(MAX_ASK_MESSAGE);
  });

  it("sends earlier questions and answers as history", async () => {
    fetchMock.mockResolvedValueOnce(answer("Answer one.")).mockResolvedValueOnce(answer("Answer two."));
    show();
    openPanel();
    await ask("Question one", "Answer one.");
    await ask("Question two", "Answer two.");
    expect(sentBody().history).toEqual([{ role: "user", content: "Question one" }, { role: "assistant", content: "Answer one." }]);
    expect(sentBody().message).toBe("Question two");
  });

  it("sends only the most recent history", async () => {
    show();
    openPanel();
    for (let turn = 0; turn < 8; turn += 1) {
      fetchMock.mockResolvedValueOnce(answer(`Answer ${turn}.`));
      await ask(`Question ${turn}`, `Answer ${turn}.`);
    }
    fetchMock.mockResolvedValueOnce(answer("Last."));
    await ask("Last question", "Last.");
    const { history } = sentBody();
    expect(history).toHaveLength(MAX_ASK_HISTORY);
    expect(history[0]).toEqual({ role: "user", content: "Question 2" });
    expect(history.at(-1)).toEqual({ role: "assistant", content: "Answer 7." });
  });

  it("leaves a failed question out of the history", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Nope." }) })
      .mockResolvedValueOnce(answer("Answer two."))
      .mockResolvedValueOnce(answer("Answer three."));
    show();
    openPanel();
    await ask("Failed question", "Nope.");
    await ask("Question two", "Answer two.");
    expect(sentBody().history).toEqual([]);
    await ask("Question three", "Answer three.");
    expect(sentBody().history).toEqual([{ role: "user", content: "Question two" }, { role: "assistant", content: "Answer two." }]);
  });

  it("shows a loading state while waiting", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    show();
    openPanel();
    expect(log().queryByText("Thinking…")).toBeNull();
    await ask("Slow question");
    expect(log().getByText("Thinking…")).toBeTruthy();
    pending.resolve(answer("Done."));
    await log().findByText("Done.");
    expect(log().queryByText("Thinking…")).toBeNull();
  });

  it("blocks a double send until the answer is back", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    show({ page: "strategy" });
    openPanel();
    type("Only once");
    // Both in the same tick, before React can re-render with `sending`.
    pressEnter();
    pressEnter();
    fireEvent.submit(input().closest("form")!);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(log().getAllByText("Only once")).toHaveLength(1);

    type("While waiting");
    expect(sendButton().disabled).toBe(true);
    pressEnter();
    const suggestion = screen.getByRole("button", { name: "How is the strategy recommended?" }) as HTMLButtonElement;
    expect(suggestion.disabled).toBe(true);
    fireEvent.click(suggestion);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(input().value).toBe("While waiting");

    pending.resolve(answer("Done."));
    await log().findByText("Done.");
    expect(sendButton().disabled).toBe(false);
    pressEnter();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(log().getByText("An answer.")).toBeTruthy());
  });

  it("can send again after a failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    show();
    openPanel();
    await ask("First try", "EngageAgent couldn't answer right now. Please try again.");
    await ask("Second try", "An answer.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops the request when the page goes away", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    const view = show();
    openPanel();
    await ask("Leaving");
    const { signal } = fetchMock.mock.calls[0][1] as { signal: AbortSignal };
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.reject(new DOMException("Aborted", "AbortError"));
  });

  it("attaches the GENIUS launch token through the scoped task fetch", async () => {
    const user: UserContext = { geniusId: "t", userId: "t", email: null, name: "T", role: "teacher", classId: "c1", assignmentId: "a1" };
    setVerifiedClientAuth("host-token", user);
    show();
    openPanel();
    await ask("From GENIUS", "An answer.");
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer host-token");
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});

describe("answers and errors", () => {
  it("renders an answer as plain text", async () => {
    const markup = "<img src=x onerror=alert(1)> **bold**";
    fetchMock.mockResolvedValueOnce(answer(markup));
    const { container } = show();
    openPanel();
    await ask("Tricky", markup);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  it("shows the server's short error in the thread", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Ask EngageAgent isn't set up on this server yet." }) });
    show();
    openPanel();
    await ask("Anyone there?", "Ask EngageAgent isn't set up on this server yet.");
    expect(log().getByText("Anyone there?")).toBeTruthy();
    expect(log().getByText("Ask EngageAgent isn't set up on this server yet.").className).toMatch(/text-bad/);
  });

  it("trusts the status over the body of a failed reply", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ answer: "Not a real answer.", error: "It failed." }) });
    show();
    openPanel();
    await ask("Hello", "It failed.");
    expect(log().queryByText("Not a real answer.")).toBeNull();
  });

  it.each([
    ["a network failure", () => Promise.reject(new Error("secret network detail"))],
    ["a reply that isn't JSON", async () => ({ ok: false, json: async () => { throw new Error("secret parse detail"); } })],
    ["an error with no message", async () => ({ ok: false, json: async () => ({}) })],
    ["an error that isn't text", async () => ({ ok: false, json: async () => ({ error: { detail: "secret" } }) })],
    ["a success with no answer", async () => ({ ok: true, json: async () => ({}) })],
    ["a success with an answer that isn't text", async () => ({ ok: true, json: async () => ({ answer: 42 }) })],
  ])("shows a short error for %s", async (_name, reply) => {
    fetchMock.mockImplementationOnce(reply);
    show();
    openPanel();
    await ask("Hello", "EngageAgent couldn't answer right now. Please try again.");
    expect(panel().textContent).not.toContain("secret");
  });
});
