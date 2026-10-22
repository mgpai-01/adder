-- Lets pallet types use the "Custom" category the app offers (and defaults new
-- pallets to). Without it, saving a Custom pallet type fails in the database.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
alter type public.pallet_category add value if not exists 'Custom';
