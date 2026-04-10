import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { loadVaultOutbox, replaceVaultOutbox } from "@/lib/e2ee/localStore";
import { flushVaultOutboxSequential } from "@/lib/vault/vaultOutboxSync";
import { useMMStore } from "@/store/mmStore";

const webOk = Platform.OS === "web";

/** Flushes encrypted vault upload queue when online / foregrounded (web IndexedDB). */
export function useVaultOutboxFlush() {
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const lockRef = useRef(false);

  const flush = useCallback(async () => {
    if (!supabase || !profileId || lockRef.current) return;
    lockRef.current = true;
    try {
      await flushVaultOutboxSequential(supabase, profileId, loadVaultOutbox, replaceVaultOutbox);
    } finally {
      lockRef.current = false;
    }
  }, [supabase, profileId]);

  useEffect(() => {
    if (!webOk || typeof window === "undefined") return;
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flush]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void flush();
    });
    return () => sub.remove();
  }, [flush]);

  useEffect(() => {
    void flush();
  }, [flush, supabase, profileId]);
}
