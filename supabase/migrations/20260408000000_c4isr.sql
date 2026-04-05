-- C4ISR: operation hubs, scoped reports, bulletin, gear loadouts, vault folders.

-- ---------------------------------------------------------------------------
-- Operation hubs (encrypted mission / operation records)
-- ---------------------------------------------------------------------------
create table if not exists public.operation_hubs (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.mm_profiles (id) on delete cascade,
  author_username text not null,
  encrypted_payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists operation_hubs_created_idx on public.operation_hubs (created_at desc);
create index if not exists operation_hubs_author_idx on public.operation_hubs (author_id);

alter table public.operation_hubs enable row level security;

drop policy if exists "operation_hubs_select_authenticated" on public.operation_hubs;
create policy "operation_hubs_select_authenticated"
  on public.operation_hubs for select
  to authenticated
  using (true);

drop policy if exists "operation_hubs_insert_own" on public.operation_hubs;
create policy "operation_hubs_insert_own"
  on public.operation_hubs for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "operation_hubs_delete_own" on public.operation_hubs;
create policy "operation_hubs_delete_own"
  on public.operation_hubs for delete
  to authenticated
  using (auth.uid() = author_id);

drop policy if exists "operation_hubs_update_own" on public.operation_hubs;
create policy "operation_hubs_update_own"
  on public.operation_hubs for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- ---------------------------------------------------------------------------
-- ops_reports: optional operation scope + new doc kinds
-- ---------------------------------------------------------------------------
alter table public.ops_reports add column if not exists operation_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ops_reports_operation_id_fkey'
  ) then
    alter table public.ops_reports
      add constraint ops_reports_operation_id_fkey
      foreign key (operation_id) references public.operation_hubs (id) on delete set null;
  end if;
end$$;

create index if not exists ops_reports_operation_idx on public.ops_reports (operation_id);

alter table public.ops_reports drop constraint if exists ops_reports_doc_kind_check;

alter table public.ops_reports add constraint ops_reports_doc_kind_check check (
  doc_kind in (
    'mission_plan',
    'sitrep',
    'aar',
    'target_package',
    'intel_report'
  )
);

-- ---------------------------------------------------------------------------
-- Bulletin board (client-encrypted payloads)
-- ---------------------------------------------------------------------------
create table if not exists public.bulletin_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.mm_profiles (id) on delete cascade,
  author_username text not null,
  encrypted_payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists bulletin_posts_created_idx on public.bulletin_posts (created_at desc);

alter table public.bulletin_posts enable row level security;

drop policy if exists "bulletin_posts_select_authenticated" on public.bulletin_posts;
create policy "bulletin_posts_select_authenticated"
  on public.bulletin_posts for select
  to authenticated
  using (true);

drop policy if exists "bulletin_posts_insert_own" on public.bulletin_posts;
create policy "bulletin_posts_insert_own"
  on public.bulletin_posts for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "bulletin_posts_update_own" on public.bulletin_posts;
create policy "bulletin_posts_update_own"
  on public.bulletin_posts for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "bulletin_posts_delete_own" on public.bulletin_posts;
create policy "bulletin_posts_delete_own"
  on public.bulletin_posts for delete
  to authenticated
  using (auth.uid() = author_id);

-- ---------------------------------------------------------------------------
-- Gear loadouts (Line 1–3 checklists, encrypted)
-- ---------------------------------------------------------------------------
create table if not exists public.gear_loadouts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.mm_profiles (id) on delete cascade,
  author_username text not null,
  encrypted_payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists gear_loadouts_created_idx on public.gear_loadouts (created_at desc);

alter table public.gear_loadouts enable row level security;

drop policy if exists "gear_loadouts_select_authenticated" on public.gear_loadouts;
create policy "gear_loadouts_select_authenticated"
  on public.gear_loadouts for select
  to authenticated
  using (true);

drop policy if exists "gear_loadouts_insert_own" on public.gear_loadouts;
create policy "gear_loadouts_insert_own"
  on public.gear_loadouts for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "gear_loadouts_update_own" on public.gear_loadouts;
create policy "gear_loadouts_update_own"
  on public.gear_loadouts for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "gear_loadouts_delete_own" on public.gear_loadouts;
create policy "gear_loadouts_delete_own"
  on public.gear_loadouts for delete
  to authenticated
  using (auth.uid() = author_id);

-- ---------------------------------------------------------------------------
-- Vault folders (shared tree; names are client ciphertext)
-- ---------------------------------------------------------------------------
create table if not exists public.vault_folders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.vault_folders (id) on delete cascade,
  encrypted_name text not null,
  created_by uuid not null references public.mm_profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists vault_folders_parent_idx on public.vault_folders (parent_id);

alter table public.vault_folders enable row level security;

drop policy if exists "vault_folders_select_authenticated" on public.vault_folders;
create policy "vault_folders_select_authenticated"
  on public.vault_folders for select
  to authenticated
  using (true);

drop policy if exists "vault_folders_insert_authenticated" on public.vault_folders;
create policy "vault_folders_insert_authenticated"
  on public.vault_folders for insert
  to authenticated
  with check (auth.uid() = created_by);

drop policy if exists "vault_folders_update_creator" on public.vault_folders;
create policy "vault_folders_update_creator"
  on public.vault_folders for update
  to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

drop policy if exists "vault_folders_delete_creator" on public.vault_folders;
create policy "vault_folders_delete_creator"
  on public.vault_folders for delete
  to authenticated
  using (auth.uid() = created_by);

alter table public.vault_objects add column if not exists folder_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vault_objects_folder_id_fkey'
  ) then
    alter table public.vault_objects
      add constraint vault_objects_folder_id_fkey
      foreign key (folder_id) references public.vault_folders (id) on delete set null;
  end if;
end$$;

create index if not exists vault_objects_folder_idx on public.vault_objects (folder_id);
