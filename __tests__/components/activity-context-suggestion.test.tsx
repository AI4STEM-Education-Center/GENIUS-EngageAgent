// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ActivityContextSuggestion from "@/app/components/ActivityContextSuggestion";
import { activityContextParagraph } from "@/lib/activity-context";
import { clearVerifiedClientAuth, setVerifiedClientAuth } from "@/lib/client-auth";
import type { TaskInterests } from "@/lib/task-interests";

const activity = {
  activity: "Soccer", category: "Sports", studentCount: 4, doCount: 3, watchedCount: 1,
  objects: ["ball", "goal"], incidents: ["A ball bounced off a goal post."],
};
const interests: TaskInterests = {
  classId: "class-a", assignmentId: "task-a", surveyId: "survey-a", dailyExperienceTopic: "Sports and hobbies",
  analyzedAt: "2026-10-14T12:00:00Z", responseCount: 5, unclassifiedCount: 0,
  enoughResponses: true, top: [activity], activities: [activity], stale: false,
};
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });
const fetchMock = vi.fn();
const onChange = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  clearVerifiedClientAuth();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(reply({ interests }));
});
afterEach(() => { cleanup(); clearVerifiedClientAuth(); vi.unstubAllGlobals(); });

function Controlled({ initialContext = "", disabled = false }: { initialContext?: string; disabled?: boolean }) {
  const [context, setContext] = useState(initialContext);
  return <>
    <ActivityContextSuggestion classId="class-a" assignmentId="task-a" context={context} disabled={disabled}
      onChange={(next) => { onChange(next); setContext(next); }} />
    <textarea aria-label="Classroom context" value={context} onChange={(event) => setContext(event.target.value)} />
  </>;
}

it("loads the scoped suggestion without selecting it or changing teacher text", async () => {
  setVerifiedClientAuth("suggestion-test-credential", {
    geniusId: "teacher", userId: "teacher", name: "Teacher", email: null, role: "teacher", classId: "class-a", assignmentId: "task-a",
  });
  render(<Controlled initialContext="Grade 8. Keep the opening brief." />);
  expect(await screen.findByText("Soccer")).toBeTruthy();
  expect(screen.getByText("4 of 5 respondents mentioned it · 3 do it · 1 have watched it")).toBeTruthy();
  expect(screen.getByText(/Survey topic: Sports and hobbies/)).toBeTruthy();
  expect(screen.getByText(/A ball bounced off a goal post/)).toBeTruthy();
  expect(screen.getByText(/the next time you select Generate materials/)).toBeTruthy();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Grade 8. Keep the opening brief.");
  expect(onChange).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledWith("/api/survey-analysis?classId=class-a&assignmentId=task-a", {
    headers: { Authorization: "Bearer suggestion-test-credential" }, cache: "no-store", signal: expect.any(AbortSignal),
  });
});

it("appends factual context only on opt-in, prevents duplicates, and allows removal and re-adding", async () => {
  const initial = "  Grade 8; preserve my spacing.\n";
  render(<Controlled initialContext={initial} />);
  fireEvent.click(await screen.findByRole("button", { name: "Use top activity (optional)" }));
  const context = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(context.value.startsWith(`${initial}\n\nSurvey context:`)).toBe(true);
  expect(context.value).toContain('this task\'s survey on "Sports and hobbies"');
  expect(context.value).toContain("4 of 5 respondents mentioned Soccer (3 do it; 1 have watched it)");
  expect(context.value).toContain("Reported objects: ball, goal.");
  expect(context.value).toContain("only when relevant to the lesson; do not assume it is familiar to every student");
  expect(onChange).toHaveBeenCalledTimes(1);
  const added = screen.getByRole("button", { name: "Activity added" }) as HTMLButtonElement;
  expect(added.disabled).toBe(true);
  fireEvent.click(added);
  expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent.change(context, { target: { value: initial } });
  const useAgain = screen.getByRole("button", { name: "Use top activity (optional)" }) as HTMLButtonElement;
  expect(useAgain.disabled).toBe(false);
  fireEvent.click(useAgain);
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(context.value.match(/Survey context:/g)).toHaveLength(1);
});

