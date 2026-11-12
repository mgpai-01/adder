-- Yard alert (Fleet): remembers since when each production yard (Sultana,
-- Merrill, Citrus) has had no trailers parked, so the header bell can alert
-- after 30 minutes. One row per yard while it's empty; the row is removed as
-- soon as a trailer is back. Written only by the server (service role), so
-- row level security is on with no policies.
--
-- Run once in Supabase → SQL Editor.

create table if not exists public.fleet_yard_watch (
  yard_id text primary key,
  empty_since timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.fleet_yard_watch enable row level security;
