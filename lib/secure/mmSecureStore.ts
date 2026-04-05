import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Web has no Keychain; use localStorage (dev convenience — less hardened than native). */
const WEB_PREFIX = "mm.ss.";

function webStorageKey(key: string): string {
  return `${WEB_PREFIX}${key}`;
}

function useWebStorage(): boolean {
  return Platform.OS === "web";
}

export async function secureSet(key: string, value: string) {
  if (useWebStorage()) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(webStorageKey(key), value);
    } catch {
      /* quota / private mode */
    }
    return;
  }
  await SecureStore.setItemAsync(key, value, OPTIONS);
}

export async function secureGet(key: string): Promise<string | null> {
  if (useWebStorage()) {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(webStorageKey(key));
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key, OPTIONS);
}

export async function secureDelete(key: string) {
  if (useWebStorage()) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(webStorageKey(key));
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.deleteItemAsync(key, OPTIONS);
}

export const SK = {
  accessToken: "mm_access_token",
  profileId: "mm_profile_id",
  username: "mm_username",
  setupDone: "mm_setup_done",
  saltMain: "mm_salt_main",
  saltDecoy: "mm_salt_decoy",
  wrapMain: "mm_wrap_main",
  wrapDecoy: "mm_wrap_decoy",
  lastRealUnlock: "mm_last_real_unlock",
  desktopMode: "mm_desktop_mode",
  /** "grid" | "list" — vault file browser layout */
  vaultDriveViewMode: "mm_vault_drive_view",
  /** "woodland" | "nightops" — tactical chrome variant */
  visualTheme: "mm_visual_theme",
  /** JSON string[] — main tab route names (home, vault, …) */
  tabBarOrder: "mm_tab_bar_order",
} as const;

/** Clear MM session tokens only (crypto setup on device preserved). */
export async function wipeSessionTokens() {
  await secureDelete(SK.accessToken);
  await secureDelete(SK.profileId);
  await secureDelete(SK.username);
}

/** Nuclear: session + vault wraps + prefs (dead man / panic). */
export async function wipeLocalSecrets() {
  const keys = Object.values(SK);
  if (useWebStorage()) {
    if (typeof window !== "undefined") {
      for (const k of keys) {
        try {
          window.localStorage.removeItem(webStorageKey(k));
        } catch {
          /* ignore */
        }
      }
    }
    return;
  }
  await Promise.all(keys.map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
}
