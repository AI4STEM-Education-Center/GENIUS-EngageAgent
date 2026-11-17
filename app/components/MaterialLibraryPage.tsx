"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthContext";
import GeniusSignIn from "./GeniusSignIn";
import AppHeader from "./layout/AppHeader";
import { teacherNavActions } from "./layout/teacherNav";
import GalleryWorkspace from "./GalleryWorkspace";

export default function MaterialLibraryPage() {
  const auth = useAuth(), router = useRouter();
  const guard = useRef<((proceed: () => void) => void) | null>(null);
  if (auth.loading) return <p role="status" className="p-8">Checking your session…</p>;
  if (!auth.user || auth.error) return <GeniusSignIn error={auth.error} />;
  if (auth.user.role !== "teacher") return <p role="alert" className="p-8">The material library is for teachers.</p>;
  const user = { ...auth.user, classId: undefined, assignmentId: undefined, className: undefined };
  return <div className="min-h-screen bg-canvas text-ink"><AppHeader userName={user.name} homeHref="/teacher/classes" canSignOut
    actions={teacherNavActions({ current: "gallery" })} beforeNavigate={proceed => guard.current ? guard.current(proceed) : proceed()} />
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6"><GalleryWorkspace user={user} onBack={() => router.push("/teacher/classes")} registerLeaveGuard={value => { guard.current = value; }} /></main>
  </div>;
}
