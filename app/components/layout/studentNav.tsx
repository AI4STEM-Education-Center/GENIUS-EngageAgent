import { ClipboardList, GraduationCap } from "lucide-react";
import type { HeaderAction } from "./AppHeader";

/**
 * The student's top menu beside their profile (#180): "My classes" and the
 * current class's "Class tasks". Only in EngageAgent's own workspace; inside
 * GENIUS there are no links, since GENIUS has its own navigation.
 */
export function studentNavActions(
  links: { homeHref?: string; classHref?: string },
  current?: "classes" | "tasks",
): HeaderAction[] {
  return [
    ...(links.homeHref
      ? [{ label: "My classes", icon: <GraduationCap size={15} />, href: links.homeHref, active: current === "classes" }]
      : []),
    ...(links.classHref
      ? [{ label: "Class tasks", icon: <ClipboardList size={15} />, href: links.classHref, active: current === "tasks" }]
      : []),
  ];
}
