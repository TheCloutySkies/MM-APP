import type { SupabaseClient } from "@supabase/supabase-js";

import { putVaultObject } from "@/lib/storage";
import { bytesToBase64 } from "@/lib/crypto/bytes";
import { appendVaultOutbox, type VaultOutboxRecord } from "@/lib/e2ee/localStore";
import { runCloutVisionPipeline } from "@/lib/media/cloutVision";

import {
    VAULT_MAX_UPLOAD_BYTES,
    type VaultMetaPlainV1,
    type VaultPartition,
} from "./vaultConstants";

export type VaultUploadProgress = {
  stage: "encrypt" | "upload" | "queued";
  pct: number;
  label: string;
};

export type VaultUploadFile = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  /** Client-generated WebP thumbnail bytes (already resized). */
  thumbnailWebp?: Uint8Array | null;
  /** Optional UI-only preview for queued rows (data URL, web). */
  localPreviewDataUrl?: string | null;
};

export type VaultUploadContext = {
  supabase: SupabaseClient;
  profileId: string;
  partition: VaultPartition;
  /** Parent folder object id; null = My Vault root. */
  parentVaultObjectId: string | null;
  /** When true and web offline, enqueue to IndexedDB instead of uploading. */
  allowOfflineQueue: boolean;
  onProgress?: (p: VaultUploadProgress) => void;
};

function notify(cb: VaultUploadContext["onProgress"], patch: VaultUploadProgress) {
  try {
    cb?.(patch);
  } catch {
    /* ignore */
  }
}

export type VaultUploadResult =
  | { ok: true; objectId: string; queued: boolean }
  | { ok: false; error: string };

export async function runVaultUpload(ctx: VaultUploadContext, file: VaultUploadFile): Promise<VaultUploadResult> {
  const { supabase, profileId, partition, parentVaultObjectId, allowOfflineQueue, onProgress } = ctx;
  if (!file.bytes?.length) return { ok: false, error: "This file looks empty." };
  if (file.bytes.byteLength > VAULT_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `For best results, keep files under ${Math.floor(VAULT_MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    };
  }

  const objectId =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const safeName = file.filename?.trim() ? file.filename.trim() : "upload";
  const storagePath = `${profileId}/${partition}/${objectId}/${safeName}`;

  notify(onProgress, { stage: "encrypt", pct: 5, label: "Preparing…" });
  await waitFrame();
  const scrubbed = runCloutVisionPipeline(file.bytes, file.mimeType);

  const metaPlain: VaultMetaPlainV1 = {
    v: 1,
    filename: file.filename,
    size: scrubbed.byteLength,
    mimeType: file.mimeType || "application/octet-stream",
  };

  const metaJson = JSON.stringify(metaPlain);
  const filePayload = scrubbed;

  notify(onProgress, { stage: "encrypt", pct: 78, label: "Almost done…" });
  await waitFrame();

  const offlineQueued =
    allowOfflineQueue && typeof navigator !== "undefined" && navigator.onLine === false;

  if (offlineQueued) {
    const rec: VaultOutboxRecord = {
      v: 1,
      queued_at: Date.now(),
      object_id: objectId,
      profile_id: profileId,
      partition,
      parent_vault_object_id: parentVaultObjectId,
      storage_path: storagePath,
      file_payload_b64: bytesToBase64(filePayload),
      encrypted_meta: metaJson,
      encrypted_thumbnail: null,
      local_label: file.filename,
      local_size: scrubbed.byteLength,
      local_mime: metaPlain.mimeType,
      local_thumb_data_url: file.localPreviewDataUrl ?? undefined,
    };
    await appendVaultOutbox(rec);
    notify(onProgress, { stage: "queued", pct: 100, label: "Saved on this device — will finish when you're back online." });
    return { ok: true, objectId, queued: true };
  }

  notify(onProgress, { stage: "upload", pct: 12, label: "Saving securely…" });
  const { error: upErr } = await putVaultObject(supabase, profileId, storagePath, filePayload, {
    contentType: file.mimeType || "application/octet-stream",
    upsert: false,
  });
  if (upErr) return { ok: false, error: "Couldn't save right now. Check your connection and try again." };

  notify(onProgress, { stage: "upload", pct: 52, label: "Saving…" });
  const { error: voErr } = await supabase
    .from("vault_objects")
    .insert({
      id: objectId,
      owner_id: profileId,
      storage_path: storagePath,
      folder_id: null,
      vault_partition: partition,
    })
    .select("id")
    .single();
  if (voErr) return { ok: false, error: "Couldn't update your Vault. Check your connection and try again." };

  notify(onProgress, { stage: "upload", pct: 78, label: "Finishing up…" });
  const { error: metaErr } = await supabase.from("vault_metadata").insert({
    vault_object_id: objectId,
    encrypted_meta: metaJson,
    encrypted_thumbnail: null,
    is_folder: false,
    parent_id: parentVaultObjectId,
    trashed_at: null,
  });
  if (metaErr) return { ok: false, error: "Couldn't finish saving. Check your connection — your file is stored safely, but details may be missing." };

  notify(onProgress, { stage: "upload", pct: 100, label: "Done." });
  return { ok: true, objectId, queued: false };
}

function waitFrame(): Promise<void> {
  return new Promise((r) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => r());
    else setTimeout(r, 0);
  });
}
