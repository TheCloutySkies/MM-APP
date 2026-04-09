import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { flushActivityOutboxSequential } from "@/lib/activityLog/activityOutboxSync";
import { loadActivityOutbox, replaceActivityOutbox } from "@/lib/e2ee/localStore";
import { useMMStore } from "@/store/mmStore";

const webOk = Platform.OS === "web";

/**
 * Flushes encrypted `activity_logs` outbox whenever the app is foregrounded / online.
 * Independent of Live Comms mount so map/vault captures still sync after reconnect.
 */
export function useActivityOutboxFlush() {
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const lockRef = useRef(false);

  const flush = useCallback(async () => {
    if (!supabase || !profileId || lockRef.current) return;
    lockRef.current = true;
    try {
      await flushActivityOutboxSequential(supabase, profileId, loadActivityOutbox, replaceActivityOutbox);
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
