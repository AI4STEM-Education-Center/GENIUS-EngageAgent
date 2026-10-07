import { pathToFileURL } from "node:url";

/** Check deployment inputs without logging credentials or making service calls. */
export function productionConfigErrors(env) {
  const errors = [];
  const value = (name) => env[name]?.trim() || "";
  for (const name of ["OPENAI_API_KEY", "SSO_SECRET", "DYNAMODB_TABLE", "ENGAGE_S3_BUCKET"]) {
    if (!value(name)) errors.push(`${name} is required for production material generation and storage.`);
  }

  const origins = {};
  for (const [name, fallback] of [
    ["ENGAGE_APP_URL", "https://engageagent.ai4genius.org"],
    ["GENIUS_URL", "https://learn.ai4genius.org"],
  ]) {
    const configured = env[name] || fallback;
    try {
      const url = new URL(configured);
      if (url.protocol !== "https:" || url.origin !== configured ||
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error();
      origins[name] = url.origin;
    } catch {
      errors.push(`${name} must be a canonical HTTPS origin without a trailing slash, path, or credentials.`);
    }
  }
  const allowed = value("ALLOWED_ORIGINS").split(",").map((origin) => origin.trim());
  if (origins.GENIUS_URL && !allowed.includes(origins.GENIUS_URL)) {
    errors.push("ALLOWED_ORIGINS must include the exact GENIUS_URL origin so GENIUS can display EngageAgent.");
  }
  if (value("ENGAGE_LOCAL_MATERIAL_STORAGE") === "1" || value("ENGAGE_LOCAL_DATA_DIR")) {
    errors.push("Remove ENGAGE_LOCAL_MATERIAL_STORAGE and ENGAGE_LOCAL_DATA_DIR from production configuration.");
  }
  const accessKey = value("ENGAGE_AWS_ACCESS_KEY_ID");
  const secretKey = value("ENGAGE_AWS_SECRET_ACCESS_KEY");
  if (Boolean(accessKey) !== Boolean(secretKey)) {
    errors.push("Set both ENGAGE_AWS_ACCESS_KEY_ID and ENGAGE_AWS_SECRET_ACCESS_KEY, or leave both unset to use the AWS runtime identity.");
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = productionConfigErrors(process.env);
  if (errors.length) {
    console.error("Production configuration is incomplete:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Production configuration inputs passed. Service permissions and end-to-end operation still require release verification.");
  }
}
