"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, LogOut, Plus, Users } from "lucide-react";
import type { UserContext } from "@/lib/auth";
import type { WorkspaceAssignment, WorkspaceMember } from "@/lib/workspace";
import { useAuth } from "./AuthContext";
import GeniusSignIn from "./GeniusSignIn";
import TeacherView from "./TeacherView";
import TeacherDashboardView from "./TeacherDashboardView";
import StudentView from "./StudentView";

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

  async function logout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Unable to sign out. Please try again.");
      sessionStorage.removeItem("engage-sso-token"); sessionStorage.removeItem("engage-mock-user-role");
      window.location.assign("/");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to sign out."); setBusy(false); }
  }

  if (auth.loading) return <p role="status" className="p-8 text-sm">Checking your session...</p>;
  if (!auth.user || auth.error) return <GeniusSignIn error={auth.error} />;

  return <div className="min-h-screen bg-gray-50 text-gray-900">
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
        <Link href={home} className="flex items-center gap-3 text-xl font-semibold"><BookOpen size={24} className="shrink-0 text-red-800" />EngageAgent</Link>
        <div className="flex min-w-0 items-center gap-4 text-sm"><span className="break-words">{auth.user.name} <span className="text-gray-500">({teacher ? "Teacher" : "Student"})</span></span>
          <button title="Sign out of EngageAgent" aria-label="Sign out of EngageAgent" onClick={logout} disabled={busy} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-gray-100"><LogOut size={19} /></button>
        </div>
      </div>
    </header>
    <nav aria-label="Workspace" className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-5 py-4 text-sm">
      <Link href={home} className="inline-flex items-center gap-2 text-red-800"><Users size={17} />My classes</Link>
      {classId && <><span className="text-gray-400">/</span><Link href={classPath(classId)}>Class tasks</Link></>}
      {assignmentId && <><span className="text-gray-400">/</span><span>Engagement workflow</span></>}
    </nav>
    {error && <div role="alert" className="mx-auto max-w-7xl px-5 py-3 text-sm text-red-800">{error} <button onClick={() => setRefresh(n => n + 1)} className="underline">Retry</button></div>}
    {loading ? <p role="status" className="mx-auto max-w-7xl px-5 py-8 text-sm">Loading workspace...</p> : data?.user ?
      (teacher ? (params.get("view") === "dashboard" ? <TeacherDashboardView user={data.user} /> : <TeacherView key={`${classId}:${assignmentId}`} user={data.user} />) : <StudentView key={`${classId}:${assignmentId}`} user={data.user} />) :
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