it("does not truncate teacher input when the appended paragraph would exceed 1200 characters", async () => {
  const initial = "A".repeat(1150);
  render(<Controlled initialContext={initial} />);
  const button = await screen.findByRole("button", { name: "Use top activity (optional)" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("not enough space");
  fireEvent.click(button);
  expect(onChange).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(initial);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Short teacher context." } });
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value.length).toBeLessThanOrEqual(1200);
});

it("ignores an old task's delayed response and aborts its request when task scope changes", async () => {
  let resolveOld!: (value: ReturnType<typeof reply>) => void;
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  fetchMock.mockResolvedValueOnce(reply({ interests: { ...interests, assignmentId: "task-b", top: [{ ...activity, activity: "Cooking" }] } }));
  const { rerender } = render(<ActivityContextSuggestion classId="class-a" assignmentId="task-a" context="" onChange={onChange} />);
  const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  rerender(<ActivityContextSuggestion classId="class-a" assignmentId="task-b" context="" onChange={onChange} />);
  expect(await screen.findByText("Cooking")).toBeTruthy();
  expect(oldSignal.aborted).toBe(true);
  await act(async () => { resolveOld(reply({ interests })); });
  expect(screen.queryByText("Soccer")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Use top activity (optional)" }));
  expect(onChange.mock.calls[0][0]).toContain("mentioned Cooking");
  expect(onChange.mock.calls[0][0]).not.toContain("Soccer");
});

it.each([
  { result: null, message: "No survey responses are available" },
  { result: { ...interests, enoughResponses: false, responseCount: 2, top: [] }, message: "At least 3 students must submit" },
  { result: { ...interests, top: [], activities: [], unclassifiedCount: 5 }, message: "No clear activity was found" },
])("keeps generation optional when no usable suggestion exists: $message", async ({ result, message }) => {
  fetchMock.mockResolvedValueOnce(reply({ interests: result }));
  render(<Controlled />);
  expect(await screen.findByText(new RegExp(message))).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Use top activity (optional)" })).toBeNull();
  expect(screen.getByRole("button", { name: "Refresh suggestion" })).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});

it("offers a nonblocking retry after a failed analysis", async () => {
  fetchMock.mockResolvedValueOnce(reply({ error: "Analysis temporarily unavailable." }, false));
  render(<Controlled initialContext="Teacher context" />);
  expect((await screen.findByRole("status")).textContent).toContain("You can still enter classroom context and generate materials");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Soccer")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Teacher context");
});

it("labels stale analysis in both the suggestion and the context selected by the teacher", async () => {
  fetchMock.mockResolvedValueOnce(reply({ interests: { ...interests, stale: true } }));
  render(<Controlled />);
  expect(await screen.findByText(/Last available analysis: newer responses/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use top activity (optional)" }));
  expect(onChange.mock.calls[0][0]).toContain("Survey context (last available analysis)");
});

it("refreshes the suggestion without changing context until the teacher opts in again", async () => {
  render(<Controlled />);
  await screen.findByText("Soccer");
  fetchMock.mockResolvedValueOnce(reply({ interests: { ...interests, top: [{ ...activity, activity: "Drawing" }] } }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh suggestion" }));
  expect(await screen.findByText("Drawing")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([false, true])("keeps an opted-in activity added after updated counts and stale=%s analysis, until its paragraph is removed", async (stale) => {
  fetchMock.mockResolvedValueOnce(reply({ interests: { ...interests, stale } }));
  const manualContext = "Grade 8. Students may mention Soccer.";
  render(<Controlled initialContext={manualContext} />);
  fireEvent.click(await screen.findByRole("button", { name: "Use top activity (optional)" }));
  const context = screen.getByRole("textbox") as HTMLTextAreaElement;
  const original = context.value;

  fetchMock.mockResolvedValueOnce(reply({ interests: {
    ...interests, responseCount: 6, stale: false,
    top: [{ ...activity, studentCount: 5, doCount: 4 }],
  } }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh suggestion" }));
  await screen.findByText("5 of 6 respondents mentioned it · 4 do it · 1 have watched it");
  const added = screen.getByRole("button", { name: "Activity added" }) as HTMLButtonElement;
  expect(added.disabled).toBe(true);
  fireEvent.click(added);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(context.value).toBe(original);

  // Removing the generated paragraph allows an explicit choice of the new
  // analysis. A teacher's ordinary mention of the same activity is not a match.
  fireEvent.change(context, { target: { value: manualContext } });
  const useAgain = screen.getByRole("button", { name: "Use top activity (optional)" }) as HTMLButtonElement;
  expect(useAgain.disabled).toBe(false);
  fireEvent.click(useAgain);
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(context.value).toContain("5 of 6 respondents mentioned Soccer");
  expect(context.value).not.toContain("4 of 5 respondents mentioned Soccer");
  expect(context.value.match(/Survey context/g)).toHaveLength(1);
});

it("recognizes a previously saved selection with literal punctuation after a new mount", async () => {
  const savedInterests = { ...interests, dailyExperienceTopic: "Sports (ball games) + hobbies?", stale: true };
  const savedActivity = { ...activity, activity: "Catch (ball) + running" };
  const savedContext = `Teacher's existing text.\n\n${activityContextParagraph(savedInterests, savedActivity)}`;
  fetchMock.mockResolvedValueOnce(reply({ interests: {
    ...savedInterests, stale: false, responseCount: 6,
    top: [{ ...savedActivity, studentCount: 5, doCount: 4 }],
  } }));
  render(<Controlled initialContext={savedContext} />);
  const added = await screen.findByRole("button", { name: "Activity added" }) as HTMLButtonElement;
  expect(added.disabled).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(savedContext);
});

it("honors the disabled state and cancels an unfinished request on unmount", async () => {
  const { unmount } = render(<Controlled disabled />);
  const useButton = await screen.findByRole("button", { name: "Use top activity (optional)" }) as HTMLButtonElement;
  expect(useButton.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Refresh suggestion" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(useButton);
  expect(onChange).not.toHaveBeenCalled();
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  unmount();
  await waitFor(() => expect(signal.aborted).toBe(true));
});
