import localforage from "localforage";

const LF = localforage.createInstance({ name: "mm-app", storeName: "gis_encrypted_drafts" });

const KEY_LATEST = "latest_encrypted_fc";

/** Persist encrypted GeoJSON blob (never plaintext coords on disk). Web: IndexedDB via localforage. */
export async function saveEncryptedGisDraft(ciphertextHexOrB64: string): Promise<void> {
  await LF.setItem(KEY_LATEST, ciphertextHexOrB64);
}

export async function loadEncryptedGisDraft(): Promise<string | null> {
  const v = await LF.getItem<string>(KEY_LATEST);
  return v ?? null;
}

export async function clearEncryptedGisDraft(): Promise<void> {
  await LF.removeItem(KEY_LATEST);
}
