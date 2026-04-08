/** In-memory calendar AES key; wiped when leaving the calendar tab. */

let activeKey32: Uint8Array | null = null;
let activeMode: "real" | "decoy" | null = null;

export function setCalendarSessionKey(key32: Uint8Array | null, mode: "real" | "decoy" | null) {
  if (activeKey32) {
    activeKey32.fill(0);
    activeKey32 = null;
  }
  activeMode = null;
  if (key32 && key32.length === 32) {
    activeKey32 = key32;
    activeMode = mode;
  }
}

export function getCalendarSessionKey(): Uint8Array | null {
  return activeKey32;
}

export function getCalendarSessionMode(): "real" | "decoy" | null {
  return activeMode;
}

export function clearCalendarSession() {
  setCalendarSessionKey(null, null);
}
