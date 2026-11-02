"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { LogOut, Sparkles } from "lucide-react";

export type HeaderAction = {
  label: string;
  icon: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  /** Shown but disabled until the feature is built (e.g. Class profile, #173). */
  comingSoon?: boolean;
};

/** How a task view's header links back into the app. Omitted inside GENIUS, which has its own navigation. */
export type TaskShell = { homeHref?: string; classHref?: string; taskTitle?: string; canSignOut?: boolean };

export const taskContext = (user: { className?: string }, shell?: TaskShell) => [
  ...(user.className ? [{ label: user.className, href: shell?.classHref }] : []),
  ...(shell?.taskTitle ? [{ label: shell.taskTitle }] : []),
];

type Props = {
  userName: string;
  /** Where the EngageAgent mark links to; plain text when omitted (e.g. inside GENIUS). */
  homeHref?: string;
  /** Class / task shown next to the mark. An item with an href becomes a link. */
  context?: { label: string; href?: string }[];
  actions?: HeaderAction[];
  canSignOut?: boolean;
  /** Show the user's name beside the avatar (the student header does). */
  showName?: boolean;
};

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join("") || "?";

const actionClass = (active?: boolean) =>
  `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] font-medium transition ${
    active ? "bg-brand-light text-brand-dark" : "text-ink-2 hover:bg-canvas"
  } disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`;

export default function AppHeader({ userName, homeHref, context = [], actions = [], canSignOut, showName }: Props) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setSigningOut(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Unable to sign out. Please try again.");
      sessionStorage.removeItem("engage-sso-token"); sessionStorage.removeItem("engage-mock-user-role");
      window.location.assign("/");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to sign out."); setSigningOut(false); }
  }

  const mark = <><span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white"><Sparkles size={15} /></span>EngageAgent</>;

  return (
    <header className="border-b border-line bg-white">
      <div className="flex min-h-[58px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2 sm:px-6">
        {homeHref
          ? <Link href={homeHref} className="flex items-center gap-2.5 font-bold tracking-tight text-ink">{mark}</Link>
          : <span className="flex items-center gap-2.5 font-bold tracking-tight text-ink">{mark}</span>}
        {context.length > 0 && (
          <div className="flex min-w-0 items-center gap-2.5 border-l border-line pl-4 text-[13.5px] text-ink-2">
            {context.map((item, index) => (
              <span key={item.label} className={`flex min-w-0 items-center gap-2.5 ${index === 0 ? "font-semibold text-ink" : ""}`}>
                {index > 0 && <span aria-hidden="true">·</span>}
                {item.href ? <Link href={item.href} className="truncate hover:underline">{item.label}</Link> : <span className="truncate">{item.label}</span>}
              </span>
            ))}
          </div>
        )}
        <nav aria-label="EngageAgent" className="ml-auto flex flex-wrap items-center gap-1">
          {actions.map(action => {
            const content = <>{action.icon}{action.label}</>;
            if (action.href && !action.comingSoon) {
              return <Link key={action.label} href={action.href} aria-current={action.active ? "page" : undefined} className={actionClass(action.active)}>{content}</Link>;
            }
            return (
              <button key={action.label} type="button" onClick={action.onClick} disabled={action.comingSoon}
                title={action.comingSoon ? "Coming soon" : undefined} aria-current={action.active ? "page" : undefined}
                className={actionClass(action.active)}>{content}</button>
            );
          })}
          {showName && <span className="ml-2 text-[13.5px] text-ink-2">{userName}</span>}
          <span title={userName} aria-label={userName} className="ml-2 grid h-[30px] w-[30px] place-items-center rounded-full bg-line text-xs font-bold text-ink-2">{initials(userName)}</span>
          {canSignOut && (
            <button type="button" title="Sign out of EngageAgent" aria-label="Sign out of EngageAgent" onClick={signOut} disabled={signingOut}
              className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-canvas"><LogOut size={17} /></button>
          )}
        </nav>
      </div>
      {error && <p role="alert" className="px-6 pb-2 text-sm text-bad">{error}</p>}
    </header>
  );
}
