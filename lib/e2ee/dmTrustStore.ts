import localforage from "localforage";

const store = localforage.createInstance({ name: "mm-app", storeName: "e2ee" });

export type DmTrustRecord = {
  v: 1;
  peerId: string;
  /** SPKI base64 observed when user marked verified (or last seen). */
  spkiB64: string;
  verified: boolean;
};

function key(ownerId: string, peerId: string): string {
  return `e2ee:dmTrust:${ownerId}:${peerId}`;
}

export async function loadDmTrust(ownerId: string, peerId: string): Promise<DmTrustRecord | null> {
  const row = await store.getItem<DmTrustRecord | null>(key(ownerId, peerId));
  return row && row.v === 1 ? row : null;
}

export async function saveDmTrust(ownerId: string, rec: DmTrustRecord): Promise<void> {
  await store.setItem(key(ownerId, rec.peerId), rec);
}

export async function clearDmTrust(ownerId: string, peerId: string): Promise<void> {
  await store.removeItem(key(ownerId, peerId));
}

export type DmTrustReconcile = "ok" | "unverified" | "broken";

/**
 * Call with the current server SPKI when sending or before show verify UI.
 * - If user had verified and SPKI changed → broken (MITM / new device).
 * - Updates stored spkiB64 to current.
 */
export async function reconcileDmTrustWithServerKey(
  ownerId: string,
  peerId: string,
  currentSpkiB64: string,
): Promise<DmTrustReconcile> {
  const prev = await loadDmTrust(ownerId, peerId);
  if (!prev) {
    await saveDmTrust(ownerId, { v: 1, peerId, spkiB64: currentSpkiB64, verified: false });
    return "unverified";
  }
  if (prev.verified && prev.spkiB64 !== currentSpkiB64) {
    await saveDmTrust(ownerId, { v: 1, peerId, spkiB64: currentSpkiB64, verified: false });
    return "broken";
  }
  if (prev.spkiB64 !== currentSpkiB64) {
    await saveDmTrust(ownerId, { ...prev, spkiB64: currentSpkiB64 });
  }
  return prev.verified ? "ok" : "unverified";
}

export async function markDmVerified(ownerId: string, peerId: string, spkiB64: string): Promise<void> {
  await saveDmTrust(ownerId, { v: 1, peerId, spkiB64, verified: true });
}

export async function markDmUnverified(ownerId: string, peerId: string, spkiB64: string): Promise<void> {
  await saveDmTrust(ownerId, { v: 1, peerId, spkiB64, verified: false });
}
