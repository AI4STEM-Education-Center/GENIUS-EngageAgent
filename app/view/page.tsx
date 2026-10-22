import AgentTaskPage from "@/app/components/AgentTaskPage";
import { geniusEmbedOrigin } from "@/lib/session";

// GENIUS standard URL: /view?task_id=… (embedded in an iframe with sso_token).
export default async function ViewActivity({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const taskId = (await searchParams).task_id;
  return <AgentTaskPage mode="view" taskId={typeof taskId === "string" ? taskId : null} geniusOrigin={geniusEmbedOrigin()} />;
}
