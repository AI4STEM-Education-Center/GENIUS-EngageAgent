"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, LayoutGrid, Plus } from "lucide-react";
import type { UserContext } from "@/lib/auth";
import type { WorkspaceAssignment, WorkspaceMember } from "@/lib/workspace";
import { useAuth } from "./AuthContext";
import GeniusSignIn from "./GeniusSignIn";
import TeacherView from "./TeacherView";
import StudentView from "./StudentView";
import AppHeader from "./layout/AppHeader";
import { studentNavActions } from "./layout/studentNav";

type Data = {
  classes?: { id: string; name: string }[];
  classroom?: { id: string; name: string; joinCode?: string };
  assignments?: WorkspaceAssignment[];
  members?: WorkspaceMember[];
  user?: UserContext;
};
const inputClass = "min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-red-700 focus:outline-2 focus:outline-red-100";
const buttonClass = "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50";

export default function Workspace() {
  const auth = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const classId = params.get("classId"), assignmentId = params.get("assignmentId");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const teacher = auth.user?.role === "teacher";
  const home = teacher ? "/teacher/classes" : "/student/classes";
  const classPath = useCallback((id: string) => `${home}?classId=${encodeURIComponent(id)}`, [home]);

  useEffect(() => {
    if (auth.user && window.location.pathname !== home) router.replace(`${home}${window.location.search}`);
  }, [auth.user, home, router]);

  useEffect(() => {
    if (!auth.user) return;
    const query = new URLSearchParams();
    if (classId) query.set("classId", classId);
    if (assignmentId) query.set("assignmentId", assignmentId);
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null); setValue("");
    fetch(`/api/workspace?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load workspace.");
        setData(result);
      }).catch(err => { if (err.name !== "AbortError") setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [auth.user, classId, assignmentId, refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const action = classId ? "createTask" : teacher ? "createClass" : "joinClass";
      const response = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, classId, name: value, title: value, code: value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save.");
      setValue("");
      if (result.assignment) router.push(`${classPath(classId!)}&assignmentId=${encodeURIComponent(result.assignment.id)}`);
      else router.push(classPath(result.classroom.id));
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save."); }
    finally { setBusy(false); }
  }

  if (auth.loading) return <p role="status" className="p-8 text-sm">Checking your session...</p>;
  if (!auth.user || auth.error) return <GeniusSignIn error={auth.error} />;

  // A task view renders its own header and step bar (#172); this page only frames the class and task lists.
  if (data?.user && classId && assignmentId) {
    const shell = { homeHref: home, classHref: classPath(classId), canSignOut: true };
    return teacher
      ? <TeacherView key={`${classId}:${assignmentId}`} user={data.user} shell={shell}
          initialMaterialFormat={params.get("view") === "slides" ? "slides" : undefined}
          initialView={params.get("view") === "dashboard" ? "dashboard" : undefined} />
      : <StudentView key={`${classId}:${assignmentId}`} user={data.user} shell={shell} />;
  }

  return <div className="min-h-screen bg-canvas text-ink">
    <AppHeader userName={auth.user.name} homeHref={home} canSignOut
      context={data?.classroom ? [{ label: data.classroom.name, href: classPath(data.classroom.id) }] : []}
      actions={teacher ? [{ label: "Gallery", icon: <LayoutGrid size={15} />, href: "/community" }]
        : studentNavActions({ homeHref: home, classHref: classId ? classPath(classId) : undefined }, classId ? "tasks" : "classes")} />
    {error && <div role="alert" className="mx-auto max-w-7xl px-5 py-3 text-sm text-red-800">{error} <button onClick={() => setRefresh(n => n + 1)} className="underline">Retry</button></div>}
    {loading ? <p role="status" className="mx-auto max-w-7xl px-5 py-8 text-sm">Loading workspace...</p> : !(classId && assignmentId) &&
      <main className="mx-auto max-w-7xl px-5 pb-12 pt-5">
        <h1 className="break-words text-2xl font-semibold">{data?.classroom?.name || "My classes"}</h1>
        {data?.classroom?.joinCode && <p className="mt-3 break-all text-sm text-gray-600">Class code: <strong className="font-mono text-gray-900">{data.classroom.joinCode}</strong></p>}
        {(!classId || teacher) && <form onSubmit={submit} className="my-6 flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium" htmlFor="workspace-value">{classId ? "New task title" : teacher ? "New class name" : "Class code"}
            <input id="workspace-value" required maxLength={120} value={value} onChange={event => setValue(event.target.value)} className={inputClass} />
          </label>
          <button className={buttonClass} disabled={busy || !value.trim()}><Plus size={17} />{busy ? "Saving..." : classId ? "Create task" : teacher ? "Create class" : "Join class"}</button>
        </form>}
        <section aria-label={classId ? "Class tasks" : "Classes"} className="mt-6 border-y border-gray-200 bg-white">
          {(classId ? data?.assignments || [] : data?.classes || []).map(item => <Link key={item.id}
            href={classId ? `${classPath(classId)}&assignmentId=${encodeURIComponent(item.id)}` : classPath(item.id)}
            className="flex min-h-18 items-center justify-between gap-5 border-b border-gray-100 px-4 py-5 last:border-0 hover:bg-gray-50">
            <span className="min-w-0 break-words text-sm font-medium">{"title" in item ? item.title : item.name}</span><ArrowRight size={18} className="shrink-0 text-gray-500" />
          </Link>)}
          {(classId ? !data?.assignments?.length : !data?.classes?.length) && <p className="px-4 py-8 text-sm text-gray-500">{classId ? "No tasks yet." : "No classes yet."}</p>}
        </section>
        {teacher && classId && <section className="mt-9" aria-labelledby="students-heading">
          <h2 id="students-heading" className="text-lg font-semibold">Students ({data?.members?.length || 0})</h2>
          <ul className="mt-3 divide-y divide-gray-200">{data?.members?.map(member => <li key={member.geniusId} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{member.name}</span><span className="break-all text-gray-500">GENIUS ID: {member.geniusId}</span></li>)}</ul>
        </section>}
        {classId && <Link className="mt-8 inline-flex items-center gap-2 text-sm text-red-800" href={home}><ArrowLeft size={16} />All classes</Link>}
      </main>}
  </div>;
}
