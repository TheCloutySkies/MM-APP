-- Opt-in decoy marketing emails when secure sync fails server-side (session/RLS), not for offline-only halts.
alter table public.mm_profiles
  add column if not exists decoy_alerts_enabled boolean not null default false;

comment on column public.mm_profiles.decoy_alerts_enabled is
  'When true, optional generic decoy email may be sent via Edge Function after outbox flush fails with a server rejection (user has connectivity). Default off.';
