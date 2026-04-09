import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { Dimensions, Platform } from "react-native";
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
import type { LayoutPreference } from "@/lib/layout/layoutPreference";
import {
    getLayoutPreference,
    getLayoutPreferenceAsync,
    resolveDesktopFromLayoutPref,
    setLayoutPreferencePersistent
} from "@/lib/layout/layoutPreference";
import { SCREENING_REWARD_TEAM_KEY_HEX } from "@/lib/opsScreening";
import { SK, secureDelete, secureGet, secureSet, wipeLocalSecrets, wipeSessionTokens } from "@/lib/secure/mmSecureStore";
import { getAuthSupabase } from "@/lib/supabase/authSupabase";
import { ensureCalendarSaltOnUnlock } from "@/lib/supabase/calendarProfile";
import { isJwtExpired, jwtDisplayHandle, jwtSub } from "@/lib/supabase/jwtExp";
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
  /** Main tab rail width (px) when desktop / war-room layout. */
  tabRailWidthPx: number;
  /** Main tab bar height (px) when mobile / bottom rail. */
  tabRailHeightPx: number;
  /** 0–100 — darken map basemap in Night Ops (brightness / overlay). */
  mapNightDimPercent: number;
  /**
   * Optional 64-char hex — overrides env for map/mission/bulletincrypto; persisted locally.
   * Lets teammates match EXPO_PUBLIC_MM_MAP_SHARED_KEY without rebuilding.
   */
  teamMapSharedKeyHex: string | null;
  /** Device-local: completed post-unlock screening (main vault); grants shared ops key from env. */
  opsScreeningComplete: boolean;
};

function layoutWidthPx(): number {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") return window.innerWidth;
    return 1024;
  }
  return Dimensions.get("window").width;
}

/** Left tab rail (desktop). */
/** Desktop left rail — default / minimum 62px (compact column). */
export const TAB_RAIL_DESK_W = { def: 62, min: 62, max: 280 } as const;
/** Bottom tab bar (mobile). */
export const TAB_RAIL_MOB_H = { def: 72, min: 52, max: 120 } as const;

function clampDeskRailW(n: number): number {
  if (!Number.isFinite(n)) return TAB_RAIL_DESK_W.def;
  return Math.min(TAB_RAIL_DESK_W.max, Math.max(TAB_RAIL_DESK_W.min, Math.round(n)));
}

function clampMobRailH(n: number): number {
  if (!Number.isFinite(n)) return TAB_RAIL_MOB_H.def;
  return Math.min(TAB_RAIL_MOB_H.max, Math.max(TAB_RAIL_MOB_H.min, Math.round(n)));
}

export const MAP_NIGHT_DIM = { def: 48, min: 0, max: 100 } as const;

function clampMapNightDim(n: number): number {
  if (!Number.isFinite(n)) return MAP_NIGHT_DIM.def;
  return Math.min(MAP_NIGHT_DIM.max, Math.max(MAP_NIGHT_DIM.min, Math.round(n)));
}

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
  /** Tri-state layout: persists locally and updates derived desktopMode for current width. */
  setLayoutTriPreference: (pref: LayoutPreference) => Promise<void>;
  /** Web only: when layout preference is auto, update desktopMode from innerWidth without persisting. */
  applyLayoutBreakpoint: () => void;
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
  /** Clamp and set desktop rail width (in-memory; call `persistTabRailGeometry` after drag ends). */
  setTabRailWidthPx: (px: number) => void;
  /** Clamp and set mobile rail height (in-memory). */
  setTabRailHeightPx: (px: number) => void;
  persistTabRailGeometry: () => Promise<void>;
  setMapNightDimPercent: (n: number) => Promise<void>;
  /** Persist 64-char hex team key, or clear to use env / vault only. */
  setTeamMapSharedKeyHex: (hex: string | null) => Promise<void>;
  /**
   * After correct screening answer: persist team key from `EXPO_PUBLIC_MM_MAP_SHARED_KEY` (if not already set),
   * then mark screening complete on this device.
   */
  completeOpsScreening: () => Promise<void>;
  /**
   * If we have an access token but `profileId` was lost (e.g. partial localStorage on web),
   * recover `sub` from the JWT, persist, and recreate the Supabase client when missing.
   */
  reconcileProfileIdFromJwt: () => Promise<void>;
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

