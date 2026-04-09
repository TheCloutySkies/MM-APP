import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActivityOutboxRecord } from "@/lib/e2ee/localStore";
import { classifyOutboxInsertError, type OutboxHaltCategory } from "@/lib/e2ee/outboxSync";

export function sortActivityOutboxRecords(records: ActivityOutboxRecord[]): ActivityOutboxRecord[] {
  return [...records].sort((a, b) => a.queued_at - b.queued_at);
}

export type FlushActivityOutboxResult = {
  flushedIds: string[];
  haltedWithError: boolean;
  haltCategory: OutboxHaltCategory;
};

/**
 * Sequential insert into `activity_logs` — same halt semantics as comms outbox.
 */
export async function flushActivityOutboxSequential(
  supabase: SupabaseClient,
  profileId: string,
  getQueue: () => Promise<ActivityOutboxRecord[]>,
  setQueue: (next: ActivityOutboxRecord[]) => Promise<void>,
): Promise<FlushActivityOutboxResult> {
  const flushedIds: string[] = [];

  for (;;) {
    const sorted = sortActivityOutboxRecords(await getQueue());
    if (!sorted.length) break;

    const item = sorted[0]!;
    const { error } = await supabase.from("activity_logs").insert({
      actor_id: profileId,
      encrypted_payload: item.encrypted_payload,
    });
    if (error) {
      const kind = classifyOutboxInsertError(error);
      return {
        flushedIds,
        haltedWithError: true,
        haltCategory: kind,
      };
    }

    const latest = await getQueue();
    const next = latest.filter((x) => x.client_msg_id !== item.client_msg_id);
    await setQueue(next);
    flushedIds.push(item.client_msg_id);
  }

  return { flushedIds, haltedWithError: false, haltCategory: "none" };
}
