import type { ClassProfile } from "./class-profile";
import type { TaskInterests } from "./task-interests";

// These instructions name the actions in the teacher's Step 3 Class information panel.
export const refreshClassInformation = "In Step 3, open Class information, select Refresh, then select Use updated information if shown.";

export type ContextStatus = "not_connected" | "empty" | "ready" | "stale" | "error" | "forbidden";
export type ContextSource<T> = {
  provider: "genius" | "engageagent";
  status: ContextStatus;
  version?: string;
  updatedAt?: string;
  syncedAt?: string;
  value?: T;
};
export type ClassroomContextSnapshot = {
  schemaVersion: 1;
  id: string;
  classId: string;
  assignmentId: string;
  profile: ContextSource<ClassProfile>;
  experiences: ContextSource<TaskInterests>;
  summary: string;
  geniusConnected: boolean;
  /** Present only for the verified, live GENIUS service, not the legacy adapter. */
  geniusClassId?: string;
  geniusManageUrl?: string;
  canLinkGenius?: boolean;
};
export function contextSourceLabel(source: ContextSource<unknown>) {
  const name = source.provider === "genius" ? "GENIUS" : "EngageAgent";
  if (source.status === "not_connected") return "GENIUS data is not connected yet";
  if (source.status === "forbidden") return "This account cannot access this class information";
  if (source.status === "error") return `${name} information could not be updated`;
  if (source.status === "stale") return `From ${name} · using the last available information`;
  if (source.status === "empty") return `From ${name} · no information yet`;
  return `From ${name}`;
}
