import type { SupabaseClient } from "@supabase/supabase-js";
import { Dimensions, Platform } from "react-native";
import { create } from "zustand";

import {
    MAIN_TAB_ROUTE_ORDER,
    type MainTabRouteId,
    normalizeTabOrder,
    reorderTabBefore,
} from "@/constants/mainTabs";
import type { VisualThemeId } from "@/constants/TacticalTheme";
import { getMapSharedKeyHex } from "@/lib/env";
import type { LayoutPreference } from "@/lib/layout/layoutPreference";
import {
    getLayoutPreference,
    getLayoutPreferenceAsync,
    resolveDesktopFromLayoutPref,
    setLayoutPreferencePersistent
} from "@/lib/layout/layoutPreference";
import {
  SK,
  secureDelete,
  secureGet,
  secureSet,
  wipeLocalSecrets,
  wipeSessionTokens,
} from "@/lib/secure/mmSecureStore";
import { getAuthSupabase, getInitialAuthSession } from "@/lib/supabase/authSupabase";
import {
  ensureCalendarSaltOnUnlock,
  syncCalendarSecretsFromServerToDevice,
} from "@/lib/supabase/calendarProfile";
import { isJwtExpired, jwtDisplayHandle, jwtSub } from "@/lib/supabase/jwtExp";
import { createMMSupabase } from "@/lib/supabase/mmClient";

export type VaultDriveViewMode = "grid" | "list";

export type SessionSource = "auth" | "legacy";

// Secure-cloud pivot: no decoy vault or client-side vault keys.
export type VaultMode = "main";

