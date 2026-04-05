-- Email/password accounts: auto-create mm_profiles when a Supabase Auth user is created.
-- access_key_hash is only for legacy "team access key" users; NULL for normal sign-ups.

alter table public.mm_profiles
  alter column access_key_hash drop not null;

comment on column public.mm_profiles.access_key_hash is
  'Legacy Argon2 hash for mm-login Edge Function; NULL when the user signs up with Supabase Auth email/password.';

-- Idempotent profile row for every new auth.users row (id must match for RLS auth.uid()).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
begin
  uname := lower(trim(coalesce(new.email, new.id::text)));
  insert into public.mm_profiles (id, username, access_key_hash)
  values (new.id, uname, null)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();
