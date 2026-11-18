import { appendFileSync } from "node:fs";
// Amplify's SSR runtime requires build-time variables in .env.production.
// The live GENIUS service uses GENIUS_URL and the existing SSO trust; an explicit
// disabled mode is a rollback switch. Legacy adapters remain optional.
const rows = ["GENIUS_CONTEXT_MODE", "GENIUS_CONTEXT_ENDPOINT", "GENIUS_CONTEXT_TOKEN"].flatMap(name => {
  const value = process.env[name]?.trim();
  return value ? [`${name}=${JSON.stringify(value).replace(/\$/gu, "\\$")}`] : [];
});
if (rows.length) appendFileSync(".env.production", `\n${rows.join("\n")}\n`);
