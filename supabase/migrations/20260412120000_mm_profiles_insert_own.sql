-- Email-auth self-heal: if the auth.users trigger did not create mm_profiles (existing users,
-- failed deploy, etc.), the client can insert a row with id = auth.uid(). SELECT/UPDATE already scoped.

drop policy if exists "mm_profiles_insert_own" on public.mm_profiles;
create policy "mm_profiles_insert_own"
  on public.mm_profiles for insert
  to authenticated
  with check (auth.uid() = id);
