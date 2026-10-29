import AgentTaskPage from "@/app/components/AgentTaskPage";
import { geniusEmbedOrigin } from "@/lib/session";

// GENIUS standard URL: /edit?task_id=… (embedded in an iframe with sso_token).
export default async function EditActivity({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const taskId = (await searchParams).task_id;
  return <AgentTaskPage mode="edit" taskId={typeof taskId === "string" ? taskId : null} geniusOrigin={geniusEmbedOrigin()} />;
}
