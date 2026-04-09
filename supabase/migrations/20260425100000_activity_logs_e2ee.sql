-- Zero-knowledge audit trail: server stores opaque ciphertext; clients with the team AES key decrypt.
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users (id) on delete cascade,
  encrypted_payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_at_idx on public.activity_logs (created_at desc);

alter table public.activity_logs enable row level security;

drop policy if exists "activity_logs_select_authenticated" on public.activity_logs;
create policy "activity_logs_select_authenticated"
  on public.activity_logs for select
  to authenticated
  using (true);

drop policy if exists "activity_logs_insert_own_actor" on public.activity_logs;
create policy "activity_logs_insert_own_actor"
  on public.activity_logs for insert
  to authenticated
  with check (auth.uid() = actor_id);

comment on table public.activity_logs is
  'End-to-end encrypted operational audit entries (AES-GCM with team group key on clients).';
