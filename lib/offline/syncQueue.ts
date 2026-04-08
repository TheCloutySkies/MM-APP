/**
 * Placeholder for offline-first writes (vault uploads, ops reports, map sync).
 * Enqueue encrypted payloads here when offline; `flushPendingSync` runs after `online`.
 */

export type OfflineSyncKind = "vault_upload" | "ops_report" | "map_marker";

export type OfflineSyncPayload = {
  id: string;
  kind: OfflineSyncKind;
  createdAt: number;
  /** Opaque JSON for future processors — never log plaintext. */
  opaque: string;
};

const FLUSH_LOG = __DEV__ ? "[offline-sync]" : "";

export async function enqueueOfflineSync(_item: OfflineSyncPayload): Promise<void> {
  // TODO: persist to IndexedDB queue + show pending count in UI
  if (FLUSH_LOG) console.info(FLUSH_LOG, "enqueue (stub)");
}

/** Called on `window` `online` — extend to drain queue to Supabase. */
export async function flushPendingSyncStub(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (FLUSH_LOG) console.info(FLUSH_LOG, "flush stub — wire Supabase in a follow-up");
}
