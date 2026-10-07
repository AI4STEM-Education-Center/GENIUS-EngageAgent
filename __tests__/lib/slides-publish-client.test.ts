import { clearVerifiedClientAuth, setVerifiedClientAuth } from "@/lib/client-auth";
import type { UserContext as EmbeddedUserContext } from "@/lib/auth";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { publishSlideDeck } from "@/lib/slides/publish-client";
import { deckFixture } from "../fixtures/slides";

const scope = { classId: "ea-class-a", assignmentId: "ea-task-a" };
const id = "4e96360b-17a4-4a54-84da-df0c5d2ef012";
const fetchMock = vi.fn();
const reply = (data: unknown, ok = true) => ({ ok, json: async () => data });
const deck = () => deckFixture("analogy");
const finished = (publicationId = id) => ({ publicationId, contentItemId: "slides-test-deck", slides: { publicationId, lessonNumber: 8, slideCount: 5 } });
beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (_path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return reply(body.operation === "start" ? { publicationId: id } : body.operation === "asset"
      ? { publicationId: id, visualId: body.visualId } : finished());
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("publishes a deck with advisory findings without a teacher note and keeps review metadata out of transport", async () => {
  const value = deck(); value.classroomContext = "Private class context";
  value.assets.target.referenceData = "Private reference";
  value.checks!.text!.issues = ["PRIVATE_REVIEW_TEXT: consider shortening this question."];
  value.checks!.images.target.issues = ["PRIVATE_REVIEW_IMAGE: inspect the contact geometry."];
  expect(value.teacherDecision).toBeUndefined();
  const progress = vi.fn();
  expect(await publishSlideDeck(value, scope, new AbortController().signal, progress)).toEqual(finished());
  const bodies = fetchMock.mock.calls.map(([path, init]) => {
    expect(path).toBe("/api/slides/publication");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" } });
    return JSON.parse(init.body);
  });
  expect(bodies.map(body => body.operation)).toEqual(["start", "asset", "asset", "asset", "commit"]);
  expect(bodies[0]).toEqual({ ...scope, operation: "start", deckId: value.id, lessonNumber: 8, strategy: "analogy", draft: value.draft,
    assets: { analogue: { width: 1536, height: 1024 }, target: { width: 1536, height: 1024 }, variation: { width: 1536, height: 1024 } } });
  for (let i = 1; i <= 3; i++) expect(bodies[i]).toEqual({ ...scope, operation: "asset", publicationId: id,
    visualId: value.draft.visuals[i - 1].id, asset: { data: value.assets.target.data, width: 1536, height: 1024 } });
  expect(bodies[4]).toEqual({ ...scope, operation: "commit", publicationId: id });
  expect(JSON.stringify(bodies)).not.toContain("Private class context");
  expect(JSON.stringify(bodies)).not.toContain("Private reference");
  expect(JSON.stringify(bodies)).not.toContain("PRIVATE_REVIEW_");
  expect(progress).toHaveBeenLastCalledWith("Making the slides available to students...");
});

it("does not commit or retry after an asset upload fails", async () => {
  fetchMock.mockResolvedValueOnce(reply({ publicationId: id })).mockResolvedValueOnce(reply({ error: "Image could not be stored." }, false));
  await expect(publishSlideDeck(deck(), scope, new AbortController().signal)).rejects.toThrow("Image could not be stored.");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.every(([, init]) => JSON.parse(init.body).operation !== "commit")).toBe(true);
});

it("requires every planned image and class/task scope before starting", async () => {
  const value = deck(); delete value.assets.target;
  await expect(publishSlideDeck(value, scope, new AbortController().signal)).rejects.toThrow("every slide image");
  await expect(publishSlideDeck(deck(), { classId: "", assignmentId: "" }, new AbortController().signal)).rejects.toThrow("class task");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects an oversized final image before starting or uploading earlier images, counting the full JSON request", async () => {
  const value = deck();
  const image = value.assets.variation;
  const prefix = "data:image/jpeg;base64,";
  const overhead = new TextEncoder().encode(JSON.stringify({ ...scope, operation: "asset", publicationId: id, visualId: "variation",
    asset: { data: "", width: image.width, height: image.height } })).byteLength;
  image.data = prefix + "A".repeat(4_400_001 - overhead - prefix.length);
  const original = image.data;
  expect(image.data.length).toBeLessThan(4_400_000);
  await expect(publishSlideDeck(value, scope, new AbortController().signal)).rejects.toThrow(
    "The variation image is too large for online publishing. Regenerate this image, then try sending again. Your draft is unchanged.");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(image.data).toBe(original);
});

it("rejects mismatched image acknowledgments before exposing any publication", async () => {
  fetchMock.mockResolvedValueOnce(reply({ publicationId: id })).mockResolvedValueOnce(reply({ publicationId: id, visualId: "wrong" }));
  await expect(publishSlideDeck(deck(), scope, new AbortController().signal)).rejects.toThrow("could not be confirmed");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does not upload images when start returns an invalid publication ticket", async () => {
  fetchMock.mockResolvedValueOnce(reply({ publicationId: "not-a-publication-uuid" }));
  await expect(publishSlideDeck(deck(), scope, new AbortController().signal)).rejects.toThrow("did not prepare");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  { ...finished(), contentItemId: "slides-different-deck" },
  { ...finished(), slides: { ...finished().slides, lessonNumber: 7 } },
  { ...finished(), slides: { ...finished().slides, slideCount: 4 } },
  { ...finished(), publicationId: "different-publication" },
])("rejects a commit response for a different snapshot", async result => {
  fetchMock.mockImplementation(async (_path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return reply(body.operation === "start" ? { publicationId: id } : body.operation === "asset"
      ? { publicationId: id, visualId: body.visualId } : result);
  });
  await expect(publishSlideDeck(deck(), scope, new AbortController().signal)).rejects.toThrow("did not confirm");
});

it("stops after a late response when its workspace is cancelled", async () => {
  let finish: (value: unknown) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const pending = publishSlideDeck(deck(), scope, controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  controller.abort(); finish(reply({ publicationId: id }));
  await rejected;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});

it("bounds an unresponsive publishing request without retrying", async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation((_path, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
  const pending = publishSlideDeck(deck(), scope, new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow("Publishing timed out");
  await vi.advanceTimersByTimeAsync(25_000); await rejected;
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

afterEach(clearVerifiedClientAuth);

it("authorizes every publication stage with the initial exact GENIUS scope", async () => {
  const host = { classId: "host-class", assignmentId: "host-task" };
  setVerifiedClientAuth("publish-token", host as EmbeddedUserContext);
  await publishSlideDeck(deck(), host, new AbortController().signal, () => {
    setVerifiedClientAuth("changed-token", { ...host, assignmentId: "different-task" } as EmbeddedUserContext);
  });
  expect(fetchMock.mock.calls).toHaveLength(5);
  for (const [url, init] of fetchMock.mock.calls) {
    expect(url).toBe("/api/slides/publication");
    expect(init.headers.Authorization).toBe("Bearer publish-token");
    expect(JSON.parse(init.body)).toMatchObject(host);
    expect(init.body).not.toContain("publish-token");
  }
});
