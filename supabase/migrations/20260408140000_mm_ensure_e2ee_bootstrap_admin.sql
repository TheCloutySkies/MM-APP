-- Idempotent: if no chat admins exist yet, promote the caller as the first admin.
-- Helps first-time unlock when client-side insert races RLS or network.

create or replace function public.mm_ensure_e2ee_bootstrap_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.e2ee_group_admins) then
    insert into public.e2ee_group_admins (profile_id)
    values (auth.uid())
    on conflict (profile_id) do nothing;
  end if;
end;
$$;

revoke all on function public.mm_ensure_e2ee_bootstrap_admin() from public;
grant execute on function public.mm_ensure_e2ee_bootstrap_admin() to authenticated;
