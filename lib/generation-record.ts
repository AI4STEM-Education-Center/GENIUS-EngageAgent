/** Safe provenance shown to the teacher; full inputs stay on the server. */
export type GenerationRecord = {
  id: string;
  capturedAt: string;
  lessonNumber: number;
  strategy: string;
  format: "slides" | "video";
  operation: string;
  model: string;
  promptHash: string;
  parentId?: string;
  tags: Record<string, string>;
};
export function isGenerationRecord(v: unknown): v is GenerationRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as GenerationRecord;
  return typeof r.id === "string" && /^[a-f0-9-]{36}$/u.test(r.id) && typeof r.capturedAt === "string"
    && typeof r.promptHash === "string" && /^[a-f0-9]{64}$/u.test(r.promptHash) && Number.isInteger(r.lessonNumber)
    && typeof r.strategy === "string" && ["slides", "video"].includes(r.format) && typeof r.operation === "string"
    && typeof r.model === "string" && !!r.tags && typeof r.tags === "object" && !Array.isArray(r.tags)
    && Object.keys(r.tags).length <= 40 && Object.values(r.tags).every(x => typeof x === "string" && x.length <= 4000);
}
