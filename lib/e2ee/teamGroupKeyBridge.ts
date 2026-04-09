/**
 * In-memory bridge: team group AES key loaded by Live Comms is mirrored here so map/vault
 * can encrypt audit payloads without unlocking a second UI.
 * Cleared when vault locks or group key unload fails.
 */
let bridged: Uint8Array | null = null;

export function setTeamGroupKeyBridge(key: Uint8Array | null): void {
  bridged = key && key.length === 32 ? new Uint8Array(key) : null;
}

export function getTeamGroupKeyBridge(): Uint8Array | null {
  return bridged;
}
