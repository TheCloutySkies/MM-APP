import type { SupabaseClient } from "@supabase/supabase-js";

import {
  exportPrivatePkcs8,
  exportPublicSpkiB64,
  generateP384Identity,
  importPrivatePkcs8,
  importPublicSpkiFromB64,
  isWebSubtleAvailable,
  wrapPrivatePkcs8WithPin,
  unwrapPrivatePkcs8WithPin,
} from "./subtleWeb";
import { clearWrappedPrivate, loadWrappedPrivate, saveWrappedPrivate, type WrappedPrivateRecord } from "./localStore";

export async function publishIdentityPublicKey(
  supabase: SupabaseClient,
  profileId: string,
  spkiB64: string,
): Promise<{ error: Error | null }> {
  const { error } = await supabase.from("e2ee_identity_keys").upsert(
    {
      profile_id: profileId,
      public_key_spki: spkiB64,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" },
  );
  return { error: error ? new Error(error.message) : null };
}

export async function fetchPeerPublicSpki(
  supabase: SupabaseClient,
  peerProfileId: string,
): Promise<{ spki: string | null; error: Error | null }> {
  const { data, error } = await supabase
    .from("e2ee_identity_keys")
    .select("public_key_spki")
    .eq("profile_id", peerProfileId)
    .maybeSingle();
  if (error) return { spki: null, error: new Error(error.message) };
  const spki = data?.public_key_spki;
  return { spki: typeof spki === "string" ? spki : null, error: null };
}

/** Create P-384 keys, wrap PKCS#8 with PIN, persist locally, upload SPKI. */
export async function bootstrapIdentityOnDevice(
  supabase: SupabaseClient,
  profileId: string,
  pin: string,
): Promise<{ publicSpkiB64: string; error: Error | null }> {
  if (!isWebSubtleAvailable()) {
    return { publicSpkiB64: "", error: new Error("Web Crypto not available") };
  }
  if (!pin.trim()) return { publicSpkiB64: "", error: new Error("PIN required") };
  try {
    const pair = await generateP384Identity();
    const spki = await exportPublicSpkiB64(pair.publicKey);
    const pkcs8 = await exportPrivatePkcs8(pair.privateKey);
    const w = await wrapPrivatePkcs8WithPin(pin, profileId, pkcs8);
    const rec: WrappedPrivateRecord = { v: 1, profileId, ivB64: w.ivB64, ctB64: w.ctB64 };
    await saveWrappedPrivate(rec);
    const { error: pubErr } = await publishIdentityPublicKey(supabase, profileId, spki);
    return { publicSpkiB64: spki, error: pubErr };
  } catch (e) {
    return { publicSpkiB64: "", error: e instanceof Error ? e : new Error("bootstrap failed") };
  }
}

export async function unlockIdentityPrivateKey(
  profileId: string,
  pin: string,
): Promise<{ privateKey: CryptoKey | null; error: Error | null }> {
  if (!isWebSubtleAvailable()) {
    return { privateKey: null, error: new Error("Web Crypto not available") };
  }
  const rec = await loadWrappedPrivate(profileId);
  if (!rec) return { privateKey: null, error: new Error("No identity on this device") };
  try {
    const pkcs8 = await unwrapPrivatePkcs8WithPin(pin, profileId, rec.ivB64, rec.ctB64);
    const privateKey = await importPrivatePkcs8(pkcs8);
    return { privateKey, error: null };
  } catch {
    return { privateKey: null, error: new Error("Wrong PIN or corrupted identity") };
  }
}

export async function hasLocalIdentity(profileId: string): Promise<boolean> {
  const rec = await loadWrappedPrivate(profileId);
  return rec != null;
}

export async function wipeLocalIdentity(profileId: string): Promise<void> {
  await clearWrappedPrivate(profileId);
}

export { importPublicSpkiFromB64 };
