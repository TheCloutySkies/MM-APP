import { createContext, useContext, type ReactNode } from "react";

import { useLiveSocket } from "@/hooks/useLiveSocket";

type LiveSocketValue = ReturnType<typeof useLiveSocket>;

const LiveSocketContext = createContext<LiveSocketValue | null>(null);

/** Single chat socket + presence for the signed-in app session (avoid duplicate connections). */
export function LiveSocketProvider({ children }: { children: ReactNode }) {
  const value = useLiveSocket();
  return <LiveSocketContext.Provider value={value}>{children}</LiveSocketContext.Provider>;
}

export function useLiveSocketContext(): LiveSocketValue {
  const v = useContext(LiveSocketContext);
  if (!v) {
    throw new Error("useLiveSocketContext must be used within LiveSocketProvider");
  }
  return v;
}
