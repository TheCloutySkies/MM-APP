-- Threaded discussion on encrypted ops reports (mission plans, etc.). Payload is client-encrypted with team map key.

create table if not exists public.ops_comments (
  id uuid primary key default gen_random_uuid(),
  ops_report_id uuid not null references public.ops_reports (id) on delete cascade,
  author_id uuid not null references public.mm_profiles (id) on delete cascade,
  author_username text not null,
  encrypted_payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists ops_comments_report_created_idx
  on public.ops_comments (ops_report_id, created_at desc);

alter table public.ops_comments enable row level security;

drop policy if exists "ops_comments_select_authenticated" on public.ops_comments;
create policy "ops_comments_select_authenticated"
  on public.ops_comments for select
  to authenticated
  using (true);

drop policy if exists "ops_comments_insert_own" on public.ops_comments;
create policy "ops_comments_insert_own"
  on public.ops_comments for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "ops_comments_delete_own" on public.ops_comments;
create policy "ops_comments_delete_own"
  on public.ops_comments for delete
  to authenticated
  using (auth.uid() = author_id);
