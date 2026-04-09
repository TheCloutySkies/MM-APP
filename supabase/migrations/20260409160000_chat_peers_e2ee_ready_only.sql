-- Team chat directory: only members who completed browser E2EE setup (identity row).
-- Keeps “New message” lists aligned with who can actually receive encrypted DMs.

create or replace function public.mm_list_chat_peers()
returns table (id uuid, username text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.username
  from public.mm_profiles p
  inner join public.e2ee_identity_keys k on k.profile_id = p.id
  order by p.username asc;
$$;

revoke all on function public.mm_list_chat_peers() from public;
grant execute on function public.mm_list_chat_peers() to authenticated;

comment on function public.mm_list_chat_peers is
  'Chat directory: profiles with e2ee_identity_keys only (web team chat ready). id + username.';
