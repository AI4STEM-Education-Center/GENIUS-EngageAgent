import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { existingGenerationKey, resolveSlideModel, slideModelCatalog, slideTextRequestLimits, slideTextSettings } from "@/lib/slides/model-config";
beforeEach(() => { for (const key of ["OPENAI_MODEL", "OPENAI_SLIDES_MODEL", "OPENAI_IMAGE_MODEL", "OPENAI_API_KEY"]) vi.stubEnv(key, ""); });
afterEach(() => vi.unstubAllEnvs());
it("uses the Slides Sol default without changing or inheriting the generic project model", () => {
  vi.stubEnv("OPENAI_MODEL", "gpt-5-nano"); vi.stubEnv("OPENAI_SLIDES_MODEL", "   ");
  expect(resolveSlideModel("text", "current")).toBe("gpt-6.1-sol");
  expect(resolveSlideModel("text", undefined)).toBe("gpt-6.1-sol");
  expect(resolveSlideModel("image", undefined)).toBe("gpt-image-1");
  expect(process.env.OPENAI_MODEL).toBe("gpt-5-nano");
  expect(resolveSlideModel("text", "gpt-4.1")).toBe("gpt-4.1");
  expect(slideModelCatalog().text[0].label).toBe("Slides default (gpt-6.1-sol)");
});
it("preserves an explicit slides override and allows independent quality and balanced choices", () => {
  vi.stubEnv("OPENAI_SLIDES_MODEL", " gpt-5-mini ");
  expect(resolveSlideModel("text", "current")).toBe("gpt-5-mini");
  for (const model of ["gpt-6-astra", "gpt-6.1-sol"]) expect(resolveSlideModel("text", model)).toBe(model);
  expect(slideModelCatalog().text).toContainEqual({ id: "gpt-6-astra", label: "OpenAI - gpt-6-astra (quality)" });
  expect(slideModelCatalog().text).toContainEqual({ id: "gpt-6.1-sol", label: "OpenAI - gpt-6.1-sol (balanced)" });
});
it.each(["gpt-6-astra", "gpt-6.1-sol"])("gives %s explicit reasoning and bounded headroom", model => {
  expect(slideTextSettings(model)).toEqual({ reasoning_effort: "low" });
  expect(slideTextRequestLimits(model, "generate")).toEqual({ timeoutMs: 110_000, maxCompletionTokens: 12_000 });
  expect(slideTextRequestLimits(model, "check")).toEqual({ timeoutMs: 110_000, maxCompletionTokens: 8_000 });
});
it("does not give later or unrelated model families an incompatible reasoning setting", () => {
  expect(slideTextSettings("gpt-5-mini")).toEqual({ reasoning_effort: "low" });
  expect(slideTextSettings("gpt-5-nano-2025-08-07")).toEqual({ reasoning_effort: "low" });
  for (const model of ["gpt-4.1", "gpt-5.1", "gpt-5.2", "gpt-5.5", "gpt-6-future", "custom-model"]) expect(slideTextSettings(model)).toEqual({});
});
it.each(["gpt-4.1", "gpt-5-mini", "custom-model"])("preserves the existing limits for %s", model => {
  expect(slideTextRequestLimits(model, "generate")).toEqual({ timeoutMs: 50_000, maxCompletionTokens: 4200 });
  expect(slideTextRequestLimits(model, "check")).toEqual({ timeoutMs: 50_000, maxCompletionTokens: 3200 });
});
it("requires the EXISTING key and keeps it out of the catalog", () => {
  expect(() => existingGenerationKey()).toThrow("no separate Slides key");
  vi.stubEnv("OPENAI_API_KEY", "existing-project-key");
  expect(existingGenerationKey()).toBe("existing-project-key");
  expect(JSON.stringify(slideModelCatalog())).not.toContain("existing-project-key");
});
