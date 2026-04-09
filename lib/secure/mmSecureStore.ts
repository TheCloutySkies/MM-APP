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
  /** Tri-state layout: mobile | desktop | auto — native + redundant web cache under mm.ss.* */
  layoutTri: "mm_layout_tri",
  desktopMode: "mm_desktop_mode",
  /** "grid" | "list" — vault file browser layout */
  vaultDriveViewMode: "mm_vault_drive_view",
  /** "woodland" | "nightops" — tactical chrome variant */
  visualTheme: "mm_visual_theme",
  /** 0–100 — extra map darken veil in Night Ops (brightness / overlay). */
  mapNightDimPercent: "mm_map_night_dim",
  /** JSON string[] — main tab route names (home, vault, …) */
  tabBarOrder: "mm_tab_bar_order",
  /** Pixels — left rail width when desktop / war-room layout (web). */
  tabRailWidthDesk: "mm_tab_rail_w_desk",
  /** Pixels — bottom tab bar height (mobile / web compact). */
  tabRailHeightMob: "mm_tab_rail_h_mob",
  /** SHA-256 hex of primary PIN — calendar routing / offline verify (never plaintext PIN). */
  primaryPinHash: "mm_primary_pin_hash",
  /** SHA-256 hex of duress PIN. */
  duressPinHash: "mm_duress_pin_hash",
  /** Hex salt for calendar PBKDF2(primary). */
  calendarSaltPrimary: "mm_cal_salt_pri",
  /** Hex salt for calendar PBKDF2(duress). */
  calendarSaltDuress: "mm_cal_salt_dur",
  /** Optional 64-char hex — same as EXPO_PUBLIC_MM_MAP_SHARED_KEY; ops + map decrypt for the whole unit. */
  teamMapSharedKeyHex: "mm_team_map_shared_key_hex",
  /** Main-vault users only: "1" after passing ops screening and receiving the unit operations key. */
  opsScreeningComplete: "mm_ops_screening_complete",
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
