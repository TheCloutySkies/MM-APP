import * as Clipboard from "expo-clipboard";

import type { SupabaseClient } from "@supabase/supabase-js";

import { aes256GcmEncrypt, encryptUtf8 } from "@/lib/crypto/aesGcm";
import { utf8 } from "@/lib/crypto/bytes";
import { getVaultObjectBlob } from "@/lib/storage";

export type VaultExportBundle = {
  version: 1;
  createdAt: string;
  objects: { storagePath: string; cipherB64: string }[];
};

/** Fetch vault file list, download ciphertext from storage, pack encrypted JSON for air-gap handoff. */
export async function buildEncryptedVaultExport(options: {
  supabase: SupabaseClient;
/** Key must be 32 bytes; use a one-time export passphrase-derived key at call site. */
  exportKey32: Uint8Array;
}): Promise<string> {
  const { data: rows, error } = await options.supabase
    .from("vault_objects")
    .select("storage_path")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const objects: VaultExportBundle["objects"] = [];
  for (const row of rows ?? []) {
    const { data: blob, error: dlErr } = await getVaultObjectBlob(options.supabase, row.storage_path);
    if (dlErr || !blob) continue;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const inner = aes256GuardPack(buf, options.exportKey32);
    objects.push({ storagePath: row.storage_path, cipherB64: inner });
  }

  const bundle: VaultExportBundle = {
    version: 1,
    createdAt: new Date().toISOString(),
    objects,
  };

  return encryptUtf8(
    options.exportKey32,
    JSON.stringify(bundle),
    "mm-vault-export-v1",
  );
}

function aes256GuardPack(plain: Uint8Array, key: Uint8Array): string {
  const b = aes256GcmEncrypt(key, plain, utf8("mm-p2p-chunk"));
  return JSON.stringify(b);
}

export async function copyExportToClipboard(contents: string) {
  await Clipboard.setStringAsync(contents);
}
