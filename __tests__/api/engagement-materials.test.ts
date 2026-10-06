import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { analogyActivity, conflictActivity, bridgingActivity } from "../fixtures/material-activities";

const { complete, generate, edit } = vi.hoisted(() => ({ complete: vi.fn(), generate: vi.fn(), edit: vi.fn() }));
vi.mock("openai", () => ({ default: class { chat = { completions: { create: complete } }; images = { generate, edit }; }, toFile: vi.fn(async () => "image-input") }));
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null) }));
vi.mock("@/lib/nosql", () => ({ listStudentAnswers: vi.fn(async () => []), getMedia: vi.fn(), upsertMedia: vi.fn() }));
import { POST as content } from "@/app/api/engagement-content/route";
import { POST as image } from "@/app/api/engagement-image/route";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { listStudentAnswers } from "@/lib/nosql";

const request = (fields: unknown) => new Request("http://localhost/api/engagement-content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
const completion = (items: unknown) => ({ choices: [{ message: { content: JSON.stringify({ items }) } }] });
const fixtureCases = [["analogy", analogyActivity], ["cognitive conflict", conflictActivity], ["experience bridging", bridgingActivity]] as const;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.mocked(guardWorkspaceRequest).mockResolvedValue(null);
  generate.mockResolvedValue({ data: [{ b64_json: "dGVzdA==" }] });
  edit.mockResolvedValue({ data: [{ b64_json: "dGVzdA==" }] });
  vi.mocked(listStudentAnswers).mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("source-aligned material APIs", () => {
  it("uses the reviewed draft, shares a bounded timeout, and never returns an unreviewed draft on review failure", async () => {
    complete.mockResolvedValueOnce(completion([{ title: "Unreviewed", activity: analogyActivity }]))
      .mockResolvedValueOnce(completion([{ title: "Reviewed", activity: analogyActivity }]));
    const response = await content(request({ lessonNumber: 3, selectedStrategies: ["analogy"] }));
    expect((await response.json()).items[0].title).toBe("Reviewed");
    expect(complete.mock.calls[1][0].model).toBe("gpt-4.1");
    expect(complete.mock.calls[0][1].signal).toBe(complete.mock.calls[1][1].signal);
    expect(complete.mock.calls[0][0].response_format.type).toBe("json_schema");
    complete.mockResolvedValueOnce(completion([{ title: "Unreviewed", activity: analogyActivity }])).mockRejectedValueOnce(new Error("Review unavailable"));
    expect((await content(request({ lessonNumber: 3, selectedStrategies: ["analogy"] }))).status).toBe(500);
  });
  it("passes a definite initial disclosure to the selected reviewer and accepts its corrected draft", async () => {
    const leak = { ...conflictActivity, stages: conflictActivity.stages.map((stage, index) => index === 0 ? { ...stage, text: "A hand presses the ball so the ball squashes against the table." } : stage) };
    complete.mockResolvedValueOnce(completion([{ title: "Contact", activity: leak }]))
      .mockResolvedValueOnce(completion([{ title: "Contact", activity: conflictActivity }]));
    const response = await content(request({ lessonNumber: 3, selectedStrategies: ["cognitive conflict"] }));
    expect(response.status).toBe(200);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0].messages[0].content).toContain("SELECTED METHOD — check this before");
    expect(complete.mock.calls[1][0].messages[1].content).toContain("Definite generation-gate findings to repair");
  });
  it("repairs a reviewer-introduced leak once within the original deadline and never returns a still-flawed draft", async () => {
    const leak = { ...conflictActivity, stages: conflictActivity.stages.map((stage, index) => index === 0 ? { ...stage, text: "The hand presses down so the ball squashes against the table." } : stage) };
    complete.mockResolvedValueOnce(completion([{ title: "Contact", activity: conflictActivity }]))
      .mockResolvedValueOnce(completion([{ title: "Contact", activity: leak }]))
      .mockResolvedValueOnce(completion([{ title: "Contact", activity: conflictActivity }]));
    expect((await content(request({ lessonNumber: 3, selectedStrategies: ["cognitive conflict"] }))).status).toBe(200);
    expect(complete).toHaveBeenCalledTimes(3);
    const signal = complete.mock.calls[0][1].signal;
    expect(complete.mock.calls.every(call => call[1].signal === signal && call[1].maxRetries === 0)).toBe(true);
    complete.mockClear();
    complete.mockResolvedValue(completion([{ title: "Contact", activity: leak }]));
    const refused = await content(request({ lessonNumber: 3, selectedStrategies: ["cognitive conflict"] }));
    expect(refused.status).toBe(500);
    expect((await refused.json()).items).toBeUndefined();
    expect(complete).toHaveBeenCalledTimes(3);
  });
  it("does not extend or ignore the shared timeout during an additional repair", async () => {
    const leak = { ...conflictActivity, stages: conflictActivity.stages.map((stage, index) => index === 0 ? { ...stage, text: "The ball squashes against the table during contact." } : stage) };
    complete.mockResolvedValueOnce(completion([{ title: "Contact", activity: conflictActivity }]))
      .mockResolvedValueOnce(completion([{ title: "Contact", activity: leak }]))
      .mockRejectedValueOnce(new DOMException("The shared request budget elapsed", "TimeoutError"));
    const response = await content(request({ lessonNumber: 3, selectedStrategies: ["cognitive conflict"] }));
    expect(response.status).toBe(500);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(complete.mock.calls[2][1].signal).toBe(complete.mock.calls[0][1].signal);
    expect((await response.json()).items).toBeUndefined();
  });
  it.each(fixtureCases)("generates and illustrates %s while preserving the structured activity", async (strategy, activity) => {
    complete.mockResolvedValue(completion([{ title: "An observation", body: "Opening", activity, textModes: ["questions", "invalid"] }]));
    const response = await content(request({ lessonNumber: 3, selectedStrategies: [strategy] }));
    expect(response.status).toBe(200);
    const { items } = await response.json();
    expect(items[0].activity).toEqual(activity);
    expect(items[0].body).toContain(activity.stages.at(-1)!.text);
    expect(items[0].textModes).toEqual(["questions"]);
    const imageResponse = await image(request({ item: { ...items[0], id: "fixture" }, lessonNumber: 3 }));
    expect(imageResponse.status).toBe(200);
    for (const panel of activity.image.panels!) expect(generate.mock.calls[0][0].prompt).toContain(panel.description);
    expect(generate.mock.calls[0][0].prompt).toContain("zero text");
    expect(generate.mock.calls[0][0].size).toBe("1536x1024");
    expect(generate.mock.calls[0][0].quality).toBe("medium");
  });
  it("retains the legacy fourth strategy and client-driven fallback model", async () => {
    vi.stubEnv("OPENAI_FALLBACK_MODEL", "fallback-test");
    complete.mockResolvedValue(completion([{ title: "Critique", body: "Compare these claims.", type: "Questions" }]));
    const response = await content(request({ lessonNumber: 1, selectedStrategies: ["engaged critiquing"], fallback: true }));
    expect(response.status).toBe(200);
    expect((await response.json()).items[0].activity).toBeUndefined();
    expect(complete.mock.calls[0][0].model).toBe("fallback-test");
  });
  it("does not return success for empty, incomplete, or wrong-order generation", async () => {
    for (const items of [[], [{ body: "Text but no stages" }], [{ title: "Invalid", activity: { ...analogyActivity, stages: [...analogyActivity.stages].reverse() } }]]) {
      complete.mockResolvedValue(completion(items));
      expect((await content(request({ lessonNumber: 3, selectedStrategies: ["analogy"] }))).status).toBe(500);
    }
  });
  it("rejects invalid request shapes before calling the model", async () => {
    for (const fields of [{ lessonNumber: 3, selectedStrategies: "analogy" }, { lessonNumber: 3, selectedStrategies: [null] }, { lessonNumber: 999, selectedStrategies: ["analogy"] }, { lessonNumber: 3, selectedStrategies: [] },
      { lessonNumber: 3, selectedStrategies: ["experience bridging"], classroomContext: { survey: "unvalidated" } },
      { lessonNumber: 3, selectedStrategies: ["experience bridging"], classroomContext: "x".repeat(1201) },
    ]) {
      expect((await content(request(fields))).status).toBe(400);
    }
    expect(complete).not.toHaveBeenCalled();
  });
  it("passes teacher-provided experience context to generation and review without claiming a verified survey", async () => {
    const classroomContext = "Grade 8. Teacher survey summary: learners mentioned carrying backpacks and sitting on soft seats.";
    complete.mockResolvedValue(completion([{ title: "A seat you remember", activity: bridgingActivity }]));
    expect((await content(request({ lessonNumber: 3, selectedStrategies: ["experience bridging"], classroomContext }))).status).toBe(200);
    for (const [input] of complete.mock.calls) {
      const user = input.messages.find((message: { role: string }) => message.role === "user").content;
      expect(user).toContain(classroomContext);
      expect(user).toContain("survey origin and individual familiarity are not independently verified");
      expect(user).toContain("Name the target scientific concept ONLY in stage 3");
    }
    expect(listStudentAnswers).not.toHaveBeenCalled();
  });
  it("rejects unsupported strategies instead of silently using a generic prompt", async () => {
    expect((await content(request({ lessonNumber: 3, selectedStrategies: ["analogy", "unknown strategy"] }))).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
    expect(listStudentAnswers).not.toHaveBeenCalled();
  });
  it("uses only the authorized class, task and lesson diagnostics, never names or GENIUS IDs", async () => {
    vi.mocked(listStudentAnswers).mockResolvedValue([
      { student_id: "secret-id", student_name: "Private Student", class_id: "ea-class-c1", assignment_id: "a1", lesson_number: 1, answers: { L1_Q1: "D" }, submitted_at: "" },
      { student_id: "another-id", student_name: "Other Student", class_id: "ea-class-c1", assignment_id: "a1", lesson_number: 2, answers: {}, submitted_at: "" },
      { student_id: "wrong-class", student_name: "Other Class", class_id: "ea-class-other", assignment_id: "a1", lesson_number: 1, answers: { L1_Q1: "D" }, submitted_at: "" },
      { student_id: "wrong-task", student_name: "Other Task", class_id: "ea-class-c1", assignment_id: "a2", lesson_number: 1, answers: { L1_Q1: "D" }, submitted_at: "" },
    ]);
    complete.mockResolvedValue(completion([{ title: "Observe", activity: conflictActivity }]));
    expect((await content(request({ lessonNumber: 1, selectedStrategies: ["cognitive conflict"], classId: "ea-class-c1", assignmentId: "a1" }))).status).toBe(200);
    expect(listStudentAnswers).toHaveBeenCalledWith("ea-class-c1", "a1");
    const sent = JSON.stringify(complete.mock.calls[0][0].messages);
    expect(sent).toContain("weak because nothing");
    expect(sent).not.toContain("Private Student");
    expect(sent).not.toContain("secret-id");
    expect(sent).not.toContain("Other Student");
    const context = JSON.parse(complete.mock.calls[0][0].messages[1].content.split("\n")[1]);
    expect(context.diagnostic.responses).toBe(1);
    expect(context.diagnostic.selections).toHaveLength(1);
    expect(context.diagnostic.selections[0].count).toBe(1);
    expect(sent).not.toMatch(/wrong-class|wrong-task|Other Class|Other Task/);
  });
  it("does not read private diagnostics for legacy non-workspace identifiers", async () => {
    complete.mockResolvedValue(completion([{ title: "Observe", activity: conflictActivity }]));
    expect((await content(request({ lessonNumber: 1, selectedStrategies: ["cognitive conflict"], classId: "c1", assignmentId: "a1" }))).status).toBe(200);
    expect(listStudentAnswers).not.toHaveBeenCalled();
    expect(JSON.stringify(complete.mock.calls[0][0].messages)).toContain('\\"responses\\":0');
  });
  it("fails closed without exposing storage details when authorized diagnostics cannot be read", async () => {
    vi.mocked(listStudentAnswers).mockRejectedValueOnce(new Error("private-storage-configuration-detail"));
    const response = await content(request({ lessonNumber: 3, selectedStrategies: ["cognitive conflict"], classId: "ea-class-c1", assignmentId: "a1" }));
    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result.error).toContain("Class diagnostics are temporarily unavailable");
    expect(JSON.stringify(result)).not.toContain("private-storage-configuration-detail");
    expect(result.items).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
  });
  it("does not generate or read responses when workspace authorization denies the request", async () => {
    vi.mocked(guardWorkspaceRequest).mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await content(request({ lessonNumber: 3, selectedStrategies: ["analogy"] }))).status).toBe(403);
    expect((await image(request({ item: {} }))).status).toBe(403);
    expect(complete).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(listStudentAnswers).not.toHaveBeenCalled();
  });
  it("preserves image refinement instead of replacing it with initial generation", async () => {
    expect((await image(request({ item: { id: "a1" }, refinementPrompt: "Make the ball red", previousImageUrl: "data:image/webp;base64,dGVzdA==" }))).status).toBe(200);
    expect(edit.mock.calls[0][0].prompt).toBe("Make the ball red");
    expect(edit.mock.calls[0][0].size).toBe("1024x1024");
    expect(generate).not.toHaveBeenCalled();
  });
  it("supports an explicit material image quality override without changing legacy generation or edits", async () => {
    vi.stubEnv("OPENAI_MATERIAL_IMAGE_QUALITY", "high");
    const item = { type: "Inquiry", strategy: "analogy", title: "Observe", body: "Observe.", activity: analogyActivity };
    expect((await image(request({ item, lessonNumber: 3 }))).status).toBe(200);
    expect(generate.mock.calls.at(-1)![0].quality).toBe("high");
    expect((await image(request({ item: { ...item, activity: undefined }, lessonNumber: 3 }))).status).toBe(200);
    expect(generate.mock.calls.at(-1)![0].quality).toBe("low");
    expect((await image(request({ item, refinementPrompt: "Make the ball red", previousImageUrl: "data:image/webp;base64,dGVzdA==" }))).status).toBe(200);
    expect(edit.mock.calls.at(-1)![0].quality).toBe("low");
    expect(edit.mock.calls.at(-1)![0].size).toBe("1536x1024");
    vi.stubEnv("OPENAI_MATERIAL_IMAGE_QUALITY", "invalid");
    expect((await image(request({ item, lessonNumber: 3 }))).status).toBe(500);
  });
});
