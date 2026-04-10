-- Vault E2EE: per-object encrypted metadata + optional encrypted thumbnail (client-generated).
-- Object row stays minimal; filenames/sizes/mimes are ciphertext.

create table if not exists public.vault_metadata (
  vault_object_id uuid primary key references public.vault_objects (id) on delete cascade,
  encrypted_meta text not null,
  encrypted_thumbnail text
);

alter table public.vault_metadata enable row level security;

drop policy if exists "vault_metadata_select_own" on public.vault_metadata;
create policy "vault_metadata_select_own"
  on public.vault_metadata for select
  to authenticated
  using (
    exists (
      select 1
      from public.vault_objects vo
      where vo.id = vault_metadata.vault_object_id
        and vo.owner_id = auth.uid()
    )
  );

drop policy if exists "vault_metadata_insert_own" on public.vault_metadata;
create policy "vault_metadata_insert_own"
  on public.vault_metadata for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.vault_objects vo
      where vo.id = vault_metadata.vault_object_id
        and vo.owner_id = auth.uid()
    )
  );

drop policy if exists "vault_metadata_update_own" on public.vault_metadata;
create policy "vault_metadata_update_own"
  on public.vault_metadata for update
  to authenticated
  using (
    exists (
      select 1
      from public.vault_objects vo
      where vo.id = vault_metadata.vault_object_id
        and vo.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.vault_objects vo
      where vo.id = vault_metadata.vault_object_id
        and vo.owner_id = auth.uid()
    )
  );

drop policy if exists "vault_metadata_delete_own" on public.vault_metadata;
create policy "vault_metadata_delete_own"
  on public.vault_metadata for delete
  to authenticated
  using (
    exists (
      select 1
      from public.vault_objects vo
      where vo.id = vault_metadata.vault_object_id
        and vo.owner_id = auth.uid()
    )
  );

-- Idempotent: bucket + storage policies already exist in 20260405000000_mm_schema.sql
insert into storage.buckets (id, name, public)
values ('vault', 'vault', false)
on conflict (id) do nothing;
