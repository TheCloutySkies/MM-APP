import type { E2eeBroadcastV1 } from "./types";
import { HKDF_DM } from "./constants";
import {
  aesGcmDecryptUtf8,
  aesGcmEncryptUtf8,
  deriveAesGcmKeyFromEcdh,
  importPublicSpkiFromB64,
} from "./subtleWeb";
import { fetchPeerPublicSpki } from "./identity";
import type { SupabaseClient } from "@supabase/supabase-js";

export function dmRealtimeTopic(a: string, b: string): string {
  return `e2ee-dm:${[a, b].sort().join(":")}`;
}

export const GROUP_REALTIME_TOPIC = "e2ee-grp:global";

export async function encryptDmPayload(
  supabase: SupabaseClient,
  myPrivate: CryptoKey,
  peerId: string,
  text: string,
): Promise<{ ivB64: string; ctB64: string; error: Error | null }> {
  const { spki, error } = await fetchPeerPublicSpki(supabase, peerId);
  if (error || !spki) return { ivB64: "", ctB64: "", error: error ?? new Error("Peer key") };
  try {
    const peerPub = await importPublicSpkiFromB64(spki);
    const aes = await deriveAesGcmKeyFromEcdh(myPrivate, peerPub, HKDF_DM);
    const enc = await aesGcmEncryptUtf8(aes, text);
    return { ivB64: enc.ivB64, ctB64: enc.ctB64, error: null };
  } catch (e) {
    return { ivB64: "", ctB64: "", error: e instanceof Error ? e : new Error("encrypt") };
  }
}

export async function decryptDmPayload(
  supabase: SupabaseClient,
  myPrivate: CryptoKey,
  senderId: string,
  ivB64: string,
  ctB64: string,
): Promise<{ text: string | null; error: Error | null }> {
  const { spki, error } = await fetchPeerPublicSpki(supabase, senderId);
  if (error || !spki) return { text: null, error: error ?? new Error("Sender key") };
  try {
    const peerPub = await importPublicSpkiFromB64(spki);
    const aes = await deriveAesGcmKeyFromEcdh(myPrivate, peerPub, HKDF_DM);
    const text = await aesGcmDecryptUtf8(aes, ivB64, ctB64);
    return { text, error: null };
  } catch (e) {
    return { text: null, error: e instanceof Error ? e : new Error("decrypt") };
  }
}

export async function encryptGroupPayload(groupKey32: Uint8Array, text: string): Promise<{ ivB64: string; ctB64: string }> {
  const raw = new Uint8Array(groupKey32);
  const k = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return aesGcmEncryptUtf8(k, text);
}

export async function decryptGroupPayload(groupKey32: Uint8Array, ivB64: string, ctB64: string): Promise<string> {
  const raw = new Uint8Array(groupKey32);
  const k = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return aesGcmDecryptUtf8(k, ivB64, ctB64);
}

export function buildBroadcast(
  kind: "dm" | "grp",
  from: string,
  ivB64: string,
  ctB64: string,
  clientMsgId: string,
): E2eeBroadcastV1 {
  return { v: 1, kind, from, ivB64, ctB64, ts: Date.now(), clientMsgId };
}
