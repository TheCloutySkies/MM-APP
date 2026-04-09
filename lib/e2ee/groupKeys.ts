import type { SupabaseClient } from "@supabase/supabase-js";

import { GLOBAL_GROUP_ID } from "./types";
import {
  aesGcmDecryptBytes,
  aesGcmEncryptBytes,
  deriveAesGcmKeyFromEcdh,
  isWebSubtleAvailable,
} from "./subtleWeb";
import { HKDF_GROUP_WRAP } from "./constants";
import { fetchPeerPublicSpki, importPublicSpkiFromB64 } from "./identity";

export async function ensureBootstrapAdmin(supabase: SupabaseClient, profileId: string): Promise<boolean> {
  const { error } = await supabase.from("e2ee_group_admins").insert({ profile_id: profileId });
  return !error;
}

export async function isGroupAdmin(supabase: SupabaseClient, profileId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("e2ee_group_admins")
    .select("profile_id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) return false;
  return !!data?.profile_id;
}

/** Create global group key + self wrap (admin). */
export async function initGlobalGroupForAdmin(
  supabase: SupabaseClient,
  adminId: string,
  adminPrivateKey: CryptoKey,
  adminPublicSpkiB64: string,
): Promise<{ groupKey: Uint8Array; error: Error | null }> {
  if (!isWebSubtleAvailable()) return { groupKey: new Uint8Array(), error: new Error("Web Crypto unavailable") };
  try {
    const { count, error: cErr } = await supabase
      .from("e2ee_group_key_wraps")
      .select("*", { count: "exact", head: true })
      .eq("group_id", GLOBAL_GROUP_ID);
    if (cErr) return { groupKey: new Uint8Array(), error: new Error(cErr.message) };
    if ((count ?? 0) > 0) {
      return { groupKey: new Uint8Array(), error: new Error("GLOBAL_EXISTS") };
    }

    const okAdmin = await isGroupAdmin(supabase, adminId);
    if (!okAdmin) {
      await ensureBootstrapAdmin(supabase, adminId);
    }
    const groupKey = crypto.getRandomValues(new Uint8Array(32));
    const adminPub = await importPublicSpkiFromB64(adminPublicSpkiB64);
    const aes = await deriveAesGcmKeyFromEcdh(adminPrivateKey, adminPub, HKDF_GROUP_WRAP);
    const enc = await aesGcmEncryptBytes(aes, groupKey);
    const { error } = await supabase.from("e2ee_group_key_wraps").insert({
      group_id: GLOBAL_GROUP_ID,
      member_id: adminId,
      admin_id: adminId,
      key_version: 1,
      iv: enc.ivB64,
      ciphertext: enc.ctB64,
    });
    return { groupKey, error: error ? new Error(error.message) : null };
  } catch (e) {
    return { groupKey: new Uint8Array(), error: e instanceof Error ? e : new Error("init group") };
  }
}

export async function loadGlobalGroupKeyForMember(
  supabase: SupabaseClient,
  memberId: string,
  memberPrivateKey: CryptoKey,
): Promise<{ groupKey: Uint8Array | null; error: Error | null }> {
  if (!isWebSubtleAvailable()) return { groupKey: null, error: new Error("Web Crypto unavailable") };
  const { data, error } = await supabase
    .from("e2ee_group_key_wraps")
    .select("admin_id, iv, ciphertext, key_version")
    .eq("member_id", memberId)
    .eq("group_id", GLOBAL_GROUP_ID)
    .order("key_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { groupKey: null, error: new Error(error.message) };
  if (!data?.admin_id || !data.iv || !data.ciphertext) {
    return { groupKey: null, error: new Error("No group key wrap for you yet") };
  }
  const { spki, error: fk } = await fetchPeerPublicSpki(supabase, data.admin_id as string);
  if (fk || !spki) return { groupKey: null, error: fk ?? new Error("Admin public key missing") };
  try {
    const adminPub = await importPublicSpkiFromB64(spki);
    const aes = await deriveAesGcmKeyFromEcdh(memberPrivateKey, adminPub, HKDF_GROUP_WRAP);
    const raw = await aesGcmDecryptBytes(aes, data.iv as string, data.ciphertext as string);
    return { groupKey: raw, error: null };
  } catch (e) {
    return { groupKey: null, error: e instanceof Error ? e : new Error("unwrap failed") };
  }
}

export async function adminInviteMemberToGlobal(
  supabase: SupabaseClient,
  adminId: string,
  adminPrivateKey: CryptoKey,
  memberId: string,
  groupKey: Uint8Array,
  keyVersion = 1,
): Promise<{ error: Error | null }> {
  const { spki, error: fe } = await fetchPeerPublicSpki(supabase, memberId);
  if (fe || !spki) return { error: fe ?? new Error("Member has no published identity key") };
  try {
    const memberPub = await importPublicSpkiFromB64(spki);
    const aes = await deriveAesGcmKeyFromEcdh(adminPrivateKey, memberPub, HKDF_GROUP_WRAP);
    const enc = await aesGcmEncryptBytes(aes, groupKey);
    const { error } = await supabase.from("e2ee_group_key_wraps").insert({
      group_id: GLOBAL_GROUP_ID,
      member_id: memberId,
      admin_id: adminId,
      key_version: keyVersion,
      iv: enc.ivB64,
      ciphertext: enc.ctB64,
    });
    return { error: error ? new Error(error.message) : null };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error("invite failed") };
  }
}
