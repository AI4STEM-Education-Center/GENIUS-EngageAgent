import { resolveAnalogyMethod, type AnalogyMethod } from "./analogy-methods";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { SlideStrategy } from "./model";

const FILES: Record<SlideStrategy, string> = {
  analogy: "analogy.txt",
  "cognitive conflict": "cognitive-conflict-20261005.txt",
  "experience bridging": "experience-bridging-20261005.txt",
};

// Server-only: the selected, version-controlled reference is sent verbatim in A.
// The October 5 analogy text is retained as a supplemental reference. The
// refined six-step source remains active; its v7 adaptation already implements
// the new mapping-depth, explain/predict, and optional-limits requirements.
export async function loadSlideSource(strategy: SlideStrategy, method?: AnalogyMethod) {
  const filename = strategy === "analogy" && resolveAnalogyMethod(method) === "six-step" ? "analogy-six-step-20261001.txt" : FILES[strategy];
  if (!filename) throw new Error("Unknown method reference.");
  const text = await readFile(path.join(process.cwd(), "docs/references/strategy-prompts", filename), "utf8");
  if (text.trim().length < 1000) throw new Error("Method reference is incomplete.");
  return { text, sha256: createHash("sha256").update(text).digest("hex") };
}
