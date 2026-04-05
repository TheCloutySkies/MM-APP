-- MM APP: profiles, encrypted vault index, map markers, missions, storage policies.
-- Access uses custom JWT where auth.uid() = mm_profiles.id

create extension if not exists "pgcrypto";

create table if not exists public.mm_profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  access_key_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.vault_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.mm_profiles (id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists vault_objects_owner_idx on public.vault_objects (owner_id);

create table if not exists public.map_markers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.mm_profiles (id) on delete cascade,
  encrypted_payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists map_markers_created_idx on public.map_markers (created_at desc);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.mm_profiles (id) on delete cascade,
  ciphertext text not null,
  created_at timestamptz not null default now()
);

create index if not exists missions_owner_idx on public.missions (owner_id);

alter table public.mm_profiles enable row level security;
alter table public.vault_objects enable row level security;
alter table public.map_markers enable row level security;
alter table public.missions enable row level security;

drop policy if exists "mm_profiles_select_own" on public.mm_profiles;
create policy "mm_profiles_select_own"
  on public.mm_profiles for select
  using (auth.uid() = id);

drop policy if exists "vault_objects_all_own" on public.vault_objects;
create policy "vault_objects_all_own"
  on public.vault_objects for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "map_markers_select_authenticated" on public.map_markers;
create policy "map_markers_select_authenticated"
  on public.map_markers for select
  to authenticated
  using (true);

drop policy if exists "map_markers_insert_own" on public.map_markers;
create policy "map_markers_insert_own"
  on public.map_markers for insert
  to authenticated
  with check (auth.uid() = profile_id);

drop policy if exists "map_markers_delete_own" on public.map_markers;
create policy "map_markers_delete_own"
  on public.map_markers for delete
  to authenticated
  using (auth.uid() = profile_id);

drop policy if exists "missions_all_own" on public.missions;
create policy "missions_all_own"
  on public.missions for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Enable Realtime for public.map_markers in the Supabase Dashboard (Database > Replication).

insert into storage.buckets (id, name, public)
values ('vault', 'vault', false)
on conflict (id) do nothing;

drop policy if exists "vault_storage_select" on storage.objects;
create policy "vault_storage_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'vault'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "vault_storage_insert" on storage.objects;
create policy "vault_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'vault'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "vault_storage_update" on storage.objects;
create policy "vault_storage_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'vault'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "vault_storage_delete" on storage.objects;
create policy "vault_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'vault'
    and (storage.foldername (name))[1] = auth.uid()::text
  );
