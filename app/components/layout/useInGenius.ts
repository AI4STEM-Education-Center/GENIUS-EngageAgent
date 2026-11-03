"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True when EngageAgent is running inside the GENIUS iframe. GENIUS has its own
 * top menu, so ours is hidden there (#172). The server can't tell, so it renders
 * as if inside GENIUS and the header appears once the client knows otherwise.
 */
export function useInGenius() {
  return useSyncExternalStore(subscribe, () => window.self !== window.top, () => true);
}
