-- Run in Supabase Dashboard → SQL Editor (or: supabase db execute -f this-file)
-- Idempotent; safe to re-run.

insert into public.mm_profiles (id, username, access_key_hash, callsign_ok)
select
  u.id,
  'pending-' || substr(replace(u.id::text, '-', ''), 1, 12),
  null,
  false
from auth.users u
where not exists (select 1 from public.mm_profiles p where p.id = u.id);

update public.mm_profiles mp
set
  username = 'pending-' || substr(replace(mp.id::text, '-', ''), 1, 12),
  callsign_ok = false
where mp.access_key_hash is null
  and mp.username ~ '@';
