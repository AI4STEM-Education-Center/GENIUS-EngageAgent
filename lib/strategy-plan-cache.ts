const STRATEGY_PLAN_CACHE_VERSION = 3;

type CachedPlanEnvelope<TPlan> = {
  promptVersion: number;
  lessonNumber: number | null;
  plan: TPlan;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const serializeCachedPlan = <TPlan>(
  plan: TPlan,
  lessonNumber?: number,
) =>
  JSON.stringify({
    promptVersion: STRATEGY_PLAN_CACHE_VERSION,
    lessonNumber: typeof lessonNumber === "number" ? lessonNumber : null,
    plan,
  } satisfies CachedPlanEnvelope<TPlan>);

export const deserializeCachedPlan = <TPlan>(
  planJson: string,
  options?: {
    lessonNumber?: number;
    requireVersionMatch?: boolean;
  },
): TPlan | null => {
  const parsed = JSON.parse(planJson) as unknown;

  if (
    isRecord(parsed) &&
    "promptVersion" in parsed &&
    "plan" in parsed
  ) {
    const promptVersion =
      typeof parsed.promptVersion === "number" ? parsed.promptVersion : null;
    if (promptVersion !== STRATEGY_PLAN_CACHE_VERSION) {
      return null;
    }

    if (
      typeof options?.lessonNumber === "number" &&
      parsed.lessonNumber !== options.lessonNumber
    ) {
      return null;
    }

    return parsed.plan as TPlan;
  }

  if (options?.requireVersionMatch) {
    return null;
  }

  return parsed as TPlan;
};
