-- UI layout preference stored per profile (non-secret metadata; safe to sync across devices).
-- RLS: existing mm_profiles policies already scope select/update to auth.uid() = id for JWT sessions.

alter table public.mm_profiles
  add column if not exists layout_preference text not null default 'auto';

alter table public.mm_profiles
  drop constraint if exists mm_profiles_layout_preference_check;

alter table public.mm_profiles
  add constraint mm_profiles_layout_preference_check
  check (layout_preference in ('mobile', 'desktop', 'auto'));

comment on column public.mm_profiles.layout_preference is
  'Interface mode: mobile tactical, desktop war room, or match device width (auto).';
