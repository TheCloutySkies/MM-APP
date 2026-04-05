-- Repair auth email/password users: backfill mm_profiles if the insert trigger was missed,
-- and normalize username when it is still an email (breaks in-app callsign rules + older trigger behavior).
-- Runs after callsign_onboarding (20260411150000).

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
where (mp.access_key_hash is null)
  and (mp.username ~ '@');
