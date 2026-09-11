import { Suspense } from "react";
import Workspace from "@/app/components/Workspace";

export default function TeacherClasses() {
  return <Suspense fallback={<p className="p-8">Loading workspace...</p>}><Workspace /></Suspense>;
}
