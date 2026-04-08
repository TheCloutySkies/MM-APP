-- Duress calendar: profile PIN hashes + encrypted event blobs (no plaintext metadata columns).
-- App uses public.mm_profiles (not a separate profiles table).

alter table public.mm_profiles
  add column if not exists primary_pin_hash text,
  add column if not exists duress_pin_hash text,
  add column if not exists calendar_salt_primary text,
  add column if not exists calendar_salt_duress text;

comment on column public.mm_profiles.primary_pin_hash is
  'SHA-256 hex of primary numeric PIN — client only; never store plaintext PINs.';
comment on column public.mm_profiles.duress_pin_hash is
  'SHA-256 hex of duress numeric PIN — client only.';
comment on column public.mm_profiles.calendar_salt_primary is
  'Hex-encoded random salt for PBKDF2(primary PIN) calendar encryption.';
comment on column public.mm_profiles.calendar_salt_duress is
  'Hex-encoded random salt for PBKDF2(duress PIN) decoy calendar encryption.';

-- Real / decoy calendars: single ciphertext column; all event fields live inside the encrypted JSON.
create table if not exists public.events_real (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.mm_profiles (id) on delete cascade,
  encrypted_payload text not null
);

create table if not exists public.events_decoy (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.mm_profiles (id) on delete cascade,
  encrypted_payload text not null
);

create index if not exists events_real_author_idx on public.events_real (author_id);
create index if not exists events_decoy_author_idx on public.events_decoy (author_id);

alter table public.events_real enable row level security;
alter table public.events_decoy enable row level security;

drop policy if exists "events_real_select_authenticated" on public.events_real;
create policy "events_real_select_authenticated"
  on public.events_real for select
  to authenticated
  using (true);

drop policy if exists "events_real_insert_own" on public.events_real;
create policy "events_real_insert_own"
  on public.events_real for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "events_real_update_own" on public.events_real;
create policy "events_real_update_own"
  on public.events_real for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "events_real_delete_own" on public.events_real;
create policy "events_real_delete_own"
  on public.events_real for delete
  to authenticated
  using (auth.uid() = author_id);

drop policy if exists "events_decoy_select_authenticated" on public.events_decoy;
create policy "events_decoy_select_authenticated"
  on public.events_decoy for select
  to authenticated
  using (true);

drop policy if exists "events_decoy_insert_own" on public.events_decoy;
create policy "events_decoy_insert_own"
  on public.events_decoy for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "events_decoy_update_own" on public.events_decoy;
create policy "events_decoy_update_own"
  on public.events_decoy for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "events_decoy_delete_own" on public.events_decoy;
create policy "events_decoy_delete_own"
  on public.events_decoy for delete
  to authenticated
  using (auth.uid() = author_id);

-- Enable Replication → supabase_realtime for these tables in Dashboard if needed.
-- SQL (linked project): uncomment if your project exposes publication DDL:
-- alter publication supabase_realtime add table public.events_real;
-- alter publication supabase_realtime add table public.events_decoy;
