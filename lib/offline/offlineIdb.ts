import { idbGet, idbSet } from "@/lib/signals/idb";

/** Separate DB from `mm-signals` — generic KV for offline snapshots & queues. */
const MM_OFFLINE_KV = { dbName: "mm-offline", storeName: "kv", version: 1 } as const;

export async function offlineKvGet<T>(key: string): Promise<T | null> {
  return idbGet<T>(key, MM_OFFLINE_KV);
}

export async function offlineKvSet<T>(key: string, value: T): Promise<void> {
  return idbSet(key, value, MM_OFFLINE_KV);
}
