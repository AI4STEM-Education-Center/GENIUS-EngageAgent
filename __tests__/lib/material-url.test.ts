import { afterEach, expect, it, vi } from "vitest";
import { isSafeMaterialUrl } from "@/lib/material-url";
afterEach(() => vi.unstubAllEnvs());
it("permits only HTTPS or the exact signed local endpoint in development", () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(isSafeMaterialUrl("https://private.example/asset?signature=test")).toBe(true);
  expect(isSafeMaterialUrl("/api/local-material-assets?ticket=header.payload.signature")).toBe(true);
  for (const url of ["http://localhost:3104/anything", "http://other.example/asset", "//other.example/asset", "/api/local-material-assets?ticket=../path", "/api/local-material-assets?ticket=h.p.s&extra=1", "https://user:password@example.com/file", "javascript:alert(1)"]) {
    expect(isSafeMaterialUrl(url)).toBe(false);
  }
});
it("never permits local relative capability URLs in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(isSafeMaterialUrl("/api/local-material-assets?ticket=header.payload.signature")).toBe(false);
  expect(isSafeMaterialUrl("https://private.example/material")).toBe(true);
});
