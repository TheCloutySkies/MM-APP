-- Live team positions on the map (ciphertext). Same client key strategy as map_markers.

create table if not exists public.team_positions (
  profile_id uuid primary key references public.mm_profiles (id) on delete cascade,
  username text not null,
  encrypted_payload text not null,
  updated_at timestamptz not null default now()
);

create index if not exists team_positions_updated_idx on public.team_positions (updated_at desc);

alter table public.team_positions enable row level security;

drop policy if exists "team_positions_select_authenticated" on public.team_positions;
create policy "team_positions_select_authenticated"
  on public.team_positions for select
  to authenticated
  using (true);

drop policy if exists "team_positions_insert_own" on public.team_positions;
create policy "team_positions_insert_own"
  on public.team_positions for insert
  to authenticated
  with check (auth.uid() = profile_id);

drop policy if exists "team_positions_update_own" on public.team_positions;
create policy "team_positions_update_own"
  on public.team_positions for update
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

drop policy if exists "team_positions_delete_own" on public.team_positions;
create policy "team_positions_delete_own"
  on public.team_positions for delete
  to authenticated
  using (auth.uid() = profile_id);

-- Enable Realtime (Database > Replication) for public.team_positions in the Supabase dashboard.
