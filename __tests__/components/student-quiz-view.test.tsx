// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentQuizView from "@/app/components/StudentQuizView";
import type { UserContext } from "@/lib/auth";
import type { Survey } from "@/lib/types";
import { getLesson } from "@/lib/quiz-data";
import { CURRENT_QUIZ_VERSION, getQuizItemsForVersion } from "@/lib/quiz-assessment";

const user: UserContext = { geniusId: "student-a", userId: "student-a", name: "Student", email: null, role: "student", classId: "class-a", assignmentId: "task-a" };
const lesson = getLesson(8)!;
const confidence = getQuizItemsForVersion(lesson.quiz_items).filter(item => item.type === "confidence_check");
const contentQuestions = lesson.quiz_items.filter(item => item.type === "multiple_choice");
const survey: Survey = {
  survey_id: "survey-a", class_id: user.classId!, assignment_id: user.assignmentId!, title: "Your experience", daily_experience_topic: "Pushing objects",
  status: "published", created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z",
  questions: [{ item_id: "experience-a", question_number: 1, category: "experience_details", stem: "Recall pushing something.", response_fields: [
    { field_id: "experience", label: "Describe your experience", response_type: "text", text_length: "long" },
    { field_id: "uncertainty", label: "Where did you feel uncertain?", response_type: "text", text_length: "short" },
  ] }],
};
const fetchMock = vi.fn();
let savedAnswers: Record<string, string> | null;
let savedSurvey: Record<string, string> | null;
const reply = (data: unknown) => ({ ok: true, json: async () => data });

