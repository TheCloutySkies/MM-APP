-- MM RLS hardening (hybrid model): document intent + tighten anon on storage.
-- Apply via Supabase CLI only: `supabase db push --linked --yes`
--
-- Hybrid policy:
-- - vault_objects, vault bucket, missions, mm_profiles: owner-scoped (strict).
-- - map_markers, ops_reports: SELECT for all authenticated users (team situational
--   awareness). Payloads are client-encrypted ciphertext; Postgres never decrypts.
-- - INSERT/DELETE on map_markers and ops_reports remain owner/author scoped.

-- ---------------------------------------------------------------------------
-- Storage: never allow anonymous reads/writes on vault bucket
-- ---------------------------------------------------------------------------
drop policy if exists "vault_storage_public" on storage.objects;

-- ---------------------------------------------------------------------------
-- vault_objects: allow UPDATE/DELETE only for owner (previously ALL covered
-- insert/select/update/delete via "vault_objects_all_own").
-- Policy unchanged in effect; explicit comment for audits.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- missions: same as vault_objects — "missions_all_own" already FOR ALL.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- map_markers: keep team read. Optional hardening — reject direct UPDATE of
-- rows you did not create (insert-only workflow from app).
-- ---------------------------------------------------------------------------
drop policy if exists "map_markers_update_own" on public.map_markers;
create policy "map_markers_update_own"
  on public.map_markers for update
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- ---------------------------------------------------------------------------
-- ops_reports: authors may update their own encrypted docs (optional client use)
-- ---------------------------------------------------------------------------
drop policy if exists "ops_reports_update_own" on public.ops_reports;
create policy "ops_reports_update_own"
  on public.ops_reports for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);
