import localforage from "localforage";

const store = localforage.createInstance({ name: "mm-app", storeName: "e2ee" });

export type WrappedPrivateRecord = {
  v: 1;
  profileId: string;
  ivB64: string;
  ctB64: string;
};

const privKey = (profileId: string) => `e2ee:priv:${profileId}`;

export async function loadWrappedPrivate(profileId: string): Promise<WrappedPrivateRecord | null> {
  const row = await store.getItem<WrappedPrivateRecord | null>(privKey(profileId));
  return row ?? null;
}

export async function saveWrappedPrivate(record: WrappedPrivateRecord): Promise<void> {
  await store.setItem(privKey(record.profileId), record);
}

export async function clearWrappedPrivate(profileId: string): Promise<void> {
  await store.removeItem(privKey(profileId));
}

export type OutboxRecord = {
  v: 1;
  /** Ms since epoch — oldest first when flushing (store-and-forward). */
  queued_at?: number;
  payload: {
    recipient_id: string | null;
    group_id: string | null;
    iv: string;
    ciphertext: string;
    client_msg_id: string;
  };
};

const OUTBOX_KEY = "e2ee:outbox";

export async function loadOutbox(): Promise<OutboxRecord[]> {
  const raw = await store.getItem<OutboxRecord[] | null>(OUTBOX_KEY);
  return Array.isArray(raw) ? raw : [];
}

export async function appendOutbox(entry: OutboxRecord): Promise<void> {
  const q = await loadOutbox();
  q.push(entry);
  await store.setItem(OUTBOX_KEY, q);
}

export async function replaceOutbox(entries: OutboxRecord[]): Promise<void> {
  await store.setItem(OUTBOX_KEY, entries);
}

/** Pending `activity_logs` inserts when offline (same store instance as E2EE). */
export type ActivityOutboxRecord = {
  v: 1;
  queued_at: number;
  client_msg_id: string;
  encrypted_payload: string;
};

const ACTIVITY_OUTBOX_KEY = "e2ee:activity-outbox";

export async function loadActivityOutbox(): Promise<ActivityOutboxRecord[]> {
  const raw = await store.getItem<ActivityOutboxRecord[] | null>(ACTIVITY_OUTBOX_KEY);
  return Array.isArray(raw) ? raw : [];
}

export async function appendActivityOutbox(entry: ActivityOutboxRecord): Promise<void> {
  const q = await loadActivityOutbox();
  q.push(entry);
  await store.setItem(ACTIVITY_OUTBOX_KEY, q);
}

export async function replaceActivityOutbox(entries: ActivityOutboxRecord[]): Promise<void> {
  await store.setItem(ACTIVITY_OUTBOX_KEY, entries);
}

/** Pending vault file uploads (encrypted payload already prepared; flushed to Storage + DB when online). */
export type VaultOutboxRecord = {
  v: 1;
  queued_at: number;
  /** Same as `vault_objects.id` / storage path token for idempotent upserts. */
  object_id: string;
  profile_id: string;
  partition: "main" | "decoy";
  /** Parent folder `vault_objects.id`, or null for My Vault root. */
  parent_vault_object_id?: string | null;
  /** @deprecated Legacy `vault_folders.id` from older builds. */
  folder_id?: string | null;
  storage_path: string;
  /** Base64 of UTF-8 JSON body uploaded to Storage (encrypted file bundle). */
  file_payload_b64: string;
  encrypted_meta: string;
  encrypted_thumbnail: string | null;
  /** Plaintext hints for local queued-row UI only (never sent to server). */
  local_label: string;
  local_size: number;
  local_mime: string;
  /** data: URL or blob URL for grid while queued (web); optional. */
  local_thumb_data_url?: string;
};

const VAULT_OUTBOX_KEY = "e2ee:vault-outbox";

export async function loadVaultOutbox(): Promise<VaultOutboxRecord[]> {
  const raw = await store.getItem<VaultOutboxRecord[] | null>(VAULT_OUTBOX_KEY);
  return Array.isArray(raw) ? raw : [];
}

export async function appendVaultOutbox(entry: VaultOutboxRecord): Promise<void> {
  const q = await loadVaultOutbox();
  q.push(entry);
  await store.setItem(VAULT_OUTBOX_KEY, q);
}

export async function replaceVaultOutbox(entries: VaultOutboxRecord[]): Promise<void> {
  await store.setItem(VAULT_OUTBOX_KEY, entries);
}
