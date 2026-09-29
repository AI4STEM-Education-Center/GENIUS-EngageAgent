import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyTaskCompleted } from "@/lib/genius-notify";

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
