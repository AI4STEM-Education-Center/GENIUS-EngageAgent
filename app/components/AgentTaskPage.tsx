"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "./AuthContext";
import TeacherView from "./TeacherView";
import TeacherDashboardView from "./TeacherDashboardView";
import StudentView from "./StudentView";
import { agentTaskFetch } from "@/lib/client-auth";
import { notifyTaskCreated, notifyTaskDeleted, notifyTaskUpdated } from "@/lib/genius-notify";
import type { AgentTask, AgentTaskLink } from "@/lib/agent-tasks";

export type AgentTaskMode = "create" | "edit" | "view" | "delete" | "launch";
type Props = { mode: AgentTaskMode; taskId: string | null; geniusOrigin: string | null };
type TaskSummary = Pick<AgentTask, "agentTaskId" | "title"> & Partial<AgentTask>;

async function call(body: Record<string, unknown>) {
  const response = await agentTaskFetch(body);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "Something went wrong. Please try again.");
  return data as { task: TaskSummary; links?: AgentTaskLink[] };
}

// Compact when a class workflow or dashboard follows, so it stays in view.
function Shell({ heading, children, compact = false }: { heading: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <main className={compact ? "border-b border-gray-200 bg-gray-50 px-6 py-6 text-gray-900" : "min-h-screen bg-gray-50 px-6 py-10 text-gray-900"}>
      <section className="mx-auto w-full max-w-xl">
        <p className="text-sm font-semibold text-red-800">EngageAgent</p>
        <h1 className="mt-2 break-words text-2xl font-semibold">{heading}</h1>
        <div className="mt-6">{children}</div>
      </section>
    </main>
  );
}

const Alert = ({ message }: { message: string }) => (
  <p role="alert" className="border-l-2 border-red-700 pl-3 text-sm text-red-800">{message}</p>
);
const Status = ({ message }: { message: string }) => <p role="status" className="text-sm text-gray-600">{message}</p>;
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-md bg-red-800 px-5 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-800";

function TitleForm({ initial, submitLabel, onSave }: { initial: string; submitLabel: string; onSave: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(null);
    try { await onSave(title); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to save."); }
    finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="agent-task-title" className="block text-sm font-medium">Activity title</label>
      <input id="agent-task-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" />
      {error && <Alert message={error} />}
      <button type="submit" disabled={saving || !title.trim()} className={buttonClass}>{saving ? "Saving..." : submitLabel}</button>
    </form>
  );
}

export default function AgentTaskPage({ mode, taskId, geniusOrigin }: Props) {
  const { user, loading, error: authError } = useAuth();
  const [task, setTask] = useState<TaskSummary | null>(null);
  const [links, setLinks] = useState<AgentTaskLink[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const signedIn = Boolean(user && !authError);
  const teacherOnly = mode !== "launch";

  useEffect(() => {
    if (!signedIn || mode === "create" || !taskId) return;
    if (teacherOnly && user?.role !== "teacher") return;
    let active = true;
    const action = mode === "launch" ? { action: "launch" } : { action: "open", allowArchived: mode === "delete" };
    call({ ...action, taskId })
      .then(data => { if (active) { setTask(data.task); setLinks(data.links ?? []); } })
      .catch(err => { if (active) setLoadError(err instanceof Error ? err.message : "Unable to open this activity."); });
    return () => { active = false; };
  }, [signedIn, mode, taskId, teacherOnly, user?.role]);

  if (loading) return <Shell heading="Opening EngageAgent"><Status message="Authenticating..." /></Shell>;
  if (authError || !user) return <Shell heading="Sign-in required"><Alert message="Reopen this activity from GENIUS to sign in." /></Shell>;
  if (teacherOnly && user.role !== "teacher") return <Shell heading="Teacher access required"><Alert message="Only teachers can manage EngageAgent activities." /></Shell>;
  if (mode !== "create" && !taskId) return <Shell heading="Activity not found"><Alert message="This link is missing its task_id." /></Shell>;
  if (loadError) return <Shell heading="Activity unavailable"><Alert message={loadError} /></Shell>;
  const hasClass = Boolean(user.classId && user.assignmentId);

  if (mode === "create") {
    if (task) return <Shell heading="Activity created"><Status message={`"${task.title}" is ready. You can close this window.`} /></Shell>;
    return (
      <Shell heading="Create an EngageAgent activity">
        <TitleForm initial="" submitLabel="Create activity" onSave={async title => {
          const { task: created } = await call({ action: "create", title });
          setTask(created);
          notifyTaskCreated(created, geniusOrigin);
        }} />
      </Shell>
    );
  }

  if (!task) return <Shell heading="Opening activity"><Status message="Loading activity..." /></Shell>;

  if (mode === "launch") return user.role === "teacher" ? <TeacherView user={user} /> : <StudentView user={user} />;

  if (mode === "delete") {
    if (task.archived) return <Shell heading="Activity archived"><Status message={`"${task.title}" is archived. Student answers and materials are kept.`} /></Shell>;
    return (
      <Shell heading="Archive this activity?">
        <p className="text-sm text-gray-700">
          &ldquo;{task.title}&rdquo; will no longer open for students. Nothing is deleted: student answers, survey results and materials are kept.
        </p>
        {notice && <div className="mt-4"><Alert message={notice} /></div>}
        <button type="button" disabled={archiving} className={`${buttonClass} mt-6`} onClick={async () => {
          setArchiving(true); setNotice(null);
          try {
            const { task: archived } = await call({ action: "archive", taskId: task.agentTaskId });
            setTask(archived);
            notifyTaskDeleted(archived, geniusOrigin);
          } catch (err) { setNotice(err instanceof Error ? err.message : "Unable to archive."); }
          finally { setArchiving(false); }
        }}>{archiving ? "Archiving..." : "Archive activity"}</button>
      </Shell>
    );
  }

  const setup = mode === "edit" ? (
    <Shell heading="Edit activity" compact={hasClass}>
      <TitleForm initial={task.title} submitLabel="Save changes" onSave={async title => {
        const { task: updated } = await call({ action: "update", taskId: task.agentTaskId, title });
        setTask(updated);
        setNotice("Saved.");
        notifyTaskUpdated(updated, geniusOrigin);
      }} />
      {notice && <div className="mt-3"><Status message={notice} /></div>}
      {!hasClass && <p className="mt-6 text-sm text-gray-600">Open this activity from a GENIUS class to prepare materials and see results.</p>}
    </Shell>
  ) : (
    <Shell heading={task.title} compact={hasClass}>
      <Status message={`Used by ${links.length} GENIUS ${links.length === 1 ? "class" : "classes"}.`} />
      {!hasClass && <p className="mt-3 text-sm text-gray-600">Open this preview from a GENIUS class to see that class&apos;s results.</p>}
    </Shell>
  );
  if (!hasClass) return setup;
  return <>{setup}{mode === "edit" ? <TeacherView user={user} /> : <TeacherDashboardView user={user} />}</>;
}
