import { BarChart3, BookOpen, ClipboardList, GraduationCap, LayoutGrid } from "lucide-react";
import type { HeaderAction } from "./AppHeader";

// Tasks and the dashboard live in EngageAgent's own classes; a GENIUS class's
// tasks are opened from GENIUS. (Same rule as isWorkspaceClass in lib/workspace.)
const isEngageAgentClass = (id?: string | null): id is string => Boolean(id?.startsWith("ea-class-"));

export type TeacherNavPage = "classes" | "tasks" | "lessons" | "dashboard" | "gallery";

const TEACHER_HOME = "/teacher/classes";
const NEEDS_CLASS = "Choose a class first";
const GENIUS_CLASS = "Open this class's tasks from GENIUS";

/** Links for the teacher's own workspace (#208). `classId` is the class in view, if any. */
export const teacherNavLinks = (classId?: string | null) => {
  const own = isEngageAgentClass(classId);
  const classQuery = own ? `classId=${encodeURIComponent(classId)}` : "";
  return {
    classes: TEACHER_HOME,
    tasks: own ? `${TEACHER_HOME}?${classQuery}` : undefined,
    lessons: "/teacher/lessons",
    dashboard: own ? `${TEACHER_HOME}?${classQuery}&view=dashboard` : undefined,
    gallery: `${TEACHER_HOME}?${classQuery ? `${classQuery}&` : ""}view=gallery`,
  };
};

/**
 * The teacher's top menu (#208): My class, Tasks, Lessons, Dashboard, Gallery.
 * Tasks and Dashboard belong to one of EngageAgent's own classes, so they wait
 * until one is chosen (a GENIUS class's tasks open from GENIUS).
 * Only in EngageAgent's own workspace; inside GENIUS the header isn't shown.
 */
export function teacherNavActions(options: {
  classId?: string | null;
  current?: TeacherNavPage;
  /** Replaces the Gallery link, e.g. a task page opens its own gallery in place. */
  gallery?: Pick<HeaderAction, "onClick" | "active" | "comingSoon">;
  /** Shown but disabled until the class dashboard exists (#207). */
  dashboardComingSoon?: boolean;
}): HeaderAction[] {
  const links = teacherNavLinks(options.classId);
  const current = options.current;
  const needsClass = options.classId && !isEngageAgentClass(options.classId) ? GENIUS_CLASS : NEEDS_CLASS;
  return [
    { label: "My class", icon: <GraduationCap size={15} />, href: links.classes, active: current === "classes" },
    { label: "Tasks", icon: <ClipboardList size={15} />, href: links.tasks, active: current === "tasks", disabledReason: links.tasks ? undefined : needsClass },
    { label: "Lessons", icon: <BookOpen size={15} />, href: links.lessons, active: current === "lessons" },
    { label: "Dashboard", icon: <BarChart3 size={15} />, href: links.dashboard, active: current === "dashboard",
      comingSoon: options.dashboardComingSoon, disabledReason: links.dashboard ? undefined : needsClass },
    options.gallery
      ? { label: "Gallery", icon: <LayoutGrid size={15} />, ...options.gallery }
      : { label: "Gallery", icon: <LayoutGrid size={15} />, href: links.gallery, active: current === "gallery" },
  ];
}
