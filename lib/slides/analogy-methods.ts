export const ANALOGY_METHODS = ["six-step", "reference-story", "predict-transfer"] as const;
export type AnalogyMethod = typeof ANALOGY_METHODS[number];

export function isAnalogyMethod(value: unknown): value is AnalogyMethod {
  return ANALOGY_METHODS.includes(value as AnalogyMethod);
}

// Existing saved drafts and callers predate the method picker.
export function resolveAnalogyMethod(method?: AnalogyMethod): AnalogyMethod {
  return method ?? "predict-transfer";
}

export function analogyStages(method?: AnalogyMethod, includeLimits = false): readonly string[] {
  if (resolveAnalogyMethod(method) === "six-step") return ["phenomenon", "target", "analogue", "mapping", "apply", ...(includeLimits ? ["limits"] : []), "question"];
  return resolveAnalogyMethod(method) === "reference-story"
    ? ["target", "analogue", "mapping", "reflect", "question"]
    : ["analogue", "mapping", "predict", "reflect", "question"];
}

export function analogyVisualIds(method?: AnalogyMethod): readonly string[] {
  if (resolveAnalogyMethod(method) === "six-step") return ["phenomenon", "target", "analogue"];
  return resolveAnalogyMethod(method) === "reference-story" ? ["analogue", "target"] : ["analogue", "target", "variation"];
}

export function analogyMappingIndex(method?: AnalogyMethod): number {
  if (resolveAnalogyMethod(method) === "six-step") return 3;
  return resolveAnalogyMethod(method) === "reference-story" ? 2 : 1;
}

export function analogyVisibleVisualIds(method: AnalogyMethod | undefined, index: number, includeLimits = false): readonly string[] {
  if (resolveAnalogyMethod(method) === "six-step") {
    if (index === 0) return ["phenomenon"];
    if (index === 1) return ["target"];
    if (index === 2) return ["analogue"];
    if (index === 3 || index === 4 || (includeLimits && index === 5)) return ["analogue", "target"];
    return [];
  }
  if (resolveAnalogyMethod(method) === "reference-story") {
    if (index === 0 || index === 2 || index === 3) return ["analogue", "target"];
    return index === 1 ? ["analogue"] : [];
  }
  if (index === 0 || index === 1 || index === 3) return ["analogue", "target"];
  return index === 2 ? ["target", "variation"] : [];
}
