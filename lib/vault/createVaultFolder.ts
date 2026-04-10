import type { SupabaseClient } from "@supabase/supabase-js";

import { encryptUtf8 } from "@/lib/crypto/aesGcm";

import {
  VAULT_FOLDER_MIME,
  vaultMetaAad,
  type VaultMetaPlainV1,
  type VaultPartition,
} from "./vaultConstants";

export async function insertVaultFolder(params: {
  supabase: SupabaseClient;
  profileId: string;
  vaultKey: Uint8Array;
  partition: VaultPartition;
  folderName: string;
  parentVaultObjectId: string | null;
}): Promise<{ ok: true; objectId: string } | { ok: false; error: string }> {
  const { supabase, profileId, vaultKey, partition, folderName, parentVaultObjectId } = params;
  if (vaultKey.length !== 32) return { ok: false, error: "Unlock your Vault to continue." };
  const name = folderName.trim();
  if (!name) return { ok: false, error: "Enter a folder name." };

  const objectId =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const metaPlain: VaultMetaPlainV1 = {
    v: 1,
    filename: name,
    size: 0,
    mimeType: VAULT_FOLDER_MIME,
  };
  const encryptedMeta = encryptUtf8(vaultKey, JSON.stringify(metaPlain), vaultMetaAad(partition));

  const { error: voErr } = await supabase.from("vault_objects").insert({
    id: objectId,
    owner_id: profileId,
    storage_path: null,
    folder_id: null,
    vault_partition: partition,
  });
  if (voErr) return { ok: false, error: voErr.message };

  const { error: metaErr } = await supabase.from("vault_metadata").insert({
    vault_object_id: objectId,
    encrypted_meta: encryptedMeta,
    encrypted_thumbnail: null,
    is_folder: true,
    parent_id: parentVaultObjectId,
    trashed_at: null,
  });
  if (metaErr) return { ok: false, error: metaErr.message };

  return { ok: true, objectId };
}
