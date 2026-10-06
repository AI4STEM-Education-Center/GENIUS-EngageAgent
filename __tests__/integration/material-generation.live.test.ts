import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MATERIAL_STRATEGIES, parseGeneratedMaterialActivity } from "@/lib/material-activities";
import type { ContentItem } from "@/lib/types";

// Explicitly opt in: uses real provider credits, no class/student records or publication.
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null) }));
import { POST as content } from "@/app/api/engagement-content/route";
import { POST as image } from "@/app/api/engagement-image/route";

const enabled = process.env.RUN_MATERIAL_LIVE_TESTS === "1";
const imagesEnabled = enabled && process.env.RUN_MATERIAL_IMAGE_EVAL === "1";
const imagesOnly = process.env.MATERIAL_IMAGES_ONLY === "1";
const output = path.resolve(process.env.MATERIAL_EVAL_OUTPUT ?? "artifacts/material-evaluation/results");
const lessons = (process.env.MATERIAL_EVAL_LESSONS ?? "1,3,8").split(",").map(Number);
const primaryLesson = Number(process.env.MATERIAL_PRIMARY_LESSON ?? 3);
const generated = new Map<string, ContentItem>();
const request = (body: unknown) => new Request("http://localhost/api/engagement-content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  if (!enabled) return;
  if (imagesOnly && imagesEnabled) {
    for (const strategy of MATERIAL_STRATEGIES) {
      const saved = JSON.parse(await readFile(path.join(output, `${strategy.replaceAll(" ", "-")}-3.json`), "utf8"));
      generated.set(strategy, { ...saved.response.items[0], id: `${strategy}-3` });
    }
  }
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const response = await realFetch(input, init);
    if (String(input).includes("/chat/completions")) {
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, `raw-${Date.now()}.json`), JSON.stringify(await response.clone().json(), null, 2));
    }
    return response;
  });
});
afterAll(() => vi.restoreAllMocks());

describe.skipIf(!enabled)("live material evaluation (not a pedagogical effectiveness study)", () => {
  for (const strategy of MATERIAL_STRATEGIES) {
    for (const lessonNumber of lessons) {
      it.skipIf(imagesOnly)(`${strategy}: lesson ${lessonNumber}, fallback model`, async () => {
        expect(process.env.OPENAI_API_KEY, "OPENAI_API_KEY is required for an opted-in live run").toBeTruthy();
        const started = Date.now();
        const response = await content(request({ lessonNumber, selectedStrategies: [strategy], fallback: true }));
        const result = await response.json();
        const elapsedMs = Date.now() - started;
        await mkdir(output, { recursive: true });
        const item = result.items?.[0];
        const wordCount = item?.activity?.stages.map((stage: { text: string }) => stage.text).join(" ").split(/\s+/).length;
        await writeFile(path.join(output, `${strategy.replaceAll(" ", "-")}-${lessonNumber}.json`), JSON.stringify({ strategy, lessonNumber, model: process.env.OPENAI_FALLBACK_MODEL ?? "gpt-4.1", elapsedMs, wordCount, styleWarnings: wordCount < 120 || wordCount > 240 ? ["Outside the soft 120-240 word target; review clarity rather than padding text."] : [], response: result }, null, 2));
        expect(response.status, JSON.stringify(result)).toBe(200);
        expect(parseGeneratedMaterialActivity(item.activity, strategy)).toBeDefined();
        if (lessonNumber === 3) generated.set(strategy, { ...item, id: `${strategy}-3` });
        expect(wordCount).toBeGreaterThan(0);
        expect(item.activity.stages.at(-1).text).toMatch(/write one scientific question/i);
      }, 120_000);
    }
  }

  for (const strategy of MATERIAL_STRATEGIES) {
    it.skipIf(imagesOnly)(`${strategy}: primary model`, async () => {
      const started = Date.now();
      const response = await content(request({ lessonNumber: primaryLesson, selectedStrategies: [strategy] }));
      const result = await response.json();
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, `${strategy.replaceAll(" ", "-")}-primary.json`), JSON.stringify({ strategy, lessonNumber: primaryLesson, model: process.env.OPENAI_MODEL ?? "gpt-5-mini", elapsedMs: Date.now() - started, response: result }, null, 2));
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(parseGeneratedMaterialActivity(result.items?.[0]?.activity, strategy)).toBeDefined();
    }, 120_000);

    it.skipIf(!imagesEnabled)(`${strategy}: live image from generated text`, async () => {
      const item = generated.get(strategy);
      expect(item, "Generate lesson 3 text successfully first").toBeDefined();
      const started = Date.now();
      const response = await image(request({ item, lessonNumber: 3 }));
      const result = await response.json();
      await writeFile(path.join(output, `${strategy.replaceAll(" ", "-")}-3-image.json`), JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1", quality: process.env.OPENAI_MATERIAL_IMAGE_QUALITY ?? "medium", elapsedMs: Date.now() - started, status: response.status, error: result.error }, null, 2));
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(result.url).toMatch(/^data:image\/webp;base64,/);
      await writeFile(path.join(output, `${strategy.replaceAll(" ", "-")}-3.webp`), Buffer.from(result.url.split(",")[1], "base64"));
    }, 180_000);
  }
});

describe.skipIf(!enabled || process.env.RUN_MATERIAL_IMAGE_COMPARISON !== "1")("image quality comparison", () => {
  const strategy = process.env.MATERIAL_IMAGE_COMPARISON_STRATEGY ?? "analogy";
  for (const [model, quality] of [["gpt-image-1", "medium"], ["gpt-image-1", "high"], ["gpt-image-2", "medium"]]) {
    it(`${model} ${quality}, identical ${strategy} draft`, async () => {
      const saved = JSON.parse(await readFile(path.join(output, `${strategy.replaceAll(" ", "-")}-3.json`), "utf8"));
      vi.stubEnv("OPENAI_IMAGE_MODEL", model);
      vi.stubEnv("OPENAI_MATERIAL_IMAGE_QUALITY", quality);
      try {
        const started = Date.now();
        const response = await image(request({ item: saved.response.items[0], lessonNumber: 3 }));
        const result = await response.json();
        const prefix = path.join(output, `comparison-${strategy.replaceAll(" ", "-")}-${model}-${quality}`);
        await writeFile(`${prefix}.json`, JSON.stringify({ model, quality, elapsedMs: Date.now() - started, status: response.status, error: result.error }, null, 2));
        expect(response.status, JSON.stringify(result)).toBe(200);
        await writeFile(`${prefix}.webp`, Buffer.from(result.url.split(",")[1], "base64"));
      } finally {
        vi.unstubAllEnvs();
      }
    }, 180_000);
  }
});
