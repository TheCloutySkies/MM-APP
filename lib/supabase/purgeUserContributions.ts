import type { SupabaseClient } from "@supabase/supabase-js";

import { removeVaultObjectKeys, wipeVaultStoragePrefix } from "@/lib/storage";

function pushErr(errors: string[], label: string, message: string | undefined) {
  if (message) errors.push(`${label}: ${message}`);
}

async function deleteEq(
  supabase: SupabaseClient,
  table: string,
  column: string,
  value: string,
  errors: string[],
): Promise<void> {
  const { error } = await supabase.from(table).delete().eq(column, value);
  pushErr(errors, table, error?.message);
}

async function deleteVaultFoldersForUser(
  supabase: SupabaseClient,
  profileId: string,
  errors: string[],
): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const { data: mine, error: selErr } = await supabase
      .from("vault_folders")
      .select("id")
      .eq("created_by", profileId);
    pushErr(errors, "vault_folders select", selErr?.message);
    if (!mine?.length) break;

    const { data: childRows, error: chErr } = await supabase
      .from("vault_folders")
      .select("parent_id")
      .not("parent_id", "is", null);
    pushErr(errors, "vault_folders parents", chErr?.message);
    const parentRefs = new Set(
      (childRows ?? []).map((r) => r.parent_id as string).filter((x): x is string => !!x),
    );
    const leaves = mine.filter((r) => !parentRefs.has(r.id));
    if (!leaves.length) {
      pushErr(errors, "vault_folders", "could not resolve delete order; stop");
      break;
    }
    const { error: delErr } = await supabase
      .from("vault_folders")
      .delete()
      .in(
        "id",
        leaves.map((l) => l.id),
      );
    pushErr(errors, "vault_folders delete", delErr?.message);
  }
}

/**
 * Deletes all server-side rows and vault storage attributable to `profileId`.
 * Does not delete the auth user or the `mm_profiles` row (account remains).
 */
export async function purgeAllUserContributions(
  supabase: SupabaseClient,
  profileId: string,
): Promise<{ errors: string[] }> {
  const errors: string[] = [];

  await deleteEq(supabase, "ops_comments", "author_id", profileId, errors);
  await deleteEq(supabase, "ops_reports", "author_id", profileId, errors);
  await deleteEq(supabase, "operation_hubs", "author_id", profileId, errors);
  await deleteEq(supabase, "bulletin_posts", "author_id", profileId, errors);
  await deleteEq(supabase, "map_markers", "profile_id", profileId, errors);
  await deleteEq(supabase, "gear_loadouts", "author_id", profileId, errors);
  await deleteEq(supabase, "team_positions", "profile_id", profileId, errors);
  await deleteEq(supabase, "map_team_gpx_exports", "author_id", profileId, errors);
  await deleteEq(supabase, "events_real", "author_id", profileId, errors);
  await deleteEq(supabase, "events_decoy", "author_id", profileId, errors);
  await deleteEq(supabase, "missions", "owner_id", profileId, errors);

  const { error: e2eeEnvErr } = await supabase
    .from("e2ee_comms_envelopes")
    .delete()
    .or(`sender_id.eq.${profileId},recipient_id.eq.${profileId}`);
  pushErr(errors, "e2ee_comms_envelopes", e2eeEnvErr?.message);
  await deleteEq(supabase, "e2ee_group_key_wraps", "member_id", profileId, errors);
  await deleteEq(supabase, "e2ee_group_key_wraps", "admin_id", profileId, errors);
  await deleteEq(supabase, "e2ee_group_admins", "profile_id", profileId, errors);
  await deleteEq(supabase, "e2ee_identity_keys", "profile_id", profileId, errors);

  const { data: vaultRows, error: voSelErr } = await supabase
    .from("vault_objects")
    .select("storage_path")
    .eq("owner_id", profileId);
  pushErr(errors, "vault_objects select", voSelErr?.message);
  const paths = (vaultRows ?? []).map((r) => r.storage_path as string).filter(Boolean);
  if (paths.length) {
    const { error: stErr } = await removeVaultObjectKeys(supabase, paths);
    pushErr(errors, "vault storage remove (indexed)", stErr?.message);
  }
  await deleteEq(supabase, "vault_objects", "owner_id", profileId, errors);

  await deleteVaultFoldersForUser(supabase, profileId, errors);

  await wipeVaultStoragePrefix(supabase, errors, profileId);

  const { error: profErr } = await supabase
    .from("mm_profiles")
    .update({
      layout_preference: "auto",
      calendar_salt_primary: null,
      calendar_salt_duress: null,
    })
    .eq("id", profileId);
  pushErr(errors, "mm_profiles scrub prefs", profErr?.message);

  return { errors };
}
