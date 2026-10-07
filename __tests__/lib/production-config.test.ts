import { describe, expect, it } from "vitest";
import { productionConfigErrors } from "../../scripts/check-production-config.mjs";

const ready = {
  OPENAI_API_KEY: "test-model-key", SSO_SECRET: "test-sso-secret",
  DYNAMODB_TABLE: "test-table", ENGAGE_S3_BUCKET: "test-private-bucket",
  ALLOWED_ORIGINS: "https://learn.ai4genius.org",
};

describe("Amplify production configuration preflight", () => {
  it("accepts the canonical defaults and an AWS runtime identity without static keys", () => {
    expect(productionConfigErrors(ready)).toEqual([]);
  });
  it("accepts a complete credential pair and matching custom HTTPS domains", () => {
    expect(productionConfigErrors({ ...ready, ENGAGE_AWS_ACCESS_KEY_ID: "key", ENGAGE_AWS_SECRET_ACCESS_KEY: "secret",
      ENGAGE_APP_URL: "https://engage.example.edu", GENIUS_URL: "https://learn.example.edu",
      ALLOWED_ORIGINS: "https://other.example.edu, https://learn.example.edu" })).toEqual([]);
  });
  it.each(["OPENAI_API_KEY", "SSO_SECRET", "DYNAMODB_TABLE", "ENGAGE_S3_BUCKET"])("rejects missing %s without disclosing configured secrets", (name) => {
    const errors = productionConfigErrors({ ...ready, [name]: "  " });
    expect(errors.some((error: string) => error.includes(name))).toBe(true);
    expect(errors.join(" ")).not.toContain(ready.OPENAI_API_KEY);
    expect(errors.join(" ")).not.toContain(ready.SSO_SECRET);
  });
  it.each(["http://localhost:3104", "https://engage.example.edu/", "https://engage.example.edu/task", "https://user:private@engage.example.edu", " https://engage.example.edu"])("rejects an origin that would break production identity: %s", (origin) => {
    expect(productionConfigErrors({ ...ready, ENGAGE_APP_URL: origin })).toEqual([
      expect.stringContaining("ENGAGE_APP_URL must be a canonical HTTPS origin"),
    ]);
  });
  it("rejects framing configuration that does not allow the actual GENIUS origin", () => {
    expect(productionConfigErrors({ ...ready, ALLOWED_ORIGINS: "https://unrelated.example.edu" }))
      .toEqual([expect.stringContaining("ALLOWED_ORIGINS")]);
  });
  it.each([{ ENGAGE_LOCAL_MATERIAL_STORAGE: "1" }, { ENGAGE_LOCAL_DATA_DIR: "/tmp/demo" }])("rejects local demo storage inputs", (local) => {
    expect(productionConfigErrors({ ...ready, ...local })).toEqual([expect.stringContaining("Remove ENGAGE_LOCAL")]);
  });
  it.each([{ ENGAGE_AWS_ACCESS_KEY_ID: "key" }, { ENGAGE_AWS_SECRET_ACCESS_KEY: "secret" }])("rejects a partial AWS credential override", (credentials) => {
    expect(productionConfigErrors({ ...ready, ...credentials })).toEqual([expect.stringContaining("Set both ENGAGE_AWS")]);
  });
});
