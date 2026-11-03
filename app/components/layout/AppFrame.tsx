"use client";

import type { ReactNode } from "react";
import { useInGenius } from "./useInGenius";

type Props = {
  header: ReactNode;
  /** The step bar under the header, when the page has steps. */
  tabs?: ReactNode;
  /** Narrower reading width, used by the student pages. */
  narrow?: boolean;
  children: ReactNode;
};

// The v8.3 page frame (#172): header, optional step bar, then a centred page.
// Inside the GENIUS iframe the header is left out; GENIUS shows its own menu.
export default function AppFrame({ header, tabs, narrow, children }: Props) {
  const inGenius = useInGenius();
  return (
    <div className="min-h-screen bg-canvas text-ink">
      {!inGenius && header}
      {tabs}
      <main className={`mx-auto w-full ${narrow ? "max-w-[860px]" : "max-w-[1120px]"} px-5 pb-28 pt-7 sm:px-7`}>
        {children}
      </main>
    </div>
  );
}
