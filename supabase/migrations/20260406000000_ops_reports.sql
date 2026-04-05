-- Team-visible operational reports (mission plans, SITREPs, AARs).
-- Ciphertext uses the same client key strategy as map markers (shared hex or vault partition).
-- RLS: any authenticated user may read; only author may insert/delete own rows.

create table if not exists public.ops_reports (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.mm_profiles (id) on delete cascade,
  author_username text not null,
  doc_kind text not null check (doc_kind in ('mission_plan', 'sitrep', 'aar')),
  encrypted_payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists ops_reports_kind_created_idx on public.ops_reports (doc_kind, created_at desc);
create index if not exists ops_reports_author_idx on public.ops_reports (author_id);

alter table public.ops_reports enable row level security;

drop policy if exists "ops_reports_select_authenticated" on public.ops_reports;
create policy "ops_reports_select_authenticated"
  on public.ops_reports for select
  to authenticated
  using (true);

drop policy if exists "ops_reports_insert_own" on public.ops_reports;
create policy "ops_reports_insert_own"
  on public.ops_reports for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "ops_reports_delete_own" on public.ops_reports;
create policy "ops_reports_delete_own"
  on public.ops_reports for delete
  to authenticated
  using (auth.uid() = author_id);

-- Enable Realtime in Dashboard → Database → Replication → ops_reports (optional).
