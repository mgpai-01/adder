-- Fix: after login the app failed with "permission denied for table profiles".
--
-- The profiles table has Row-Level Security enabled but was missing a SELECT
-- policy and the table grant for the authenticated role, so signed-in users
-- could not read their own profile row (which the app reads at login to get
-- their role). This grants table access and adds a policy letting each user
-- read only their own row.
--
-- Admin user-management runs server-side with the service-role key (which
-- bypasses RLS), so it is unaffected by this row-level policy.
--
-- Safe to run multiple times.

grant select on public.profiles to authenticated;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select
to authenticated
using (auth.uid() = id);
