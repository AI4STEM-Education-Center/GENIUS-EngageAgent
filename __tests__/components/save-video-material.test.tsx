// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/material-gallery-client", () => ({ createPrivateVideoCopy: mocks.create, saveGalleryCopy: mocks.save }));
import SaveVideoMaterial from "@/app/components/SaveVideoMaterial";
import type { ContentItem } from "@/lib/types";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each([undefined, 8])("saves legacy lesson context without overwriting a recorded video lesson (%s)", async lessonNumber => {
  const item: ContentItem = { id: "generated-video", type: "activity", title: "A bounce", body: "Compare contact", strategy: "cognitive conflict", lessonNumber };
  const source = { templateId: "private-source", title: item.title, revision: 1, mode: "use", private: true };
  mocks.create.mockImplementation(async (_scope, material) => ({ format: "video", source, item: { ...material, id: "gallery-copy-example", gallerySource: source }, media: { video: "https://example.com/video.mp4" } }));
  mocks.save.mockResolvedValue({ revision: 1 });
  render(<SaveVideoMaterial scope={{ classId: "ea-class-test", assignmentId: "ea-task-test" }} item={item} lessonNumber={3} />);
  fireEvent.click(screen.getByRole("button", { name: "Save to my materials" }));
  await screen.findByText("Saved to My saved materials. You can reopen it from Gallery in any class.");
  expect(mocks.create.mock.calls[0][1].lessonNumber).toBe(lessonNumber ?? 3);
  expect(mocks.save.mock.calls[0][1].item.lessonNumber).toBe(lessonNumber ?? 3);
  expect(item.lessonNumber).toBe(lessonNumber);
});
