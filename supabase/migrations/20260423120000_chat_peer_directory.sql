-- Read-only directory of member callsigns for E2EE chat picker (no vault or auth secrets).
-- Underlying mm_profiles row may contain sensitive columns; this RPC returns only id + username.

create or replace function public.mm_list_chat_peers()
returns table (id uuid, username text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.username from public.mm_profiles p;
$$;

revoke all on function public.mm_list_chat_peers() from public;
grant execute on function public.mm_list_chat_peers() to authenticated;

comment on function public.mm_list_chat_peers is 'Directory for Team chat: member id + callsign only. E2EE SPKI stays in e2ee_identity_keys.';
