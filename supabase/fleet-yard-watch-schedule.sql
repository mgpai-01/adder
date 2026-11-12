-- Yard alert (Fleet): run the yard check every minute, around the clock, so
-- the "no trailers for 30 minutes" timers keep counting even when nobody has
-- the site open. Supabase calls the app's /api/samsara/yard-watch once a
-- minute (pg_cron schedules it, pg_net makes the web request). That address
-- only refreshes the timers and answers "ok" — it returns no fleet data.
--
-- Run once in Supabase → SQL Editor (after fleet-yard-watch-migration.sql).
-- Safe to run again: it replaces the job instead of adding a second one.
-- To stop it later:  select cron.unschedule('mgp-yard-watch');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('mgp-yard-watch')
where exists (select 1 from cron.job where jobname = 'mgp-yard-watch');

select cron.schedule(
  'mgp-yard-watch',
  '* * * * *',
  $$ select net.http_get(url := 'https://adder-pink.vercel.app/api/samsara/yard-watch', timeout_milliseconds := 55000) $$
);
