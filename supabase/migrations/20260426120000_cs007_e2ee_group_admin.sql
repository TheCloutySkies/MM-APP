-- Grant team-chat E2EE admin (invites / key wraps) to operator callsign cs007.
-- Requires a row in public.mm_profiles with username 'cs007'. Safe to apply if absent (no-op).

insert into public.e2ee_group_admins (profile_id)
select id
from public.mm_profiles
where lower(username) = lower('cs007')
limit 1
on conflict (profile_id) do nothing;
