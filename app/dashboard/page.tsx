"use client";

import { useAuth } from "../components/AuthContext";
import GeniusSignIn from "../components/GeniusSignIn";
import TeacherDashboardView from "../components/TeacherDashboardView";

export default function DashboardPage() {
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">Teacher Dashboard Only</p>
          <p className="mt-2 text-sm text-slate-500">
            This dashboard is only available in the teacher workflow.
          </p>
        </div>
      </div>
    );
  }

  return <TeacherDashboardView user={user} />;
}
