/** Plaintext prefix embedded in encrypted chat bodies — points at a row in vault_objects + storage. */

export type VaultAttachPayloadV1 = {
  v: 1;
  objectId: string;
  storagePath: string;
  label: string;
};

const PREFIX = "MM_VAULT_REF_V1:";

export function encodeVaultAttachPayload(p: VaultAttachPayloadV1): string {
  return PREFIX + JSON.stringify(p);
}

export function tryParseVaultAttachPayload(plaintext: string): VaultAttachPayloadV1 | null {
  if (!plaintext.startsWith(PREFIX)) return null;
  try {
    const j = JSON.parse(plaintext.slice(PREFIX.length)) as VaultAttachPayloadV1;
    if (j?.v !== 1 || typeof j.objectId !== "string" || typeof j.storagePath !== "string") return null;
    return {
      v: 1,
      objectId: j.objectId,
      storagePath: j.storagePath,
      label: typeof j.label === "string" ? j.label : "Vault file",
    };
  } catch {
    return null;
  }
}
