type Store = {
  dbName: string;
  storeName: string;
  version: number;
};

const DEFAULT_STORE: Store = { dbName: "mm-signals", storeName: "kv", version: 1 };

function openDb(store: Store = DEFAULT_STORE): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable.");
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(store.dbName, store.version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(store.storeName)) {
        db.createObjectStore(store.storeName);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function idbGet<T>(key: string, store: Store = DEFAULT_STORE): Promise<T | null> {
  const db = await openDb(store);
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(store.storeName, "readonly");
    const os = tx.objectStore(store.storeName);
    const req = os.get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
  });
}

export async function idbSet<T>(key: string, value: T, store: Store = DEFAULT_STORE): Promise<void> {
  const db = await openDb(store);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store.storeName, "readwrite");
    const os = tx.objectStore(store.storeName);
    const req = os.put(value as unknown as any, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB set failed"));
  });
}

export async function idbDel(key: string, store: Store = DEFAULT_STORE): Promise<void> {
  const db = await openDb(store);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store.storeName, "readwrite");
    const os = tx.objectStore(store.storeName);
    const req = os.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB delete failed"));
  });
}

