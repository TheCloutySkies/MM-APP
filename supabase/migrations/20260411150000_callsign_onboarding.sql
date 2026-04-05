-- Operational callsign in mm_profiles.username (NATO-style kebab, codenames — not legal names).
-- callsign_ok: false until the user sets a proper handle in the app (email auth uses pending-* until then).

alter table public.mm_profiles
  add column if not exists callsign_ok boolean;

update public.mm_profiles set callsign_ok = true where callsign_ok is null;

alter table public.mm_profiles
  alter column callsign_ok set not null,
  alter column callsign_ok set default false;

-- Legacy roster + any row that already has a real handle (not email, not pending placeholder).
update public.mm_profiles
set callsign_ok = true
where access_key_hash is not null
   or (username !~ '@' and username not like 'pending-%');

update public.mm_profiles
set callsign_ok = false
where username ~ '@'
   or username like 'pending-%';

comment on column public.mm_profiles.callsign_ok is
  'False until the user confirms an operational callsign in-app; true for legacy roster and completed onboarding.';

-- New Auth users: stable placeholder until callsign screen runs.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
begin
  uname := 'pending-' || substr(replace(new.id::text, '-', ''), 1, 12);
  insert into public.mm_profiles (id, username, access_key_hash, callsign_ok)
  values (new.id, uname, null, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

drop policy if exists "mm_profiles_update_own" on public.mm_profiles;
create policy "mm_profiles_update_own"
  on public.mm_profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
