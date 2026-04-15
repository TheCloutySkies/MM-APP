import { useCallback } from "react";

import { appendActivityOutbox } from "@/lib/e2ee/localStore";
import { buildActivityPlaintext, encryptActivityPayloadJson } from "@/lib/activityLog/crypto";
import type { ActivityLogType } from "@/lib/activityLog/types";
import { useMMStore } from "@/store/mmStore";

function newClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultCaption(type: ActivityLogType): string {
  switch (type) {
    case "MAP_PIN":
      return "Tactical map feature saved";
    case "VAULT_FILE":
      return "Vault file uploaded";
    default:
      return "Activity recorded";
  }
}

/**
 * Encrypts audit payloads with the **team group AES key** (same as Live Comms).
 * Requires Team chat to have loaded the group key on this browser session (`teamGroupKeyBridge`),
 * otherwise logging is a silent no-op.
 */
export function useActivityLogger() {
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);

  const logAction = useCallback(
    async (type: ActivityLogType, referenceId: string, fallbackText?: string) => {
      if (!supabase || !profileId || !referenceId.trim()) return;

      const plain = buildActivityPlaintext(
        type,
        referenceId,
        (fallbackText ?? "").trim() || defaultCaption(type),
      );
      const encrypted_payload = await encryptActivityPayloadJson(plain);

      const netOffline =
        typeof navigator !== "undefined" &&
        typeof navigator.onLine === "boolean" &&
        navigator.onLine === false;

      if (netOffline) {
        await appendActivityOutbox({
          v: 1,
          queued_at: Date.now(),
          client_msg_id: newClientId(),
          encrypted_payload,
        });
        return;
      }

      const { error } = await supabase.from("activity_logs").insert({
        actor_id: profileId,
        encrypted_payload,
      });
      if (error) {
        await appendActivityOutbox({
          v: 1,
          queued_at: Date.now(),
          client_msg_id: newClientId(),
          encrypted_payload,
        });
      }
    },
    [supabase, profileId],
  );

  return { logAction };
}
