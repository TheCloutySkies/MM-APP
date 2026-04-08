import type { SupabaseClient } from "@supabase/supabase-js";

import {
    decryptCalendarPayloadJson,
    deriveCalendarAesKeyFromPin,
    encryptCalendarPayloadJson,
} from "@/lib/calendar/calendarCrypto";
import {
    offlineDequeueAll,
    offlineEnqueue,
    offlinePutEvent,
    offlineReplaceQueue,
    type CalendarSyncJob,
} from "@/lib/calendar/calendarOffline";
import type { CalendarEventPlain } from "@/lib/calendar/calendarTypes";
import { pinHashHex, timingSafeEqualHex } from "@/lib/calendar/pinHash";
import { SK, secureGet } from "@/lib/secure/mmSecureStore";
import type { CalendarProfileCryptoRow } from "@/lib/supabase/calendarProfile";

export function eventsTable(mode: "real" | "decoy"): "events_real" | "events_decoy" {
  return mode === "real" ? "events_real" : "events_decoy";
}

export type CalendarPinRoute = "real" | "decoy" | "invalid";

/** Resolve route from PIN using profile row (+ optional local hash fallback when offline / migratings). */
export async function resolveCalendarPinRoute(
  pin: string,
  profile: CalendarProfileCryptoRow | null,
): Promise<CalendarPinRoute> {
  const h = pinHashHex(pin);
  if (profile?.primary_pin_hash && timingSafeEqualHex(h, profile.primary_pin_hash)) return "real";
  if (profile?.duress_pin_hash && timingSafeEqualHex(h, profile.duress_pin_hash)) return "decoy";
  const localP = await secureGet(SK.primaryPinHash);
  const localD = await secureGet(SK.duressPinHash);
  if (localP && timingSafeEqualHex(h, localP)) return "real";
  if (localD && timingSafeEqualHex(h, localD)) return "decoy";
  return "invalid";
}

export async function getSaltForRoute(route: CalendarPinRoute, profile: CalendarProfileCryptoRow | null): Promise<string | null> {
  if (route === "real") {
    const fromProfile = profile?.calendar_salt_primary;
    if (fromProfile) return fromProfile;
    return await secureGet(SK.calendarSaltPrimary);
  }
  if (route === "decoy") {
    const fromProfile = profile?.calendar_salt_duress;
    if (fromProfile) return fromProfile;
    return await secureGet(SK.calendarSaltDuress);
  }
  return null;
}

export async function deriveKeyForPinAndRoute(
  pin: string,
  route: CalendarPinRoute,
  profile: CalendarProfileCryptoRow | null,
): Promise<Uint8Array | null> {
  if (route !== "real" && route !== "decoy") return null;
  const salt = await getSaltForRoute(route, profile);
  if (!salt) return null;
  return deriveCalendarAesKeyFromPin(pin, salt);
}

function isCalendarPlain(u: unknown): u is CalendarEventPlain {
  if (!u || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.type === "string" &&
    typeof o.startIso === "string" &&
    typeof o.endIso === "string" &&
    typeof o.description === "string"
  );
}

export function tryDecryptRow(
  key32: Uint8Array,
  rowId: string,
  authorId: string,
  encryptedPayload: string,
): { rowId: string; authorId: string; plain: CalendarEventPlain } | null {
  try {
    const parsed = decryptCalendarPayloadJson(key32, encryptedPayload);
    if (!isCalendarPlain(parsed)) return null;
    return { rowId, authorId, plain: parsed };
  } catch {
    return null;
  }
}

export async function fetchEncryptedEvents(
  supabase: SupabaseClient | null,
  mode: "real" | "decoy",
): Promise<{ id: string; author_id: string; encrypted_payload: string }[]> {
  if (!supabase) return [];
  const t = eventsTable(mode);
  const { data, error } = await supabase.from(t).select("id, author_id, encrypted_payload");
  if (error || !data) return [];
  return data as { id: string; author_id: string; encrypted_payload: string }[];
}

export async function pushNewEvent(
  supabase: SupabaseClient | null,
  profileId: string,
  mode: "real" | "decoy",
  key32: Uint8Array,
  plain: CalendarEventPlain,
): Promise<{ id: string | null; error: string | null }> {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let enc: string;
  try {
    enc = encryptCalendarPayloadJson(key32, plain);
  } catch (e) {
    return { id: null, error: e instanceof Error ? e.message : "encrypt failed" };
  }

  const t = eventsTable(mode);
  const row = { id, author_id: profileId, encrypted_payload: enc };

  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  if (!supabase || !online) {
    await offlinePutEvent(mode, id, plain);
    await offlineEnqueue({ kind: "insert", mode, rowId: id, encryptedPayload: enc });
    return { id, error: null };
  }

  const { data, error } = await supabase.from(t).insert(row).select("id").single();
  if (error) {
    await offlinePutEvent(mode, id, plain);
    await offlineEnqueue({ kind: "insert", mode, rowId: id, encryptedPayload: enc });
    return { id, error: null };
  }
  await offlinePutEvent(mode, data.id as string, plain);
  return { id: data.id as string, error: null };
}

export async function flushCalendarSyncQueue(supabase: SupabaseClient, profileId: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const jobs = await offlineDequeueAll();
  if (jobs.length === 0) return;
  const rest: CalendarSyncJob[] = [];
  for (const job of jobs) {
    if (job.kind === "insert") {
      const t = eventsTable(job.mode);
      const { error } = await supabase.from(t).insert({
        id: job.rowId,
        author_id: profileId,
        encrypted_payload: job.encryptedPayload,
      });
      if (error) rest.push(job);
    } else if (job.kind === "delete") {
      const t = eventsTable(job.mode);
      const { error } = await supabase.from(t).delete().eq("id", job.rowId).eq("author_id", profileId);
      if (error) rest.push(job);
    }
  }
  await offlineReplaceQueue(rest);
}