type MMState = {
  hydrated: boolean;
  accessToken: string | null;
  profileId: string | null;
  username: string | null;
  /** False until user sets an operational callsign (mm_profiles.callsign_ok). */
  callsignOk: boolean;
  /** Opt-in: mm_profiles.decoy_alerts_enabled — generic decoy email on server-side sync rejection only. */
  decoyAlertsEnabled: boolean;
  /** How the current API token was obtained — affects which Supabase client we keep. */
  sessionSource: SessionSource | null;
  vaultMode: VaultMode | null;
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
  /** Deep link: focus tactical map row id (map_markers) then clear. */
  mapFocusMarkerId: string | null;
  /** Deep link: open vault private object by vault_objects.id then clear. */
  vaultFocusObjectId: string | null;
  /**
   * When set, tactical map shows “apply crosshair MGRS” and calls this once with a 5-digit grid string,
   * then clears itself. Used by SPOTREP / MEDEVAC / route recon refine flows.
   */
  mgrsPickHandler: ((mgrs: string) => void) | null;
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
  setSupabaseClient: (c: SupabaseClient | null) => void;
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
   * If we have an access token but `profileId` was lost (e.g. partial localStorage on web),
   * recover `sub` from the JWT, persist, and recreate the Supabase client when missing.
   */
  reconcileProfileIdFromJwt: () => Promise<void>;
  setMapFocusMarkerId: (id: string | null) => void;
  setVaultFocusObjectId: (id: string | null) => void;
  setMgrsPickHandler: (fn: ((mgrs: string) => void) | null) => void;
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
): Promise<{ username: string; callsignOk: boolean; decoyAlertsEnabled: boolean } | null> {
  const { data, error } = await supabase
    .from("mm_profiles")
    .select("username, callsign_ok, decoy_alerts_enabled")
    .eq("id", profileId)
    .maybeSingle();
  if (error || !data?.username) return null;
  return {
    username: data.username as string,
    callsignOk: Boolean(data.callsign_ok),
    decoyAlertsEnabled: Boolean(data.decoy_alerts_enabled),
  };
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
): Promise<{ username: string; callsignOk: boolean; decoyAlertsEnabled: boolean } | null> {
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
  decoyAlertsEnabled: false,
  sessionSource: null,
  vaultMode: null,
  supabase: null,
  desktopMode: false,
  vaultDriveViewMode: "list",
  visualTheme: "woodland",
  tabBarOrder: [...MAIN_TAB_ROUTE_ORDER],
  tabRailWidthPx: TAB_RAIL_DESK_W.def,
  tabRailHeightPx: TAB_RAIL_MOB_H.def,
  mapNightDimPercent: MAP_NIGHT_DIM.def,
  teamMapSharedKeyHex: null,
  mapFocusMarkerId: null,
  vaultFocusObjectId: null,
  mgrsPickHandler: null,

  setSupabaseClient: (c) => set({ supabase: c }),

  setMapFocusMarkerId: (id) => set({ mapFocusMarkerId: id }),
  setVaultFocusObjectId: (id) => set({ vaultFocusObjectId: id }),
  setMgrsPickHandler: (fn) => set({ mgrsPickHandler: fn }),

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

    // Secure-cloud pivot: no vault unlock gate or screening dependency.

    let token: string | null = null;
    let profileId: string | null = null;
    let username: string | null = null;
    let callsignOk = true;
    let decoyAlertsEnabled = false;
    let sessionSource: SessionSource | null = null;
    let supabase: SupabaseClient | null = null;

    try {
      const session = await getInitialAuthSession();
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
          decoyAlertsEnabled = row.decoyAlertsEnabled;
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
          decoyAlertsEnabled = row.decoyAlertsEnabled;
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

    if (supabase && profileId) {
      try {
        await syncCalendarSecretsFromServerToDevice(supabase, profileId);
      } catch {
        /* offline / RLS */
      }
    }

    set({
      hydrated: true,
      accessToken: token,
      profileId,
      username,
      callsignOk,
      decoyAlertsEnabled,
      sessionSource,
      supabase,
      desktopMode,
      vaultDriveViewMode,
      visualTheme,
      tabBarOrder,
      tabRailWidthPx,
      tabRailHeightPx,
      mapNightDimPercent,
      teamMapSharedKeyHex,
      mapFocusMarkerId: null,
      vaultFocusObjectId: null,
      mgrsPickHandler: null,
    });
  },

  syncMmProfileRow: async () => {
    const { supabase, profileId } = get();
    if (!supabase || !profileId) return;
    const row = await loadMmProfileRow(supabase, profileId);
    if (!row) return;
    const tok = get().accessToken;
    if (tok) await persistSession(tok, profileId, row.username);
    set({
      username: row.username,
      callsignOk: row.callsignOk,
      decoyAlertsEnabled: row.decoyAlertsEnabled,
    });
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
    let decoyAlertsEnabled = false;
    const row =
      source === "auth"
        ? (await loadMmProfileRow(supabase, profileId)) ??
          (await ensureMmProfileRowForAuth(supabase, profileId))
        : await loadMmProfileRow(supabase, profileId);
    if (row) {
      displayUsername = row.username;
      callsignOk = row.callsignOk;
      decoyAlertsEnabled = row.decoyAlertsEnabled;
      await persistSession(loginToken, profileId, displayUsername);
    } else if (source === "auth") {
      callsignOk = false;
    }
    try {
      await syncCalendarSecretsFromServerToDevice(supabase, profileId);
    } catch {
      /* offline */
    }
    set({
      accessToken: loginToken,
      profileId,
      username: displayUsername,
      callsignOk,
      decoyAlertsEnabled,
      sessionSource: source,
      supabase,
      vaultMode: "main",
    });
  },

  logout: async () => {
    await clearGoTrueSession();
    await wipeSessionTokens();
    set({
      accessToken: null,
      profileId: null,
      username: null,
      callsignOk: true,
      decoyAlertsEnabled: false,
      sessionSource: null,
      vaultMode: null,
      supabase: null,
      mapFocusMarkerId: null,
      vaultFocusObjectId: null,
      mgrsPickHandler: null,
    });
  },

  lock: async () => {
    set({
      vaultMode: null,
      mapFocusMarkerId: null,
      vaultFocusObjectId: null,
      mgrsPickHandler: null,
    });
  },

  fullLock: async () => {
    await clearGoTrueSession();
    await wipeSessionTokens();
    await wipeLocalSecrets();
    set({
      accessToken: null,
      profileId: null,
      username: null,
      callsignOk: true,
      decoyAlertsEnabled: false,
      sessionSource: null,
      vaultMode: null,
      supabase: null,
      teamMapSharedKeyHex: null,
      mapFocusMarkerId: null,
      vaultFocusObjectId: null,
      mgrsPickHandler: null,
    });
  },
}));
export function resolveMapEncryptKeyHex(): string | undefined {
  const stored = useMMStore.getState().teamMapSharedKeyHex?.trim().toLowerCase() ?? "";
  if (stored.length === 64 && /^[0-9a-f]+$/.test(stored)) return stored;
  return getMapSharedKeyHex();
}

export const resolveMapEncryptKey = resolveMapEncryptKeyHex;