beforeEach(() => {
  vi.clearAllMocks(); savedAnswers = null; savedSurvey = null;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return reply({});
    if (url.startsWith("/api/quiz-status")) return reply({ quizStatus: { lesson_number: 8, status: "published" } });
    if (url.startsWith("/api/lessons/")) return reply(lesson);
    if (url.startsWith("/api/student-answers")) return reply({ answer: savedAnswers ? { answers: savedAnswers } : null });
    if (url.startsWith("/api/surveys?")) return reply({ surveys: [survey] });
    if (url.startsWith("/api/survey-responses")) return reply({ responses: savedSurvey ? [{ status: "submitted", answers: savedSurvey }] : [] });
    throw new Error(`Unexpected request: ${url}`);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("keeps survey-only drafts through polling and quiz publication, then submits both parts", async () => {
  let published = false;
  const originalFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.startsWith("/api/quiz-status")
    ? reply({ quizStatus: published ? { lesson_number: 8, status: "published" } : null }) : originalFetch(url, init));
  vi.useFakeTimers();
  await act(async () => { render(<StudentQuizView user={user} />); });
  const experience = screen.getByRole("textbox", { name: "Describe your experience" }) as HTMLTextAreaElement;
  fireEvent.change(experience, { target: { value: "I pushed a cart." } });
  fireEvent.change(screen.getByRole("textbox", { name: "Where did you feel uncertain?" }), { target: { value: "Getting it moving." } });
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(experience.value).toBe("I pushed a cart.");
  expect(screen.queryByRole("radiogroup")).toBeNull();
  published = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(experience.value).toBe("I pushed a cart.");
  for (const item of contentQuestions) fireEvent.click(within(screen.getByText(item.stem).parentElement!).getByRole("button", { name: `A${item.options.A}` }));
  for (const group of screen.getAllByRole("radiogroup")) fireEvent.click(within(group).getByRole("radio", { name: "Very confident" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Submit answers" })); });
  expect(screen.getByRole("button", { name: "Submitted" })).toBeTruthy();
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts.map(([url]) => url)).toEqual(["/api/student-answers", "/api/survey-responses"]);
  expect(JSON.parse(posts[1][1].body).answers.experience).toBe("I pushed a cart.");
});

it("submits a survey without a quiz and retries a failure without claiming a quiz was saved", async () => {
  let failOnce = true;
  const originalFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/quiz-status")) return reply({ quizStatus: null });
    if (url === "/api/survey-responses" && init?.method === "POST" && failOnce) {
      failOnce = false;
      return { ok: false, json: async () => ({ error: "Temporary failure." }) };
    }
    return originalFetch(url, init);
  });
  render(<StudentQuizView user={user} />);
  fireEvent.change(await screen.findByRole("textbox", { name: "Describe your experience" }), { target: { value: "Pushing a cart" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Where did you feel uncertain?" }), { target: { value: "Starting" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Your survey answers didn't go through");
  fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
  await screen.findByRole("button", { name: "Submitted" });
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => url))
    .toEqual(["/api/survey-responses", "/api/survey-responses"]);
});

it.each(["timer", "focus", "button"])("loads a newly published quiz through %s without a page reload or replacing answers once open", async trigger => {
  let published = false;
  const originalFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.startsWith("/api/quiz-status")
    ? reply({ quizStatus: published ? { lesson_number: 8, status: "published" } : null })
    : url.startsWith("/api/surveys?") && !published ? reply({ surveys: [] }) : originalFetch(url, init));
  vi.useFakeTimers();
  await act(async () => { render(<StudentQuizView user={user} />); });
  expect(screen.getByText("No quiz available yet")).toBeTruthy();
  published = true;
  await act(async () => {
    if (trigger === "timer") await vi.advanceTimersByTimeAsync(15000);
    else if (trigger === "focus") fireEvent.focus(window);
    else fireEvent.click(screen.getByRole("button", { name: "Refresh quiz" }));
  });
  expect(screen.getByText("Answer the questions below")).toBeTruthy();
  expect(screen.queryByText("No quiz available yet")).toBeNull();
  const choice = within(screen.getAllByRole("radiogroup")[0]).getByRole("radio", { name: "Very confident" });
  fireEvent.click(choice);
  const nonStatusCalls = fetchMock.mock.calls.filter(([url]) => !url.startsWith("/api/quiz-status")).length;
  await act(async () => { fireEvent.focus(window); await vi.advanceTimersByTimeAsync(30000); });
  expect(fetchMock.mock.calls.filter(([url]) => !url.startsWith("/api/quiz-status"))).toHaveLength(nonStatusCalls);
  expect(choice.getAttribute("aria-checked")).toBe("true");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("lets a student retry a failed initial quiz load", async () => {
  const originalFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: "Quiz temporarily unavailable." }) }));
  render(<StudentQuizView user={user} />);
  await screen.findByText("Quiz temporarily unavailable.");
  fetchMock.mockImplementation(originalFetch);
  fireEvent.click(screen.getByRole("button", { name: "Retry loading quiz" }));
  await screen.findByText("Answer the questions below");
  expect(screen.queryByText("Unable to load quiz")).toBeNull();
});

