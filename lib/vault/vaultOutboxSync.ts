import type { SupabaseClient } from "@supabase/supabase-js";

import { base64ToBytes } from "@/lib/crypto/bytes";
import { putVaultObject } from "@/lib/storage";
import type { VaultOutboxRecord } from "@/lib/e2ee/localStore";
import { classifyOutboxInsertError, type OutboxHaltCategory } from "@/lib/e2ee/outboxSync";

export function sortVaultOutboxRecords(records: VaultOutboxRecord[]): VaultOutboxRecord[] {
  return [...records].sort((a, b) => a.queued_at - b.queued_at);
}

export type FlushVaultOutboxResult = {
  flushedObjectIds: string[];
  haltedWithError: boolean;
  haltCategory: OutboxHaltCategory;
  lastError?: { message: string; code?: string | null };
};

/**
 * Upload ciphertext + upsert DB rows. Uses Storage upsert + PK upserts so retries are safe.
 */
export async function flushVaultOutboxSequential(
  supabase: SupabaseClient,
  profileId: string,
  getQueue: () => Promise<VaultOutboxRecord[]>,
  setQueue: (next: VaultOutboxRecord[]) => Promise<void>,
): Promise<FlushVaultOutboxResult> {
  const flushedObjectIds: string[] = [];

  for (;;) {
    const sorted = sortVaultOutboxRecords(await getQueue());
    if (!sorted.length) break;

    const item = sorted[0]!;
    if (item.profile_id !== profileId) {
      const latest = await getQueue();
      const next = latest.filter((x) => x.object_id !== item.object_id);
      await setQueue(next);
      continue;
    }

    const bytes = base64ToBytes(item.file_payload_b64);

    const { error: upErr } = await putVaultObject(supabase, profileId, item.storage_path, bytes, {
      contentType: "application/octet-stream",
      upsert: true,
    });
    if (upErr) {
      const kind = classifyOutboxInsertError(upErr);
      return {
        flushedObjectIds,
        haltedWithError: true,
        haltCategory: kind,
        lastError: { message: upErr.message },
      };
    }

    const pathParts = item.storage_path.split("/");
    const vaultPartition = (pathParts[1] as "main" | "decoy" | undefined) ?? item.partition;

    const { error: voErr } = await supabase.from("vault_objects").upsert(
      {
        id: item.object_id,
        owner_id: profileId,
        storage_path: item.storage_path,
        folder_id: null,
        vault_partition: vaultPartition,
      },
      { onConflict: "id" },
    );
    if (voErr) {
      const kind = classifyOutboxInsertError(voErr);
      return {
        flushedObjectIds,
        haltedWithError: true,
        haltCategory: kind,
        lastError: { message: voErr.message, code: voErr.code },
      };
    }

    const parentId = item.parent_vault_object_id ?? null;

    const { error: metaErr } = await supabase.from("vault_metadata").upsert(
      {
        vault_object_id: item.object_id,
        encrypted_meta: item.encrypted_meta,
        encrypted_thumbnail: item.encrypted_thumbnail,
        is_folder: false,
        parent_id: parentId,
        trashed_at: null,
      },
      { onConflict: "vault_object_id" },
    );
    if (metaErr) {
      const kind = classifyOutboxInsertError(metaErr);
      return {
        flushedObjectIds,
        haltedWithError: true,
        haltCategory: kind,
        lastError: { message: metaErr.message, code: metaErr.code },
      };
    }

    const latest = await getQueue();
    const next = latest.filter((x) => x.object_id !== item.object_id);
    await setQueue(next);
    flushedObjectIds.push(item.object_id);
  }

  return { flushedObjectIds, haltedWithError: false, haltCategory: "none" };
}
