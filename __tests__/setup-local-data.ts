import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Most routes now read lessons from storage. Give each test file its own folder,
// so test files running at the same time can't write over each other's data or
// leave anything in the repo's data folder. A test can still choose its own.
const folder = mkdtempSync(path.join(os.tmpdir(), "engage-test-data-"));
process.env.ENGAGE_LOCAL_DATA_DIR = folder;
afterAll(() => rmSync(folder, { recursive: true, force: true }));