it.each(["quiz", "survey"])("preserves answers after a failed %s submission and retries only the unsaved part", async part => {
  const originalFetch = fetchMock.getMockImplementation()!;
  const failedPath = part === "quiz" ? "/api/student-answers" : "/api/survey-responses";
  let failOnce = true;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === failedPath && init?.method === "POST" && failOnce) {
      failOnce = false;
      return { ok: false, json: async () => ({ error: "Temporary submission failure." }) };
    }
    return originalFetch(url, init);
  });
  render(<StudentQuizView user={user} />);
  const groups = await screen.findAllByRole("radiogroup");
  for (const item of contentQuestions) fireEvent.click(within(screen.getByText(item.stem).parentElement!).getByRole("button", { name: `A${item.options.A}` }));
  for (const group of groups) fireEvent.click(within(group).getByRole("radio", { name: "Very confident" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Describe your experience" }), { target: { value: "I pushed a cart." } });
  fireEvent.change(screen.getByRole("textbox", { name: "Where did you feel uncertain?" }), { target: { value: "Getting it moving." } });
  fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Temporary submission failure.");
  expect(screen.queryByText("Unable to load quiz")).toBeNull();
  expect((screen.getByRole("textbox", { name: "Describe your experience" }) as HTMLTextAreaElement).value).toBe("I pushed a cart.");
  for (const group of groups) expect(within(group).getByRole("radio", { name: "Very confident" }).getAttribute("aria-checked")).toBe("true");
  const submit = screen.getByRole("button", { name: "Submit answers" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  await screen.findByRole("button", { name: "Submitted" });
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts.map(([url]) => url)).toEqual(part === "quiz"
    ? ["/api/student-answers", "/api/student-answers", "/api/survey-responses"]
    : ["/api/student-answers", "/api/survey-responses", "/api/survey-responses"]);
  const attempts = posts.filter(([url]) => url === failedPath);
  expect(attempts[0][1].body).toBe(attempts[1][1].body);
});

it("renders only confidence checks as four-option horizontal ratings with unchanged labels and keyboard selection", async () => {
  render(<StudentQuizView user={user} />);
  const groups = await screen.findAllByRole("radiogroup", { name: "How confident are you about your answer?" });
  expect(groups).toHaveLength(4);
  for (const group of groups) {
    expect(group.classList.contains("grid-flow-col")).toBe(true);
    expect(group.getAttribute("aria-orientation")).toBe("horizontal");
    const options = within(group).getAllByRole("radio") as HTMLButtonElement[];
    expect(options.map(option => option.textContent)).toEqual(Object.values(confidence[0].options));
    expect(options.map(option => option.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "false"]);
    expect(options.map(option => option.tabIndex)).toEqual([0, -1, -1, -1]);
  }
  const options = within(groups[0]).getAllByRole("radio") as HTMLButtonElement[];
  options[0].focus();
  fireEvent.keyDown(options[0], { key: "ArrowRight" });
  expect(document.activeElement).toBe(options[1]);
  expect(options[1].getAttribute("aria-checked")).toBe("true");
  expect(options[0].getAttribute("aria-checked")).toBe("false");
  fireEvent.keyDown(options[1], { key: "End" });
  expect(document.activeElement).toBe(options[3]);
  fireEvent.keyDown(options[3], { key: "Home" });
  expect(document.activeElement).toBe(options[0]);
  fireEvent.keyDown(options[0], { key: "ArrowLeft" });
  expect(document.activeElement).toBe(options[3]);
  expect(options[3].getAttribute("aria-checked")).toBe("true");
  fireEvent.click(options[2]);
  expect(options[2].getAttribute("aria-checked")).toBe("true");
  expect(options[3].getAttribute("aria-checked")).toBe("false");
  for (const item of contentQuestions) {
    const question = within(screen.getByText(item.stem).parentElement!);
    expect(question.queryByRole("radiogroup")).toBeNull();
    expect(question.getAllByRole("button")).toHaveLength(4);
  }
  expect(screen.getByRole("textbox", { name: "Describe your experience" }).tagName).toBe("TEXTAREA");
  expect(screen.getByRole("textbox", { name: "Where did you feel uncertain?" }).tagName).toBe("INPUT");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("requires every confidence response and submits the original A–D values with the existing survey answers", async () => {
  const onProgress = vi.fn();
  render(<StudentQuizView user={user} onProgress={onProgress} />);
  const groups = await screen.findAllByRole("radiogroup");
  const submit = screen.getByRole("button", { name: "Submit answers" }) as HTMLButtonElement;
  for (const item of contentQuestions) {
    fireEvent.click(within(screen.getByText(item.stem).parentElement!).getByRole("button", { name: `A${item.options.A}` }));
  }
  fireEvent.change(screen.getByRole("textbox", { name: "Describe your experience" }), { target: { value: "I pushed a shopping cart." } });
  fireEvent.change(screen.getByRole("textbox", { name: "Where did you feel uncertain?" }), { target: { value: "When it became harder to start." } });
  const values = ["A", "B", "C", "D"];
  for (let i = 0; i < groups.length; i++) {
    expect(submit.disabled).toBe(true);
    fireEvent.click(within(groups[i]).getByRole("radio", { name: confidence[i].options[values[i]] }));
  }
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  await screen.findByRole("button", { name: "Submitted" });
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts.map(([url]) => url)).toEqual(["/api/student-answers", "/api/survey-responses"]);
  expect(JSON.parse(posts[0][1].body).answers).toEqual(Object.fromEntries([
    ...contentQuestions.map(item => [item.item_id, "A"]), ...confidence.map((item, index) => [item.item_id, values[index]]),
  ]));
  expect(JSON.parse(posts[1][1].body)).toMatchObject({ surveyId: survey.survey_id, action: "submit", answers: {
    experience: "I pushed a shopping cart.", uncertainty: "When it became harder to start.",
  } });
  for (const option of screen.getAllByRole("radio")) expect((option as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(onProgress).toHaveBeenLastCalledWith({ kind: "completed" }));
});

it("restores submitted confidence values without changing or resubmitting them", async () => {
  savedAnswers = Object.fromEntries(lesson.quiz_items.map(item => [item.item_id, item.type === "confidence_check" ? "C" : "B"]));
  savedSurvey = { experience: "Earlier experience", uncertainty: "Earlier uncertainty" };
  render(<StudentQuizView user={user} />);
  const groups = await screen.findAllByRole("radiogroup");
  for (const group of groups) {
    const selected = within(group).getByRole("radio", { name: "Not very confident" }) as HTMLButtonElement;
    expect(selected.getAttribute("aria-checked")).toBe("true");
    expect(selected.disabled).toBe(true);
    const other = within(group).getByRole("radio", { name: "Very confident" });
    fireEvent.click(other);
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    expect(selected.getAttribute("aria-checked")).toBe("true");
    expect(other.getAttribute("aria-checked")).toBe("false");
  }
  expect((screen.getByRole("button", { name: "Submitted" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});


function mockUnifiedQuiz(status: "draft" | "published" = "published") {
  const unifiedLesson = getLesson(2)!;
  const originalFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/quiz-status")) return reply({ quizStatus: {
      lesson_number: 2, status, quiz_version: CURRENT_QUIZ_VERSION,
    } });
    if (url.startsWith("/api/lessons/")) return reply(unifiedLesson);
    return originalFetch(url, init);
  });
  return unifiedLesson;
}

function completeUnifiedAnswers(unifiedLesson: NonNullable<ReturnType<typeof getLesson>>) {
  return Object.fromEntries(unifiedLesson.quiz_items.flatMap(item => item.type === "experience"
    ? (item.response_fields ?? []).map(field => [field.field_id, field.response_type === "choice" ? field.options![0] : `My answer for ${field.label}`])
    : [[item.item_id, "A"]]));
}

it("appends three lesson experience questions, requires their answers and confidence, and saves everything in one quiz submission", async () => {
  const unifiedLesson = mockUnifiedQuiz();
  const onProgress = vi.fn();
  render(<StudentQuizView user={user} onProgress={onProgress} />);
  const groups = await screen.findAllByRole("radiogroup");
  expect(groups).toHaveLength(7);
  expect(screen.getByText("Lesson 2 Quiz")).toBeTruthy();
  expect(screen.queryByText(survey.questions[0].stem)).toBeNull();
  expect(unifiedLesson.quiz_items.filter(item => item.type !== "confidence_check")).toHaveLength(7);
  expect(fetchMock.mock.calls.some(([url]) => url.startsWith("/api/surveys"))).toBe(false);
  const submit = screen.getByRole("button", { name: "Submit answers" }) as HTMLButtonElement;
  const expectedAnswers = completeUnifiedAnswers(unifiedLesson);
  for (const item of unifiedLesson.quiz_items.filter(item => item.type === "multiple_choice")) {
    fireEvent.click(within(screen.getByText(item.stem).parentElement!).getByRole("button", { name: `A${item.options.A}` }));
  }
  for (const item of unifiedLesson.quiz_items.filter(item => item.type === "experience")) {
    const question = within(screen.getByText(item.stem).parentElement!);
    for (const field of item.response_fields ?? []) {
      const input = question.getByLabelText(field.label);
      expect(screen.getByText(field.label)).toBeTruthy();
      fireEvent.change(input, { target: { value: expectedAnswers[field.field_id] } });
    }
  }
  for (const group of groups.slice(0, -1)) {
    expect(group.getAttribute("aria-orientation")).toBe("horizontal");
    fireEvent.click(within(group).getByRole("radio", { name: "Very confident" }));
  }
  expect(submit.disabled).toBe(true);
  fireEvent.click(within(groups.at(-1)!).getByRole("radio", { name: "Very confident" }));
  expect(submit.disabled).toBe(false);
  const textField = unifiedLesson.quiz_items.find(item => item.type === "experience")!.response_fields!.find(field => field.response_type === "text")!;
  const textInput = screen.getByLabelText(textField.label);
  fireEvent.change(textInput, { target: { value: "   " } });
  expect(submit.disabled).toBe(true);
  fireEvent.change(textInput, { target: { value: expectedAnswers[textField.field_id] } });
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  await screen.findByRole("button", { name: "Submitted" });
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts.map(([url]) => url)).toEqual(["/api/student-answers"]);
  expect(JSON.parse(posts[0][1].body)).toMatchObject({ lessonNumber: 2, answers: expectedAnswers });
  for (const control of [...screen.getAllByRole("textbox"), ...screen.queryAllByRole("combobox"), ...screen.getAllByRole("radio")]) {
    expect((control as HTMLInputElement).disabled).toBe(true);
  }
  await waitFor(() => expect(onProgress).toHaveBeenLastCalledWith({ kind: "completed" }));
});

it("restores unified quiz text and confidence responses as a completed submission", async () => {
  const unifiedLesson = mockUnifiedQuiz();
  savedAnswers = completeUnifiedAnswers(unifiedLesson);
  render(<StudentQuizView user={user} />);
  await screen.findByRole("button", { name: "Submitted" });
  for (const item of unifiedLesson.quiz_items.filter(item => item.type === "experience")) {
    const question = within(screen.getByText(item.stem).parentElement!);
    for (const field of item.response_fields ?? []) {
      const input = question.getByLabelText(field.label) as HTMLInputElement;
      expect(input.value).toBe(savedAnswers[field.field_id]);
      expect(input.disabled).toBe(true);
    }
  }
  for (const group of screen.getAllByRole("radiogroup")) {
    const selected = within(group).getByRole("radio", { name: "Very confident" }) as HTMLButtonElement;
    expect(selected.getAttribute("aria-checked")).toBe("true");
    expect(selected.disabled).toBe(true);
  }
  expect(fetchMock.mock.calls.some(([url, init]) => url.startsWith("/api/surveys") || init?.method === "POST")).toBe(false);
});

it("keeps older answers editable when a newly published quiz still needs experience answers", async () => {
  const unifiedLesson = mockUnifiedQuiz();
  savedAnswers = Object.fromEntries(getQuizItemsForVersion(unifiedLesson.quiz_items).map(item => [item.item_id, "A"]));
  const onProgress = vi.fn();
  render(<StudentQuizView user={user} onProgress={onProgress} />);
  const groups = await screen.findAllByRole("radiogroup");
  expect(groups).toHaveLength(7);
  expect(screen.queryByText("Your answers have been submitted.")).toBeNull();
  const submit = screen.getByRole("button", { name: "Submit answers" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  for (const field of screen.getAllByRole("textbox")) expect((field as HTMLInputElement).disabled).toBe(false);
  expect(within(groups[0]).getByRole("radio", { name: "Very confident" }).getAttribute("aria-checked")).toBe("true");
  await waitFor(() => expect(onProgress).toHaveBeenLastCalledWith({ kind: "active" }));
});

it("keeps an unpublished unified quiz empty without fetching or displaying a legacy survey", async () => {
  mockUnifiedQuiz("draft");
  render(<StudentQuizView user={user} />);
  await screen.findByText("No quiz available yet");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("radiogroup")).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => url.startsWith("/api/surveys") || url.startsWith("/api/lessons/"))).toBe(false);
});


it.each([true, false])("loads a quiz upgrade without a reload and preserves answers (previously submitted: %s)", async (previouslySubmitted) => {
  const unifiedLesson = getLesson(2)!;
  const legacyItems = getQuizItemsForVersion(unifiedLesson.quiz_items);
  let version: number | undefined;
  if (previouslySubmitted) savedAnswers = Object.fromEntries(legacyItems.map(item => [item.item_id, "A"]));
  const originalFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/quiz-status")) return reply({ quizStatus: { lesson_number: 2, status: "published", quiz_version: version } });
    if (url.startsWith("/api/lessons/")) return reply(unifiedLesson);
    if (url.startsWith("/api/surveys?")) return reply({ surveys: [] });
    return originalFetch(url, init);
  });
  vi.useFakeTimers();
  const onProgress = vi.fn();
  await act(async () => { render(<StudentQuizView user={user} onProgress={onProgress} />); });
  expect(screen.getAllByRole("radiogroup")).toHaveLength(4);
  if (previouslySubmitted) {
    expect(screen.getByRole("button", { name: "Submitted" })).toBeTruthy();
  } else {
    for (const item of legacyItems.filter(item => item.type === "multiple_choice")) {
      fireEvent.click(within(screen.getByText(item.stem).parentElement!).getByRole("button", { name: `A${item.options.A}` }));
    }
    for (const group of screen.getAllByRole("radiogroup")) fireEvent.click(within(group).getByRole("radio", { name: "Very confident" }));
  }
  version = CURRENT_QUIZ_VERSION;
  await act(async () => {
    if (previouslySubmitted) fireEvent.focus(window);
    else await vi.advanceTimersByTimeAsync(15000);
  });
  expect(screen.getAllByRole("radiogroup")).toHaveLength(7);
  expect(screen.queryByText("Your answers have been submitted.")).toBeNull();
  expect(onProgress).toHaveBeenLastCalledWith({ kind: "active" });
  const submit = screen.getByRole("button", { name: "Submit answers" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  for (const group of screen.getAllByRole("radiogroup").slice(0, 4)) {
    expect(within(group).getByRole("radio", { name: "Very confident" }).getAttribute("aria-checked")).toBe("true");
  }
  const expectedAnswers = completeUnifiedAnswers(unifiedLesson);
  for (const item of unifiedLesson.quiz_items.filter(item => item.type === "experience")) {
    const question = within(screen.getByText(item.stem).parentElement!);
    for (const field of item.response_fields ?? []) fireEvent.change(question.getByLabelText(field.label), { target: { value: expectedAnswers[field.field_id] } });
  }
  for (const group of screen.getAllByRole("radiogroup").slice(4)) fireEvent.click(within(group).getByRole("radio", { name: "Very confident" }));
  expect(submit.disabled).toBe(false);
  await act(async () => { fireEvent.click(submit); });
  expect(screen.getByRole("button", { name: "Submitted" })).toBeTruthy();
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts.map(([url]) => url)).toEqual(["/api/student-answers"]);
  expect(JSON.parse(posts[0][1].body).answers).toEqual(expectedAnswers);
});


it.each([
  { assignmentId: "task-b" },
  { classId: "class-b" },
  { userId: "student-b" },
])("isolates same-lesson drafts when the assessment context changes: %j", async (newContext) => {
  const unifiedLesson = mockUnifiedQuiz();
  const field = unifiedLesson.quiz_items.find(item => item.type === "experience")!.response_fields![0];
  const { rerender } = render(<StudentQuizView user={user} />);
  fireEvent.change(await screen.findByLabelText(field.label), { target: { value: "Private answer in the previous task" } });
  fireEvent.click(within(screen.getAllByRole("radiogroup")[0]).getByRole("radio", { name: "Very confident" }));
  rerender(<StudentQuizView user={{ ...user, ...newContext }} />);
  const input = await screen.findByLabelText(field.label) as HTMLInputElement;
  expect(input.value).toBe("");
  for (const radio of screen.getAllByRole("radio")) expect(radio.getAttribute("aria-checked")).toBe("false");
  expect((screen.getByRole("button", { name: "Submit answers" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});
