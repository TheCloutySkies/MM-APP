# Wipe + reset runbook (Secure Cloud pivot)

This repo has pivoted from client-side Zero-Knowledge to **Secure Cloud** (plaintext in Supabase + RLS, raw vault objects in S3/R2).

To avoid crashes/mis-parses from legacy encrypted rows/objects, wipe the old data once before using the new app.

## 1) Supabase: wipe legacy encrypted rows

Run these in the Supabase SQL editor.

### Option A: wipe only app payload tables (recommended)

```sql
-- Vault “drive” (metadata + folder structure)
truncate table public.vault_objects restart identity cascade;
truncate table public.vault_folders restart identity cascade;

-- Ops / reports / bulletin / gear
truncate table public.ops_reports restart identity cascade;
truncate table public.ops_comments restart identity cascade;
truncate table public.operation_hubs restart identity cascade;
truncate table public.bulletin_posts restart identity cascade;
truncate table public.gear_loadouts restart identity cascade;

-- Tactical map
truncate table public.map_markers restart identity cascade;
truncate table public.team_positions restart identity cascade;
truncate table public.map_team_gpx_exports restart identity cascade;

-- Missions
truncate table public.missions restart identity cascade;

-- Audit trail (if present)
truncate table public.activity_logs restart identity cascade;
```

### Option B: full “nuke content” (only if you truly want everything gone)

Add any other domain tables you use (missions, sand table, etc.) and truncate them too.

If you previously used the old end-to-end encrypted comms tables and want them wiped too:

```sql
truncate table public.e2ee_comms_envelopes restart identity cascade;
truncate table public.e2ee_group_key_wraps restart identity cascade;
truncate table public.e2ee_group_admins restart identity cascade;
truncate table public.e2ee_identity_keys restart identity cascade;
```

## 2) S3/R2: wipe vault objects

Vault objects are stored under the prefix:

```text
vault/{supabase_user_id}/...
```

### If you’re using Cloudflare R2

- **Bucket**: your `EXPO_PUBLIC_S3_BUCKET` (default `vault`)
- **Delete objects**: use the Cloudflare dashboard (R2 → Bucket → Objects) and delete the `vault/{uid}/` prefix contents.

### If you’re using MinIO

- Delete the bucket contents (or the specific user prefix), then restart MinIO if needed.

## 3) Client: clear local state

On each device/browser:

- **Web**: clear site storage for your domain (localStorage + indexedDB, if used).
- **Native**: uninstall/reinstall the app (or clear app storage).

## 4) Sanity checks after wipe

- Log in → you should go straight to `/(app)/home` (no setup/unlock screens).
- Vault uploads should create objects in S3/R2 immediately.
- Map / Bulletin / Gear entries should be readable as plain JSON (no decrypt failures).

