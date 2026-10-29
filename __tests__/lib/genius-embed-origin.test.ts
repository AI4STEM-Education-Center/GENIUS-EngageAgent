import { afterEach, expect, it, vi } from "vitest";
import { geniusEmbedOrigin } from "@/lib/session";

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
