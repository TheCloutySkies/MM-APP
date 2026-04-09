import type { SupabaseClient } from "@supabase/supabase-js";

import type { OutboxRecord } from "@/lib/e2ee/localStore";

export function sortOutboxRecords(records: OutboxRecord[]): OutboxRecord[] {
  return [...records].sort((a, b) => (a.queued_at ?? 0) - (b.queued_at ?? 0));
}

/** `none` = completed flush or not started; halt kinds classify whether decoy email is appropriate. */
export type OutboxHaltCategory = "none" | "network" | "server";

type InsertErr = { message?: string; code?: string | null } | null | undefined;

/**
 * Offline / transport failures → local banner only (no decoy SMTP).
 * Anything that reached PostgREST with a policy or auth failure → server.
 */
export function classifyOutboxInsertError(err: InsertErr): "network" | "server" {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.onLine === "boolean" &&
    navigator.onLine === false
  ) {
    return "network";
  }
  const msg = (err?.message ?? "").toLowerCase();
  if (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("connection") && msg.includes("refused")
  ) {
    return "network";
  }
  return "server";
}

export type FlushOutboxSequentialResult = {
  sentClientMsgIds: string[];
  haltedWithError: boolean;
  haltCategory: OutboxHaltCategory;
  lastError?: { message: string; code?: string | null };
};

/**
 * Store-and-forward: insert one row at a time (oldest first). On first failure, stop and leave the rest in the queue.
 * After each success, reload from storage and drop the sent id so concurrent appends during flush are preserved.
 */
export async function flushOutboxSequential(
  supabase: SupabaseClient,
  profileId: string,
  getQueue: () => Promise<OutboxRecord[]>,
  setQueue: (next: OutboxRecord[]) => Promise<void>,
  broadcastOne: (item: OutboxRecord) => Promise<void>,
): Promise<FlushOutboxSequentialResult> {
  const sentClientMsgIds: string[] = [];

  for (;;) {
    const sorted = sortOutboxRecords(await getQueue());
    if (!sorted.length) break;

    const item = sorted[0]!;
    const { error } = await supabase.from("e2ee_comms_envelopes").insert({
      sender_id: profileId,
      recipient_id: item.payload.recipient_id,
      group_id: item.payload.group_id,
      iv: item.payload.iv,
      ciphertext: item.payload.ciphertext,
      client_msg_id: item.payload.client_msg_id,
    });
    if (error) {
      const kind = classifyOutboxInsertError(error);
      return {
        sentClientMsgIds,
        haltedWithError: true,
        haltCategory: kind,
        lastError: { message: error.message, code: error.code },
      };
    }

    const latest = await getQueue();
    const next = latest.filter((x) => x.payload.client_msg_id !== item.payload.client_msg_id);
    await setQueue(next);
    sentClientMsgIds.push(item.payload.client_msg_id);
    try {
      await broadcastOne(item);
    } catch {
      /* realtime is best-effort; row is already in DB / postgres_changes */
    }
  }

  return { sentClientMsgIds, haltedWithError: false, haltCategory: "none" };
}
