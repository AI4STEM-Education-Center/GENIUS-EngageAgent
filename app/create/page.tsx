import AgentTaskPage from "@/app/components/AgentTaskPage";
import { geniusEmbedOrigin } from "@/lib/session";

// GENIUS standard URL: /create (embedded in an iframe with sso_token).
export default async function CreateActivity({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const taskId = (await searchParams).task_id;
  return <AgentTaskPage mode="create" taskId={typeof taskId === "string" ? taskId : null} geniusOrigin={geniusEmbedOrigin()} />;
}
