-- Enable Postgres changes / Realtime for tactical map (safe to re-run manually if it errors once).
alter publication supabase_realtime add table public.map_markers;
