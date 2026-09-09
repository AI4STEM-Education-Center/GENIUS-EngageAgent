"use client";

import { useAuth } from "./components/AuthContext";
import GeniusSignIn from "./components/GeniusSignIn";
import TeacherView from "./components/TeacherView";
import StudentView from "./components/StudentView";

export default function Home() {
  const { user, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
          <p className="text-sm text-slate-500">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return <GeniusSignIn error={error} />;
  }

  if (user.role === "student" || user.role === "guest") {
    return <StudentView user={user} />;
  }

  return <TeacherView user={user} />;
}
