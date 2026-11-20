import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyTaskCompleted, notifyTaskCreated, notifyTaskReopened } from "@/lib/genius-notify";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notifyTaskCompleted", () => {
  it("sends the GENIUS identity using geniusId", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("window", { parent: { postMessage } });

    notifyTaskCompleted("class-1", "assignment-1", "genius-user-1");

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: "engage-agent.quiz-submitted",
        classId: "class-1",
        assignmentId: "assignment-1",
        geniusId: "genius-user-1",
      },
      "*",
    );
  });
});

it("notifies GENIUS of reopened material using the same exact assignment scope", () => {
  const postMessage = vi.fn();
  vi.stubGlobal("window", { parent: { postMessage } });
  notifyTaskReopened("class-1", "assignment-1", "student-1");
  expect(postMessage).toHaveBeenCalledWith({ type: "engage-agent.activity-reopened", classId: "class-1", assignmentId: "assignment-1", geniusId: "student-1" }, "*");
});

describe("standard-URL task messages on learn and staging", () => {
  const learn = "https://learn.ai4genius.org", staging = "https://staging.ai4genius.org";
  const task = { agentTaskId: "ea-agent-task-1", title: "Forces" };
  const message = { type: "genius.task-created", version: 1, agentId: "EngageAgent", agentTaskId: "ea-agent-task-1", title: "Forces" };
  const embed = (location: object, referrer = "") => {
    const postMessage = vi.fn();
    vi.stubGlobal("window", { parent: { postMessage }, location });
    vi.stubGlobal("document", { referrer });
    return postMessage;
  };
  it("sends only to staging when staging is the parent window", () => {
    const postMessage = embed({ ancestorOrigins: [staging] });
    expect(notifyTaskCreated(task, [learn, staging])).toBe(true);
    expect(postMessage.mock.calls).toEqual([[message, staging]]);
  });
  it("identifies the parent from the referrer when ancestorOrigins is unavailable", () => {
    const postMessage = embed({}, `${staging}/teacher/tasks/1`);
    notifyTaskCreated(task, [learn, staging]);
    expect(postMessage.mock.calls).toEqual([[message, staging]]);
  });
  it("sends to each configured GENIUS when the parent cannot be identified, never to *", () => {
    const postMessage = embed({}, "https://engageagent.ai4genius.org/create");
    notifyTaskCreated(task, [learn, "*", staging]);
    expect(postMessage.mock.calls).toEqual([[message, learn], [message, staging]]);
  });
  it("sends nothing without a configured GENIUS", () => {
    const postMessage = embed({ ancestorOrigins: [staging] });
    expect(notifyTaskCreated(task, [])).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
