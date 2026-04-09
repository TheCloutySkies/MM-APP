-- E2EE live comms: public keys and ciphertext envelopes only (no plaintext on server).
-- Private keys stay client-side (IndexedDB on web PWA, PIN-wrapped).

-- Public identity keys (readable by all signed-in users for ECDH peer fetch).
create table if not exists public.e2ee_identity_keys (
  profile_id uuid primary key references public.mm_profiles (id) on delete cascade,
  public_key_spki text not null,
  updated_at timestamptz not null default now()
);

create index if not exists e2ee_identity_keys_updated_idx on public.e2ee_identity_keys (updated_at desc);

alter table public.e2ee_identity_keys enable row level security;

drop policy if exists "e2ee_identity_keys_select_auth" on public.e2ee_identity_keys;
create policy "e2ee_identity_keys_select_auth"
  on public.e2ee_identity_keys for select
  to authenticated
  using (true);

drop policy if exists "e2ee_identity_keys_upsert_own" on public.e2ee_identity_keys;
create policy "e2ee_identity_keys_upsert_own"
  on public.e2ee_identity_keys for insert
  to authenticated
  with check (auth.uid() = profile_id);

drop policy if exists "e2ee_identity_keys_update_own" on public.e2ee_identity_keys;
create policy "e2ee_identity_keys_update_own"
  on public.e2ee_identity_keys for update
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

drop policy if exists "e2ee_identity_keys_delete_own" on public.e2ee_identity_keys;
create policy "e2ee_identity_keys_delete_own"
  on public.e2ee_identity_keys for delete
  to authenticated
  using (auth.uid() = profile_id);

-- First authenticated user can bootstrap admins; existing admins can add more.
create table if not exists public.e2ee_group_admins (
  profile_id uuid primary key references public.mm_profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.e2ee_group_admins enable row level security;

drop policy if exists "e2ee_group_admins_select" on public.e2ee_group_admins;
create policy "e2ee_group_admins_select"
  on public.e2ee_group_admins for select
  to authenticated
  using (true);

drop policy if exists "e2ee_group_admins_bootstrap" on public.e2ee_group_admins;
create policy "e2ee_group_admins_bootstrap"
  on public.e2ee_group_admins for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    and not exists (select 1 from public.e2ee_group_admins)
  );

drop policy if exists "e2ee_group_admins_promote" on public.e2ee_group_admins;
create policy "e2ee_group_admins_promote"
  on public.e2ee_group_admins for insert
  to authenticated
  with check (
    exists (select 1 from public.e2ee_group_admins g where g.profile_id = auth.uid())
    and profile_id <> auth.uid()
  );

-- Group AES key wraps: AES-GCM ciphertext of the 32-byte group key, encrypted per member using ECDH(admin,member).
create table if not exists public.e2ee_group_key_wraps (
  id uuid primary key default gen_random_uuid(),
  group_id text not null default 'global',
  member_id uuid not null references public.mm_profiles (id) on delete cascade,
  admin_id uuid not null references public.mm_profiles (id) on delete cascade,
  key_version int not null default 1,
  iv text not null,
  ciphertext text not null,
  created_at timestamptz not null default now(),
  unique (group_id, member_id, key_version)
);

create index if not exists e2ee_group_key_wraps_member_idx on public.e2ee_group_key_wraps (member_id, group_id, key_version desc);

alter table public.e2ee_group_key_wraps enable row level security;

drop policy if exists "e2ee_wrap_select_own" on public.e2ee_group_key_wraps;
create policy "e2ee_wrap_select_own"
  on public.e2ee_group_key_wraps for select
  to authenticated
  using (member_id = auth.uid());

drop policy if exists "e2ee_wrap_insert_admin" on public.e2ee_group_key_wraps;
create policy "e2ee_wrap_insert_admin"
  on public.e2ee_group_key_wraps for insert
  to authenticated
  with check (
    admin_id = auth.uid()
    and exists (select 1 from public.e2ee_group_admins g where g.profile_id = auth.uid())
  );

-- Offline / catch-up: ciphertext envelopes (IV + ciphertext only).
create table if not exists public.e2ee_comms_envelopes (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.mm_profiles (id) on delete cascade,
  recipient_id uuid references public.mm_profiles (id) on delete cascade,
  group_id text,
  iv text not null,
  ciphertext text not null,
  client_msg_id text,
  created_at timestamptz not null default now(),
  constraint e2ee_envelope_target_chk check (
    (recipient_id is not null and group_id is null)
    or (recipient_id is null and group_id is not null)
  )
);

create index if not exists e2ee_envelopes_recipient_created_idx
  on public.e2ee_comms_envelopes (recipient_id, created_at desc)
  where recipient_id is not null;

create index if not exists e2ee_envelopes_group_created_idx
  on public.e2ee_comms_envelopes (group_id, created_at desc)
  where group_id is not null;

alter table public.e2ee_comms_envelopes enable row level security;

drop policy if exists "e2ee_env_insert_own" on public.e2ee_comms_envelopes;
create policy "e2ee_env_insert_own"
  on public.e2ee_comms_envelopes for insert
  to authenticated
  with check (sender_id = auth.uid());

-- DM: only recipient (and sender for auditing) reads. Group global: any authed read (ciphertext only).
drop policy if exists "e2ee_env_select" on public.e2ee_comms_envelopes;
create policy "e2ee_env_select"
  on public.e2ee_comms_envelopes for select
  to authenticated
  using (
    recipient_id = auth.uid()
    or sender_id = auth.uid()
    or (group_id is not null and group_id = 'global')
  );

drop policy if exists "e2ee_env_delete_own" on public.e2ee_comms_envelopes;
create policy "e2ee_env_delete_own"
  on public.e2ee_comms_envelopes for delete
  to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists "e2ee_wrap_delete_involved" on public.e2ee_group_key_wraps;
create policy "e2ee_wrap_delete_involved"
  on public.e2ee_group_key_wraps for delete
  to authenticated
  using (member_id = auth.uid() or admin_id = auth.uid());

drop policy if exists "e2ee_admins_delete_self" on public.e2ee_group_admins;
create policy "e2ee_admins_delete_self"
  on public.e2ee_group_admins for delete
  to authenticated
  using (profile_id = auth.uid());

-- Realtime: applied in 20260422090000_e2ee_envelopes_realtime.sql (adds table to supabase_realtime publication).

comment on table public.e2ee_identity_keys is 'P-384 ECDH public keys (SPKI base64) for E2EE comms.';
comment on table public.e2ee_group_key_wraps is 'AES-GCM wraps of the shared group key per member (admin-distributed).';
comment on table public.e2ee_comms_envelopes is 'Offline/sync ciphertext envelopes; payloads are never plaintext.';
