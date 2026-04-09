import type { SupabaseClient } from "@supabase/supabase-js";

import { parseLayoutPreferenceValue, type LayoutPreference } from "@/lib/layout/layoutPreference";

export async function fetchProfileLayoutPreference(
  supabase: SupabaseClient,
  profileId: string,
): Promise<LayoutPreference | null> {
  const { data, error } = await supabase
    .from("mm_profiles")
    .select("layout_preference")
    .eq("id", profileId)
    .maybeSingle();
  if (error || !data) return null;
  const raw = data.layout_preference as string | null | undefined;
  /** Treat unset column as “no server opinion” so device `localStorage` / secure store wins after reload. */
  if (raw == null || String(raw).trim() === "") return null;
  return parseLayoutPreferenceValue(raw);
}

export async function updateProfileLayoutPreference(
  supabase: SupabaseClient,
  profileId: string,
  pref: LayoutPreference,
): Promise<{ error: Error | null }> {
  const { error } = await supabase.from("mm_profiles").update({ layout_preference: pref }).eq("id", profileId);
  return { error: error ? new Error(error.message) : null };
}