/** Match DB trigger placeholder: pending- + first 12 hex chars of id (no dashes). */
function pendingUsernameForAuthUser(profileId: string): string {
  return `pending-${profileId.replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Email/password users must have an mm_profiles row (id = auth.users.id). If the DB trigger
 * missed (old accounts, failed migration), insert is allowed via RLS and fixes callsign + API calls.
 */
async function ensureMmProfileRowForAuth(
  supabase: SupabaseClient,
  profileId: string,
): Promise<{ username: string; callsignOk: boolean } | null> {
  const existing = await loadMmProfileRow(supabase, profileId);
  if (existing) return existing;

  const { error } = await supabase.from("mm_profiles").insert({
    id: profileId,
    username: pendingUsernameForAuthUser(profileId),
    access_key_hash: null,
    callsign_ok: false,
  });

  if (error && error.code !== "23505") {
    return null;
  }
  return await loadMmProfileRow(supabase, profileId);
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
  tabRailWidthPx: TAB_RAIL_DESK_W.def,
  tabRailHeightPx: TAB_RAIL_MOB_H.def,
  mapNightDimPercent: MAP_NIGHT_DIM.def,
  teamMapSharedKeyHex: null,
  opsScreeningComplete: false,

  setSupabaseClient: (c) => set({ supabase: c }),

  completeOpsScreening: async () => {
    await get().setTeamMapSharedKeyHex(SCREENING_REWARD_TEAM_KEY_HEX);
    await secureSet(SK.opsScreeningComplete, "1");
    set({ opsScreeningComplete: true });
  },

  setTeamMapSharedKeyHex: async (hex) => {
    const raw = hex?.trim().toLowerCase() ?? "";
    if (!raw) {
      await secureDelete(SK.teamMapSharedKeyHex);
      set({ teamMapSharedKeyHex: null });
      return;
    }
    if (raw.length !== 64 || !/^[0-9a-f]+$/.test(raw)) {
      throw new Error("Team key must be exactly 64 hexadecimal characters (32-byte AES key).");
    }
    await secureSet(SK.teamMapSharedKeyHex, raw);
    set({ teamMapSharedKeyHex: raw });
  },

  setMapNightDimPercent: async (n) => {
    const mapNightDimPercent = clampMapNightDim(n);
    await secureSet(SK.mapNightDimPercent, String(mapNightDimPercent));
    set({ mapNightDimPercent });
  },

  reconcileProfileIdFromJwt: async () => {
    const token = get().accessToken;
    const existingPid = get().profileId;
    if (!token || existingPid) return;
    const sub = jwtSub(token);
    if (!sub) return;
    let username = get().username ?? (await secureGet(SK.username)) ?? jwtDisplayHandle(token) ?? sub;
    try {
      await persistSession(token, sub, username);
    } catch {
      /* still fix in-memory session */
    }
    let supabase = get().supabase;
    if (!supabase) {
      try {
        supabase = await createMMSupabase(token);
      } catch {
        supabase = null;
      }
    }
    const prevSource = get().sessionSource;
    set({
      profileId: sub,
      username,
      ...(supabase ? { supabase } : {}),
      ...(prevSource == null && supabase ? { sessionSource: "legacy" as SessionSource } : {}),
    });
  },

  setTabRailWidthPx: (px) => set({ tabRailWidthPx: clampDeskRailW(px) }),
  setTabRailHeightPx: (px) => set({ tabRailHeightPx: clampMobRailH(px) }),
  persistTabRailGeometry: async () => {
    const { tabRailWidthPx, tabRailHeightPx } = get();
    await secureSet(SK.tabRailWidthDesk, String(tabRailWidthPx));
    await secureSet(SK.tabRailHeightMob, String(tabRailHeightPx));
  },

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
    let layoutPref: LayoutPreference = await getLayoutPreferenceAsync();
    if (Platform.OS === "web") {
      try {
        layoutPref = getLayoutPreference();
      } catch {
        /* localStorage blocked */
      }
    }
    let desktopMode = resolveDesktopFromLayoutPref(layoutWidthPx(), layoutPref);
    const vmode = (await secureGet(SK.vaultDriveViewMode)) as VaultDriveViewMode | null;
    const vaultDriveViewMode: VaultDriveViewMode = vmode === "grid" ? "grid" : "list";
    const vt = (await secureGet(SK.visualTheme)) as VisualThemeId | null;
    const visualTheme: VisualThemeId = vt === "nightops" ? "nightops" : "woodland";

    const tabBarOrder = normalizeTabOrder(await secureGet(SK.tabBarOrder));
    const rw = await secureGet(SK.tabRailWidthDesk);
    const rh = await secureGet(SK.tabRailHeightMob);
    const tabRailWidthPx = clampDeskRailW(Number.parseInt(rw ?? "", 10));
    const tabRailHeightPx = clampMobRailH(Number.parseInt(rh ?? "", 10));
    const dimRaw = await secureGet(SK.mapNightDimPercent);
    const mapNightDimPercent = clampMapNightDim(Number.parseInt(dimRaw ?? "", 10));

    const teamHexRaw = await secureGet(SK.teamMapSharedKeyHex);
    let teamMapSharedKeyHex: string | null = null;
    if (teamHexRaw) {
      const t = teamHexRaw.trim().toLowerCase();
      if (t.length === 64 && /^[0-9a-f]+$/.test(t)) teamMapSharedKeyHex = t;
    }

    const opsScreeningComplete = (await secureGet(SK.opsScreeningComplete)) === "1";

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
        const row =
          (await loadMmProfileRow(supabase, profileId)) ??
          (await ensureMmProfileRowForAuth(supabase, profileId));
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
      if (token && profileId && isJwtExpired(token)) {
        await wipeSessionTokens();
        token = null;
        profileId = null;
        username = null;
      }
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

    if (token && !profileId) {
      const sub = jwtSub(token);
      if (sub) {
        profileId = sub;
        username = username ?? (await secureGet(SK.username)) ?? jwtDisplayHandle(token) ?? sub;
        try {
          await persistSession(token, profileId, username);
        } catch {
          /* quota / private mode */
        }
        if (!supabase) {
          try {
            supabase = await createMMSupabase(token);
            sessionSource = sessionSource ?? "legacy";
          } catch {
            /* env / network */
          }
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
      tabRailWidthPx,
      tabRailHeightPx,
      mapNightDimPercent,
      teamMapSharedKeyHex,
      opsScreeningComplete,
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
    const pref = await getLayoutPreferenceAsync();
    await get().setLayoutTriPreference(pref);
  },

  setLayoutTriPreference: async (pref) => {
    await setLayoutPreferencePersistent(pref);
    const desk = resolveDesktopFromLayoutPref(layoutWidthPx(), pref);
    await secureSet(SK.desktopMode, desk ? "1" : "0");
    set({ desktopMode: desk });
  },

  setDesktopMode: async (v) => {
    await get().setLayoutTriPreference(v ? "desktop" : "mobile");
  },

  applyLayoutBreakpoint: () => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    let pref: ReturnType<typeof getLayoutPreference> = "auto";
    try {
      pref = getLayoutPreference();
    } catch {
      return;
    }
    if (pref !== "auto") return;
    const desk = resolveDesktopFromLayoutPref(window.innerWidth, "auto");
    if (get().desktopMode !== desk) set({ desktopMode: desk });
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
    const row =
      source === "auth"
        ? (await loadMmProfileRow(supabase, profileId)) ??
          (await ensureMmProfileRowForAuth(supabase, profileId))
        : await loadMmProfileRow(supabase, profileId);
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
      teamMapSharedKeyHex: null,
      opsScreeningComplete: false,
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
      const supa = get().supabase;
      const pid = get().profileId;
      if (supa && pid) void ensureCalendarSaltOnUnlock(supa, pid, pin, "primary");
      return { ok: true, mode: "main" };
    }
    if (decoyKey) {
      set({ decoyVaultKey: decoyKey, mainVaultKey: null, vaultMode: "decoy" });
      const supa = get().supabase;
      const pid = get().profileId;
      if (supa && pid) void ensureCalendarSaltOnUnlock(supa, pid, pin, "duress");
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

/** Marker encryption: Settings team hex → env shared hex → vault partition. */
export function resolveMapEncryptKey(
  mainVaultKey: Uint8Array | null,
  decoyVaultKey: Uint8Array | null,
  mode: VaultMode | null,
): Uint8Array {
  const stored = useMMStore.getState().teamMapSharedKeyHex?.trim().toLowerCase() ?? "";
  if (stored.length === 64 && /^[0-9a-f]+$/.test(stored)) {
    return hexToBytes(stored);
  }
  const hex = getMapSharedKeyHex();
  if (hex) return hexToBytes(hex);
  if (mode === "main" && mainVaultKey?.length === 32) return mainVaultKey;
  if (mode === "decoy" && decoyVaultKey?.length === 32) return decoyVaultKey;
  throw new Error("Map key unavailable");
}

/**
 * All distinct keys to try when opening someone else's ops row (shared + main + decoy vault).
 * Order: primary resolver, then the other vault key, then redundant env/stored hex if differ.
 */
export function collectOpsDecryptCandidates(
  mainVaultKey: Uint8Array | null,
  decoyVaultKey: Uint8Array | null,
  mode: VaultMode | null,
): Uint8Array[] {
  const keys: Uint8Array[] = [];
  const add = (k: Uint8Array | null | undefined) => {
    if (!k || k.length !== 32) return;
    if (!keys.some((x) => x.length === k.length && x.every((b, i) => b === k[i]))) keys.push(k);
  };
  try {
    add(resolveMapEncryptKey(mainVaultKey, decoyVaultKey, mode));
  } catch {
    /* may have no shared key and vault locked */
  }
  add(mainVaultKey ?? undefined);
  add(decoyVaultKey ?? undefined);
  const st = useMMStore.getState().teamMapSharedKeyHex?.trim().toLowerCase() ?? "";
  if (st.length === 64 && /^[0-9a-f]+$/.test(st)) add(hexToBytes(st));
  const envHex = getMapSharedKeyHex();
  if (envHex) add(hexToBytes(envHex));
  return keys;
}
