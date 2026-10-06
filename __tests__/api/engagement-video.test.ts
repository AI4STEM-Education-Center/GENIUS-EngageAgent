import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { conflictActivity, bridgingActivity } from "../fixtures/material-activities";
import { buildMaterialVideoInstructions } from "@/lib/material-video";

vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null) }));
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { POST } from "@/app/api/engagement-video/route";

const fetchMock = vi.fn();
const request = (body: unknown) => new Request("http://localhost/api/engagement-video", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GROK_API_KEY", "test-video-key");
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(guardWorkspaceRequest).mockResolvedValue(null);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ request_id: "video-1" }), { status: 200 }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("strategy-aware material videos", () => {
  it.each([["cognitive conflict", conflictActivity], ["experience bridging", bridgingActivity]] as const)("passes the actual %s activity to the video provider", async (strategy, activity) => {
    const item = { id: "material-1", type: "Inquiry activity", title: "Look closely", body: "Student task", strategy, activity };
    const response = await POST(request({ item, imageUrl: "https://example.org/source.webp" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requestId: "video-1", contentItemId: item.id });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.prompt).toBe(buildMaterialVideoInstructions(item));
    expect(sent.prompt).toContain(activity.image.panels![0].description);
    expect(sent.prompt).toContain("Keep the camera stable");
    expect(sent.prompt).not.toContain("Focus on subtle movement");
    expect(sent.duration).toBe(4);
    expect(sent.image.url).toBe("https://example.org/source.webp");
    if (strategy === "cognitive conflict") {
      expect(sent.prompt).toContain(activity.observedOutcome);
      expect(sent.prompt).toContain("AFTER the application has collected");
    } else {
      expect(sent.prompt).toContain("BEFORE the concept is named in stage 3");
      expect(sent.prompt).not.toContain(activity.stages.find(stage => stage.id === "name")!.text);
      expect(sent.prompt).not.toContain(activity.stages.find(stage => stage.id === "connect")!.text);
    }
  });
  it("keeps legacy videos working without inventing a structured strategy", async () => {
    expect((await POST(request({ item: { id: "legacy", title: "Scene", body: "Observe" }, imageUrl: "https://example.org/scene.webp" }))).status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).prompt).toContain("Animate this student-facing still image");
  });
  it("does not silently animate an invalid strategy activity or malformed request", async () => {
    for (const body of [
      { item: null, imageUrl: "https://example.org/image.webp" },
      { item: { id: "bad" }, imageUrl: {} },
      { item: { id: "bad", strategy: "cognitive conflict", activity: { ...conflictActivity, image: { ...conflictActivity.image, revealAt: 0 } } }, imageUrl: "https://example.org/image.webp" },
    ]) expect((await POST(request(body))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("honors workspace denial before making a provider call", async () => {
    vi.mocked(guardWorkspaceRequest).mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await POST(request({ item: { id: "private" }, imageUrl: "https://example.org/image.webp" }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
