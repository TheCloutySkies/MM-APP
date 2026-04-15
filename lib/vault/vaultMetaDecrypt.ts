import type { VaultMetaPlainV1, VaultPartition } from "./vaultConstants";

export function decryptVaultMetaJson(
  encryptedMeta: string,
): VaultMetaPlainV1 | null {
  try {
    const j = JSON.parse(encryptedMeta) as VaultMetaPlainV1;
    if (j?.v !== 1 || typeof j.filename !== "string") return null;
    return j;
  } catch {
    return null;
  }
}

/** Update metadata JSON after changing display fields (e.g. rename). */
export function reencryptVaultMetaWithFilename(
  encryptedMeta: string,
  nextFilename: string,
): string | null {
  const cur = decryptVaultMetaJson(encryptedMeta);
  if (!cur) return null;
  const name = nextFilename.trim();
  if (!name) return null;
  const next: VaultMetaPlainV1 = { ...cur, filename: name };
  return JSON.stringify(next);
}

/** Returns a browser object URL for image/webp bytes; caller must revoke. */
export function decryptVaultThumbnailToObjectUrl(
  encryptedThumbnail: string,
): string | null {
  if (typeof URL === "undefined" || typeof Blob === "undefined") return null;
  // Secure-cloud pivot: thumbnails are optional and may be stored as a data URL.
  if (encryptedThumbnail.startsWith("data:")) return encryptedThumbnail;
  return null;
}
