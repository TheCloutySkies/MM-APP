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
