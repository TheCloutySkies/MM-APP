import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { create } from "zustand";

import {
    MAIN_TAB_ROUTE_ORDER,
    type MainTabRouteId,
    normalizeTabOrder,
    reorderTabBefore,
} from "@/constants/mainTabs";
import type { VisualThemeId } from "@/constants/TacticalTheme";
import * as aes from "@/lib/crypto/aesGcm";
import { hexToBytes, utf8 } from "@/lib/crypto/bytes";
import { deriveKeyArgon2id } from "@/lib/crypto/kdf";
import { getMapSharedKeyHex } from "@/lib/env";
import { SK, secureGet, secureSet, wipeLocalSecrets, wipeSessionTokens } from "@/lib/secure/mmSecureStore";
import { getAuthSupabase } from "@/lib/supabase/authSupabase";
import { createMMSupabase } from "@/lib/supabase/mmClient";

export type VaultMode = "main" | "decoy";

export type VaultDriveViewMode = "grid" | "list";

export type SessionSource = "auth" | "legacy";

type MMState = {
  hydrated: boolean;
  accessToken: string | null;
  profileId: string | null;
  username: string | null;
  /** False until user sets an operational callsign (mm_profiles.callsign_ok). */
  callsignOk: boolean;
  /** How the current API token was obtained — affects which Supabase client we keep. */
  sessionSource: SessionSource | null;
  setupComplete: boolean;
  vaultMode: VaultMode | null;
  /** 32-byte AES keys in memory only; cleared on lock */
  mainVaultKey: Uint8Array | null;
  decoyVaultKey: Uint8Array | null;
  supabase: SupabaseClient | null;
  desktopMode: boolean;
  vaultDriveViewMode: VaultDriveViewMode;
  visualTheme: VisualThemeId;
  /** User-defined order for main tab rail (home, vault, map, …). */
  tabBarOrder: MainTabRouteId[];
};

type MMActions = {
  hydrateFromStorage: () => Promise<void>;
  logout: () => Promise<void>;
  lock: () => Promise<void>;
  /** Scorched earth: clear session + keys */
  fullLock: () => Promise<void>;
  login: (
    token: string,
    profileId: string,
    username: string,
    source?: SessionSource,
  ) => Promise<void>;
  loadDesktopPref: () => Promise<void>;
  setDesktopMode: (v: boolean) => Promise<void>;
  setVisualTheme: (v: VisualThemeId) => Promise<void>;
  completeSetup: (args: {
    masterPassword: string;
    primaryPin: string;
    duressPin: string;
    mainVaultKey: Uint8Array;
    decoyVaultKey: Uint8Array;
  }) => Promise<void>;
  tryUnlock: (
    masterPassword: string,
    pin: string,
  ) => Promise<{ ok: boolean; mode?: VaultMode }>;
  setSupabaseClient: (c: SupabaseClient | null) => void;
  touchRealUnlock: () => Promise<void>;
  setVaultDriveViewMode: (v: VaultDriveViewMode) => Promise<void>;
  /** Re-read mm_profiles.username + callsign_ok (after callsign save or remote change). */
  syncMmProfileRow: () => Promise<void>;
  setTabBarOrder: (order: MainTabRouteId[]) => Promise<void>;
  /** Move one main tab to sit immediately before another (for drag reorder). */
  reorderMainTabs: (dragged: MainTabRouteId, beforeId: MainTabRouteId) => Promise<void>;
};

async function persistSession(token: string, profileId: string, username: string) {
  await secureSet(SK.accessToken, token);
  await secureSet(SK.profileId, profileId);
  await secureSet(SK.username, username);
}

async function clearGoTrueSession() {
  try {
    await getAuthSupabase().auth.signOut();
  } catch {
    /* offline / already signed out */
  }
}

async function loadMmProfileRow(
  supabase: SupabaseClient,
  profileId: string,
): Promise<{ username: string; callsignOk: boolean } | null> {
  const { data, error } = await supabase
    .from("mm_profiles")
    .select("username, callsign_ok")
    .eq("id", profileId)
    .maybeSingle();
  if (error || !data?.username) return null;
  return { username: data.username as string, callsignOk: Boolean(data.callsign_ok) };
}

/**
 * Hydration must use the same recovery path the client uses for storage-backed sessions.
 * On web, `onAuthStateChange` → `INITIAL_SESSION` tracks GoTrue initialization; some WebKit
 * builds share reports of `getSession()` disagreeing with that first paint window (supabase-js#1560 class of issues).
 */
async function resolveHydrateAuthSession(client: SupabaseClient): Promise<Session | null> {
  if (Platform.OS !== "web") {
    const { data } = await client.auth.getSession();
    return data.session ?? null;
  }
  return await new Promise<Session | null>((resolve) => {
    let finished = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event !== "INITIAL_SESSION") return;
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      data.subscription.unsubscribe();
      resolve(session);
    });
    timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;
      data.subscription.unsubscribe();
      resolve(null);
    }, 10_000);
  });
}

