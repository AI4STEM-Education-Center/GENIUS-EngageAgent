import { afterEach, expect, it, vi } from "vitest";
import { geniusEmbedOrigin, geniusEmbedOrigins } from "@/lib/session";

afterEach(() => vi.unstubAllEnvs());

it("uses GENIUS_EMBED_ORIGIN, falls back to GENIUS_URL, and never returns a wildcard", () => {
  vi.stubEnv("GENIUS_URL", "https://learn.example.edu/");
  vi.stubEnv("GENIUS_EMBED_ORIGIN", "");
  expect(geniusEmbedOrigin()).toBe("https://learn.example.edu");
  vi.stubEnv("GENIUS_EMBED_ORIGIN", "https://new-genius.example.edu/app/path");
  expect(geniusEmbedOrigin()).toBe("https://new-genius.example.edu");
  for (const value of ["*", "not a url", "javascript:alert(1)", "file:///etc"]) {
    vi.stubEnv("GENIUS_EMBED_ORIGIN", value);
    expect(geniusEmbedOrigin()).toBeNull();
  }
});

it("lists the configured GENIUS first, then the other sites allowed to embed EngageAgent", () => {
  vi.stubEnv("GENIUS_URL", "https://learn.ai4genius.org");
  vi.stubEnv("GENIUS_EMBED_ORIGIN", "");
  vi.stubEnv("ENGAGE_APP_URL", "https://engageagent.ai4genius.org");
  vi.stubEnv("ALLOWED_ORIGINS", "https://engageagent.ai4genius.org, https://learn.ai4genius.org, https://staging.ai4genius.org/, *, not a url");
  expect(geniusEmbedOrigins()).toEqual(["https://learn.ai4genius.org", "https://staging.ai4genius.org"]);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ALLOWED_ORIGINS", "http://insecure.example");
  expect(geniusEmbedOrigins()).toEqual(["https://learn.ai4genius.org"]);
});
