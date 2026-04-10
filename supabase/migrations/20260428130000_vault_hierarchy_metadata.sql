-- True hierarchical folders: metadata.parent_id + is_folder; folder rows have vault_objects.storage_path NULL.
-- Trash: vault_metadata.trashed_at (soft delete).
-- vault_objects.vault_partition: required when storage_path is NULL (folder placeholders).

alter table public.vault_objects alter column storage_path drop not null;

alter table public.vault_objects add column if not exists vault_partition text;

update public.vault_objects vo
set vault_partition = split_part(vo.storage_path, '/', 2)
where vo.vault_partition is null
  and vo.storage_path is not null;

update public.vault_objects
set vault_partition = 'main'
where vault_partition is null;

alter table public.vault_objects alter column vault_partition set not null;

alter table public.vault_metadata add column if not exists is_folder boolean not null default false;
alter table public.vault_metadata add column if not exists parent_id uuid references public.vault_metadata (vault_object_id) on delete set null;
alter table public.vault_metadata add column if not exists trashed_at timestamptz;

create index if not exists vault_metadata_parent_idx on public.vault_metadata (parent_id);
create index if not exists vault_metadata_trashed_idx on public.vault_metadata (trashed_at) where trashed_at is not null;

comment on column public.vault_objects.vault_partition is 'main | decoy — mirrors path segment; required for folder rows without storage_path';
comment on column public.vault_metadata.is_folder is 'Folder placeholder when vault_objects.storage_path is NULL';
comment on column public.vault_metadata.parent_id is 'Parent folder vault_object_id; NULL = My Vault root';
comment on column public.vault_metadata.trashed_at is 'When set, item is shown under Trash';
