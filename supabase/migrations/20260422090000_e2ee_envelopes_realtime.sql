-- Expose envelope rows to Supabase Realtime (postgres_changes). RLS still applies per subscriber JWT.
-- INSERT events carry full new row; no plaintext is stored on the server.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'e2ee_comms_envelopes'
  ) then
    alter publication supabase_realtime add table public.e2ee_comms_envelopes;
  end if;
end $$;
