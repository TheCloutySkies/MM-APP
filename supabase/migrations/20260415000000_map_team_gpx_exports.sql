-- Team-visible GPX snapshots (plaintext XML) for importing into Gaia, Garmin, QGIS, etc.
-- Created client-side after decrypting map_markers with the unit key.

create table if not exists public.map_team_gpx_exports (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.mm_profiles (id) on delete cascade,
  author_username text not null,
  title text not null,
  gpx_xml text not null,
  point_count int not null default 0,
  route_count int not null default 0,
  zone_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists map_team_gpx_exports_created_idx
  on public.map_team_gpx_exports (created_at desc);

alter table public.map_team_gpx_exports enable row level security;

drop policy if exists "map_team_gpx_exports_select_authenticated" on public.map_team_gpx_exports;
create policy "map_team_gpx_exports_select_authenticated"
  on public.map_team_gpx_exports for select
  to authenticated
  using (true);

drop policy if exists "map_team_gpx_exports_insert_own" on public.map_team_gpx_exports;
create policy "map_team_gpx_exports_insert_own"
  on public.map_team_gpx_exports for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "map_team_gpx_exports_delete_own" on public.map_team_gpx_exports;
create policy "map_team_gpx_exports_delete_own"
  on public.map_team_gpx_exports for delete
  to authenticated
  using (auth.uid() = author_id);
