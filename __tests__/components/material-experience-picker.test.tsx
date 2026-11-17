// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MaterialExperiencePicker from "@/app/components/MaterialExperiencePicker";
const props = { classId: "class", assignmentId: "task", lessonNumber: 3, strategy: "analogy", focus: { misconceptions: [], coreIdeas: [0] },
  interests: null, value: "", onChange: vi.fn() };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("keeps manual entry usable while suggestions load and allows retry after a timeout", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  })));
  render(<MaterialExperiencePicker {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Suggest experiences" }));
  const input = screen.getByRole("textbox", { name: "Familiar experience" });
  expect(input).toHaveProperty("disabled", false);
  fireEvent.change(input, { target: { value: "Catching a soft ball" } });
  expect(props.onChange).toHaveBeenCalledWith("Catching a soft ball", "teacher_entered");
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByRole("alert").textContent).toContain("Suggestions took too long");
  expect(screen.getByRole("button", { name: "Suggest experiences" })).toHaveProperty("disabled", false);
});
