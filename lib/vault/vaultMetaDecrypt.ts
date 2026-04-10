import { aes256GcmDecrypt, decryptUtf8, encryptUtf8, type AeadBundle } from "@/lib/crypto/aesGcm";
import { utf8 } from "@/lib/crypto/bytes";

import type { VaultMetaPlainV1, VaultPartition } from "./vaultConstants";
import { vaultMetaAad, vaultThumbAad } from "./vaultConstants";

export function decryptVaultMetaJson(
  key32: Uint8Array,
  encryptedMeta: string,
  partition: VaultPartition,
): VaultMetaPlainV1 | null {
  try {
    const plain = decryptUtf8(key32, encryptedMeta, vaultMetaAad(partition));
    const j = JSON.parse(plain) as VaultMetaPlainV1;
    if (j?.v !== 1 || typeof j.filename !== "string") return null;
    return j;
  } catch {
    return null;
  }
}

/** Re-encrypt metadata JSON after changing display fields (e.g. rename). */
export function reencryptVaultMetaWithFilename(
  key32: Uint8Array,
  encryptedMeta: string,
  partition: VaultPartition,
  nextFilename: string,
): string | null {
  const cur = decryptVaultMetaJson(key32, encryptedMeta, partition);
  if (!cur) return null;
  const name = nextFilename.trim();
  if (!name) return null;
  const next: VaultMetaPlainV1 = { ...cur, filename: name };
  return encryptUtf8(key32, JSON.stringify(next), vaultMetaAad(partition));
}

/** Returns a browser object URL for image/webp bytes; caller must revoke. */
export function decryptVaultThumbnailToObjectUrl(
  key32: Uint8Array,
  encryptedThumbnail: string,
  partition: VaultPartition,
): string | null {
  if (typeof URL === "undefined" || typeof Blob === "undefined") return null;
  try {
    const bundle = JSON.parse(encryptedThumbnail) as AeadBundle;
    const raw = aes256GcmDecrypt(key32, bundle, utf8(vaultThumbAad(partition)));
    const blob = new Blob([Uint8Array.from(raw)], { type: "image/webp" });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
