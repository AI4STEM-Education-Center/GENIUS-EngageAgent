import type { ReactNode } from "react";

type Props = {
  header: ReactNode;
  /** The step bar under the header, when the page has steps. */
  tabs?: ReactNode;
  /** Narrower reading width, used by the student pages. */
  narrow?: boolean;
  children: ReactNode;
};

// The v8.3 page frame (#172): header, optional step bar, then a centred page.
export default function AppFrame({ header, tabs, narrow, children }: Props) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      {header}
      {tabs}
      <main className={`mx-auto w-full ${narrow ? "max-w-[860px]" : "max-w-[1120px]"} px-5 pb-28 pt-7 sm:px-7`}>
        {children}
      </main>
    </div>
  );
}
