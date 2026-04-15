import type { SupabaseClient } from "@supabase/supabase-js";

import { pinHashHex } from "@/lib/calendar/pinHash";
import { SK, secureGet, secureSet } from "@/lib/secure/mmSecureStore";

function randomSaltHex(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** After initial setup: push PIN hashes + salts to mm_profiles and mirror salts locally. */
export async function syncCalendarPinsAfterSetup(
  supabase: SupabaseClient,
  profileId: string,
  primaryPin: string,
  duressPin: string,
): Promise<{ error: Error | null }> {
  const primary_pin_hash = pinHashHex(primaryPin);
  const duress_pin_hash = pinHashHex(duressPin);
  const calendar_salt_primary = randomSaltHex();
  const calendar_salt_duress = randomSaltHex();

  const { error } = await supabase
    .from("mm_profiles")
    .update({
      primary_pin_hash,
      duress_pin_hash,
      calendar_salt_primary,
      calendar_salt_duress,
    })
    .eq("id", profileId);

  if (error) return { error: new Error(error.message) };

  await secureSet(SK.primaryPinHash, primary_pin_hash);
  await secureSet(SK.duressPinHash, duress_pin_hash);
  await secureSet(SK.calendarSaltPrimary, calendar_salt_primary);
  await secureSet(SK.calendarSaltDuress, calendar_salt_duress);

  return { error: null };
}

export type CalendarProfileCryptoRow = {
  primary_pin_hash: string | null;
  duress_pin_hash: string | null;
  calendar_salt_primary: string | null;
  calendar_salt_duress: string | null;
};

export async function fetchCalendarProfileRow(
  supabase: SupabaseClient,
  profileId: string,
): Promise<{ data: CalendarProfileCryptoRow | null; error: Error | null }> {
  const { data, error } = await supabase
    .from("mm_profiles")
    .select("primary_pin_hash, duress_pin_hash, calendar_salt_primary, calendar_salt_duress")
    .eq("id", profileId)
    .maybeSingle();

  if (error) return { data: null, error: new Error(error.message) };
  return { data: data as CalendarProfileCryptoRow | null, error: null };
}

/**
 * After login / refresh: copy calendar PIN hashes + salts from `mm_profiles` into secure device storage
 * when the server has them but local keys are missing (e.g. web storage cleared while the auth session remains).
 */
export async function syncCalendarSecretsFromServerToDevice(
  supabase: SupabaseClient,
  profileId: string,
): Promise<void> {
  const { data, error } = await fetchCalendarProfileRow(supabase, profileId);
  if (error || !data) return;

  const [lp, ld, lsp, lsd] = await Promise.all([
    secureGet(SK.primaryPinHash),
    secureGet(SK.duressPinHash),
    secureGet(SK.calendarSaltPrimary),
    secureGet(SK.calendarSaltDuress),
  ]);

  if (!lp && data.primary_pin_hash) await secureSet(SK.primaryPinHash, data.primary_pin_hash);
  if (!ld && data.duress_pin_hash) await secureSet(SK.duressPinHash, data.duress_pin_hash);
  if (!lsp && data.calendar_salt_primary) await secureSet(SK.calendarSaltPrimary, data.calendar_salt_primary);
  if (!lsd && data.calendar_salt_duress) await secureSet(SK.calendarSaltDuress, data.calendar_salt_duress);
}

/** Backfill salts/hashes on unlock (one branch at a time). */
export async function ensureCalendarSaltOnUnlock(
  supabase: SupabaseClient,
  profileId: string,
  pin: string,
  branch: "primary" | "duress",
): Promise<{ error: Error | null }> {
  const { data: row, error: fetchErr } = await fetchCalendarProfileRow(supabase, profileId);
  if (fetchErr) return { error: fetchErr };
  if (!row) return { error: new Error("Profile not found") };

  const updates: Record<string, string> = {};
  if (branch === "primary") {
    updates.primary_pin_hash = pinHashHex(pin);
    if (!row.calendar_salt_primary) updates.calendar_salt_primary = randomSaltHex();
  } else {
    updates.duress_pin_hash = pinHashHex(pin);
    if (!row.calendar_salt_duress) updates.calendar_salt_duress = randomSaltHex();
  }

  const { error } = await supabase.from("mm_profiles").update(updates).eq("id", profileId);
  if (error) return { error: new Error(error.message) };

  if (branch === "primary") {
    await secureSet(SK.primaryPinHash, updates.primary_pin_hash);
    const sp = updates.calendar_salt_primary ?? row.calendar_salt_primary;
    if (sp) await secureSet(SK.calendarSaltPrimary, sp);
  } else {
    if (updates.duress_pin_hash) await secureSet(SK.duressPinHash, updates.duress_pin_hash);
    const sd = updates.calendar_salt_duress ?? row.calendar_salt_duress;
    if (sd) await secureSet(SK.calendarSaltDuress, sd);
  }

  return { error: null };
}
