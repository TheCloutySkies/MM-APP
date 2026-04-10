export type VaultPartition = "main" | "decoy";

export function vaultBodyAad(partition: VaultPartition): string {
  return `mm-vault/${partition}`;
}

export function vaultMetaAad(partition: VaultPartition): string {
  return `mm-vault-meta/${partition}`;
}

export function vaultThumbAad(partition: VaultPartition): string {
  return `mm-vault-thumb/${partition}`;
}

/** Reasonable upper bound for browser AES-GCM + JSON payload before upload. */
export const VAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export type VaultMetaPlainV1 = {
  v: 1;
  filename: string;
  size: number;
  mimeType: string;
};

/** Plaintext MIME stored in encrypted metadata for folder placeholders (no storage blob). */
export const VAULT_FOLDER_MIME = "application/x-directory";
