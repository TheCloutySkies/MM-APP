import { Platform } from "react-native";

import { secureGet, secureSet, SK } from "@/lib/secure/mmSecureStore";

export type LayoutPreference = "mobile" | "desktop" | "auto";

export const LAYOUT_PREF_STORAGE_KEY = "mm_layout_mode";
export const LAYOUT_WELCOME_STORAGE_KEY = "mm_layout_welcome_seen";

/** Breakpoint aligned with common tablet width; "auto" uses this. */
export const LAYOUT_AUTO_DESKTOP_MIN_WIDTH = 768;

function webStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getLayoutPreference(): LayoutPreference {
  const ls = webStorage();
  if (!ls) return "auto";
  const raw = ls.getItem(LAYOUT_PREF_STORAGE_KEY);
  if (raw === "mobile" || raw === "desktop" || raw === "auto") return raw;
  return "auto";
}

export function setLayoutPreference(pref: LayoutPreference): void {
  const ls = webStorage();
  if (!ls) return;
  ls.setItem(LAYOUT_PREF_STORAGE_KEY, pref);
}

export function parseLayoutPreferenceValue(raw: unknown): LayoutPreference {
  if (raw === "mobile" || raw === "desktop" || raw === "auto") return raw;
  return "auto";
}

/** Async tri-state read: web uses public layout key; native uses secure store. */
export async function getLayoutPreferenceAsync(): Promise<LayoutPreference> {
  if (Platform.OS === "web") return getLayoutPreference();
  const raw = await secureGet(SK.layoutTri);
  return parseLayoutPreferenceValue(raw);
}

/** Persist tri-state everywhere we cache it on this device. */
export async function setLayoutPreferencePersistent(pref: LayoutPreference): Promise<void> {
  setLayoutPreference(pref);
  await secureSet(SK.layoutTri, pref);
}

export function resolveDesktopFromLayoutPref(width: number, pref: LayoutPreference): boolean {
  if (pref === "desktop") return true;
  if (pref === "mobile") return false;
  return width >= LAYOUT_AUTO_DESKTOP_MIN_WIDTH;
}

export function needsLayoutWelcome(): boolean {
  const ls = webStorage();
  if (!ls) return false;
  return ls.getItem(LAYOUT_WELCOME_STORAGE_KEY) !== "1";
}

export function markLayoutWelcomeSeen(): void {
  const ls = webStorage();
  if (!ls) return;
  ls.setItem(LAYOUT_WELCOME_STORAGE_KEY, "1");
}

export function reloadWebApp(): void {
  if (typeof window === "undefined") return;
  window.location.reload();
}
