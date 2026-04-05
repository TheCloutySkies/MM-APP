import { useEffect } from "react";
import { AppState } from "react-native";

import { SK, secureGet } from "@/lib/secure/mmSecureStore";
import { useMMStore } from "@/store/mmStore";

const SEVENTY_TWO_H_MS = 72 * 60 * 60 * 1000;

/** Foreground check: if last real main unlock exceeds threshold, erase local material. */
export function useDeadManMonitor() {
  const vaultMode = useMMStore((s) => s.vaultMode);

  useEffect(() => {
    const run = async () => {
      const last = await secureGet(SK.lastRealUnlock);
      if (!last) return;
      if (Date.now() - Number(last) <= SEVENTY_TWO_H_MS) return;
      await useMMStore.getState().fullLock();
    };

    void run();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void run();
    });
    return () => sub.remove();
  }, [vaultMode]);
}
