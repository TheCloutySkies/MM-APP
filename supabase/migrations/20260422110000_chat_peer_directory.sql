-- Read-only teammate directory for encrypted chat (id + username only; no secrets).
-- SECURITY DEFINER: base table RLS would otherwise hide other rows from each user.

create or replace function public.mm_list_chat_peers()
returns table (id uuid, username text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.username from public.mm_profiles p;
$$;

comment on function public.mm_list_chat_peers() is 'Authenticated roster for messenger UI; exposes only id and username.';

revoke all on function public.mm_list_chat_peers() from public;
grant execute on function public.mm_list_chat_peers() to authenticated;
