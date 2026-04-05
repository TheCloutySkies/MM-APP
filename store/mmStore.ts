import type { SupabaseClient } from "@supabase/supabase-js";
import { create } from "zustand";

import * as aes from "@/lib/crypto/aesGcm";
import { hexToBytes, utf8 } from "@/lib/crypto/bytes";
import { deriveKeyArgon2id } from "@/lib/crypto/kdf";
import { getMapSharedKeyHex } from "@/lib/env";
import { SK, secureGet, secureSet, wipeLocalSecrets, wipeSessionTokens } from "@/lib/secure/mmSecureStore";
import { createMMSupabase } from "@/lib/supabase/mmClient";

export type VaultMode = "main" | "decoy";

type MMState = {
  hydrated: boolean;
  accessToken: string | null;
  profileId: string | null;
  username: string | null;
  setupComplete: boolean;
  vaultMode: VaultMode | null;
  /** 32-byte AES keys in memory only; cleared on lock */
  mainVaultKey: Uint8Array | null;
  decoyVaultKey: Uint8Array | null;
  supabase: SupabaseClient | null;
  desktopMode: boolean;
};

type MMActions = {
  hydrateFromStorage: () => Promise<void>;
  logout: () => Promise<void>;
  lock: () => Promise<void>;
  /** Scorched earth: clear session + keys */
  fullLock: () => Promise<void>;
  login: (token: string, profileId: string, username: string) => Promise<void>;
  loadDesktopPref: () => Promise<void>;
  setDesktopMode: (v: boolean) => Promise<void>;
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
};

async function persistSession(token: string, profileId: string, username: string) {
  await secureSet(SK.accessToken, token);
  await secureSet(SK.profileId, profileId);
  await secureSet(SK.username, username);
}

export const useMMStore = create<MMState & MMActions>((set, get) => ({
  hydrated: false,
  accessToken: null,
  profileId: null,
  username: null,
  setupComplete: false,
  vaultMode: null,
  mainVaultKey: null,
  decoyVaultKey: null,
  supabase: null,
  desktopMode: false,

  setSupabaseClient: (c) => set({ supabase: c }),

  hydrateFromStorage: async () => {
    const token = await secureGet(SK.accessToken);
    const profileId = await secureGet(SK.profileId);
    const username = await secureGet(SK.username);
    const setupDone = (await secureGet(SK.setupDone)) === "1";
    const desktopMode = (await secureGet(SK.desktopMode)) === "1";
    let supabase: SupabaseClient | null = null;
    if (token) {
      supabase = await createMMSupabase(token);
    }
    set({
      hydrated: true,
      accessToken: token,
      profileId,
      username,
      setupComplete: setupDone,
      supabase,
      desktopMode,
    });
  },

  loadDesktopPref: async () => {
    const desktopMode = (await secureGet(SK.desktopMode)) === "1";
    set({ desktopMode });
  },

  setDesktopMode: async (v) => {
    await secureSet(SK.desktopMode, v ? "1" : "0");
    set({ desktopMode: v });
  },

  login: async (token, profileId, username) => {
    await persistSession(token, profileId, username);
    const supabase = await createMMSupabase(token);
    set({ accessToken: token, profileId, username, supabase });
  },

  logout: async () => {
    get().mainVaultKey?.fill(0);
    get().decoyVaultKey?.fill(0);
    await wipeSessionTokens();
    const setupDone = (await secureGet(SK.setupDone)) === "1";
    set({
      accessToken: null,
      profileId: null,
      username: null,
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
    await wipeLocalSecrets();
    set({
      accessToken: null,
      profileId: null,
      username: null,
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