export const useMMStore = create<MMState & MMActions>((set, get) => ({
  hydrated: false,
  accessToken: null,
  profileId: null,
  username: null,
  callsignOk: true,
  sessionSource: null,
  setupComplete: false,
  vaultMode: null,
  mainVaultKey: null,
  decoyVaultKey: null,
  supabase: null,
  desktopMode: false,
  vaultDriveViewMode: "list",
  visualTheme: "woodland",
  tabBarOrder: [...MAIN_TAB_ROUTE_ORDER],

  setSupabaseClient: (c) => set({ supabase: c }),

  setVisualTheme: async (v) => {
    await secureSet(SK.visualTheme, v);
    set({ visualTheme: v });
  },

  setVaultDriveViewMode: async (v) => {
    await secureSet(SK.vaultDriveViewMode, v);
    set({ vaultDriveViewMode: v });
  },

  hydrateFromStorage: async () => {
    const setupDone = (await secureGet(SK.setupDone)) === "1";
    const desktopMode = (await secureGet(SK.desktopMode)) === "1";
    const vmode = (await secureGet(SK.vaultDriveViewMode)) as VaultDriveViewMode | null;
    const vaultDriveViewMode: VaultDriveViewMode = vmode === "grid" ? "grid" : "list";
    const vt = (await secureGet(SK.visualTheme)) as VisualThemeId | null;
    const visualTheme: VisualThemeId = vt === "nightops" ? "nightops" : "woodland";

    const tabBarOrder = normalizeTabOrder(await secureGet(SK.tabBarOrder));

    let token: string | null = null;
    let profileId: string | null = null;
    let username: string | null = null;
    let callsignOk = true;
    let sessionSource: SessionSource | null = null;
    let supabase: SupabaseClient | null = null;

    try {
      const authClient = getAuthSupabase();
      const session = await resolveHydrateAuthSession(authClient);
      if (session?.user && session.access_token) {
        token = session.access_token;
        profileId = session.user.id;
        sessionSource = "auth";
        supabase = getAuthSupabase();
        const row = await loadMmProfileRow(supabase, profileId);
        if (row) {
          username = row.username;
          callsignOk = row.callsignOk;
        } else {
          username = session.user.email ?? session.user.id;
          callsignOk = false;
        }
        await persistSession(token, profileId, username);
      }
    } catch {
      /* missing env or AsyncStorage — fall through to legacy */
    }

    if (!token) {
      token = await secureGet(SK.accessToken);
      profileId = await secureGet(SK.profileId);
      username = await secureGet(SK.username);
      if (token && profileId) {
        sessionSource = "legacy";
        supabase = await createMMSupabase(token);
        const row = await loadMmProfileRow(supabase, profileId);
        if (row) {
          username = row.username;
          callsignOk = row.callsignOk;
          await persistSession(token, profileId, username);
        }
      }
    }

    set({
      hydrated: true,
      accessToken: token,
      profileId,
      username,
      callsignOk,
      sessionSource,
      setupComplete: setupDone,
      supabase,
      desktopMode,
      vaultDriveViewMode,
      visualTheme,
      tabBarOrder,
    });
  },

  syncMmProfileRow: async () => {
    const { supabase, profileId } = get();
    if (!supabase || !profileId) return;
    const row = await loadMmProfileRow(supabase, profileId);
    if (!row) return;
    const tok = get().accessToken;
    if (tok) await persistSession(tok, profileId, row.username);
    set({ username: row.username, callsignOk: row.callsignOk });
  },

  loadDesktopPref: async () => {
    const desktopMode = (await secureGet(SK.desktopMode)) === "1";
    set({ desktopMode });
  },

  setDesktopMode: async (v) => {
    await secureSet(SK.desktopMode, v ? "1" : "0");
    set({ desktopMode: v });
  },

  setTabBarOrder: async (order) => {
    const normalized = normalizeTabOrder(JSON.stringify(order));
    await secureSet(SK.tabBarOrder, JSON.stringify(normalized));
    set({ tabBarOrder: normalized });
  },

  reorderMainTabs: async (dragged, beforeId) => {
    const cur = get().tabBarOrder;
    const next = reorderTabBefore(cur, dragged, beforeId);
    await get().setTabBarOrder(next);
  },

  login: async (loginToken, profileId, username, source: SessionSource = "legacy") => {
    try {
      await persistSession(loginToken, profileId, username);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "secure storage";
      throw new Error(
        `Could not save your session on this device (${msg}). Try closing other apps, freeing storage, then try again.`,
      );
    }
    const supabase =
      source === "auth" ? getAuthSupabase() : await createMMSupabase(loginToken);
    let displayUsername = username;
    let callsignOk = true;
    const row = await loadMmProfileRow(supabase, profileId);
    if (row) {
      displayUsername = row.username;
      callsignOk = row.callsignOk;
      await persistSession(loginToken, profileId, displayUsername);
    } else if (source === "auth") {
      callsignOk = false;
    }
    set({
      accessToken: loginToken,
      profileId,
      username: displayUsername,
      callsignOk,
      sessionSource: source,
      supabase,
    });
  },

  logout: async () => {
    get().mainVaultKey?.fill(0);
    get().decoyVaultKey?.fill(0);
    await clearGoTrueSession();
    await wipeSessionTokens();
    const setupDone = (await secureGet(SK.setupDone)) === "1";
    set({
      accessToken: null,
      profileId: null,
      username: null,
      callsignOk: true,
      sessionSource: null,
      vaultMode: null,
      mainVaultKey: null,
      decoyVaultKey: null,
      supabase: null,
      setupComplete: setupDone,
    });
  },

  lock: async () => {
    get().mainVaultKey?.fill(0);
    get().decoyVaultKey?.fill(0);
    set({
      vaultMode: null,
      mainVaultKey: null,
      decoyVaultKey: null,
    });
  },

  fullLock: async () => {
    get().mainVaultKey?.fill(0);
    get().decoyVaultKey?.fill(0);
    await clearGoTrueSession();
    await wipeLocalSecrets();
    set({
      accessToken: null,
      profileId: null,
      username: null,
      callsignOk: true,
      sessionSource: null,
      setupComplete: false,
      vaultMode: null,
      mainVaultKey: null,
      decoyVaultKey: null,
      supabase: null,
    });
  },

  completeSetup: async ({ masterPassword, primaryPin, duressPin, mainVaultKey, decoyVaultKey }) => {
    const saltMain = cryptoRandomSalt();
    const saltDecoy = cryptoRandomSalt();
    const kMain = await deriveKeyArgon2id(masterPassword + primaryPin, saltMain);
    const kDecoy = await deriveKeyArgon2id(masterPassword + duressPin, saltDecoy);
    const wrapMain = aes.aes256GcmEncrypt(kMain, mainVaultKey, utf8("mm-main-wrap"));
    const wrapDecoy = aes.aes256GcmEncrypt(kDecoy, decoyVaultKey, utf8("mm-decoy-wrap"));
    kMain.fill(0);
    kDecoy.fill(0);
    await secureSet(SK.saltMain, saltMain);
    await secureSet(SK.saltDecoy, saltDecoy);
    await secureSet(SK.wrapMain, JSON.stringify(wrapMain));
    await secureSet(SK.wrapDecoy, JSON.stringify(wrapDecoy));
    await secureSet(SK.setupDone, "1");
    set({ setupComplete: true });
  },

  tryUnlock: async (masterPassword, pin) => {
    const saltMain = await secureGet(SK.saltMain);
    const saltDecoy = await secureGet(SK.saltDecoy);
    const wrapMainJson = await secureGet(SK.wrapMain);
    const wrapDecoyJson = await secureGet(SK.wrapDecoy);
    if (!saltMain || !saltDecoy || !wrapMainJson || !wrapDecoyJson) {
      return { ok: false };
    }
    const kMainTry = await deriveKeyArgon2id(masterPassword + pin, saltMain);
    const kDecoyTry = await deriveKeyArgon2id(masterPassword + pin, saltDecoy);
    let mainKey: Uint8Array | null = null;
    let decoyKey: Uint8Array | null = null;
    try {
      mainKey = aes.aes256GcmDecrypt(kMainTry, JSON.parse(wrapMainJson), utf8("mm-main-wrap"));
    } catch {
      mainKey = null;
    }
    try {
      decoyKey = aes.aes256GcmDecrypt(kDecoyTry, JSON.parse(wrapDecoyJson), utf8("mm-decoy-wrap"));
    } catch {
      decoyKey = null;
    }
    kMainTry.fill(0);
    kDecoyTry.fill(0);
    await new Promise((r) => setTimeout(r, 400));
    if (mainKey && decoyKey) {
      mainKey.fill(0);
      decoyKey.fill(0);
      return { ok: false };
    }
    if (mainKey) {
      set({ mainVaultKey: mainKey, decoyVaultKey: null, vaultMode: "main" });
      return { ok: true, mode: "main" };
    }
    if (decoyKey) {
      set({ decoyVaultKey: decoyKey, mainVaultKey: null, vaultMode: "decoy" });
      return { ok: true, mode: "decoy" };
    }
    return { ok: false };
  },

  touchRealUnlock: async () => {
    await secureSet(SK.lastRealUnlock, String(Date.now()));
  },
}));

function cryptoRandomSalt(): string {
  const a = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(a);
  }
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Marker encryption: shared group hex key, else vault key for current partition. */
export function resolveMapEncryptKey(
  mainVaultKey: Uint8Array | null,
  decoyVaultKey: Uint8Array | null,
  mode: VaultMode | null,
): Uint8Array {
  const hex = getMapSharedKeyHex();
  if (hex) return hexToBytes(hex);
  if (mode === "main" && mainVaultKey?.length === 32) return mainVaultKey;
  if (mode === "decoy" && decoyVaultKey?.length === 32) return decoyVaultKey;
  throw new Error("Map key unavailable");
}
