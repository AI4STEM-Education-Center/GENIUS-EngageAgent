import { appendFileSync } from "node:fs";
// Amplify's SSR runtime requires build-time variables in .env.production.
// Keep the optional provider disabled unless configured, and never print secrets.
const rows = ["GENIUS_CONTEXT_ENDPOINT", "GENIUS_CONTEXT_TOKEN"].flatMap(name => {
  const value = process.env[name]?.trim();
  return value ? [`${name}=${JSON.stringify(value).replace(/\$/gu, "\\$")}`] : [];
});
if (rows.length) appendFileSync(".env.production", `\n${rows.join("\n")}\n`);
