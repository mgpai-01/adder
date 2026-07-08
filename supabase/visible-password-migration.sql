-- Stores a viewable copy of the password last set for a user THROUGH the admin
-- panel (Add User / Reset Password), so an admin can re-view it after re-entering
-- their own password. Only populated for passwords set from the app onward;
-- passwords set before this migration remain hidden (Supabase only keeps a hash).
--
-- Security note: this is plaintext by design so it can be shown back. It is only
-- ever returned by an admin-only endpoint that first re-verifies the requesting
-- admin's own password. Treat database access accordingly.
alter table public.profiles
  add column if not exists visible_password text;

comment on column public.profiles.visible_password is 'Viewable copy of the password last set via the admin panel. Admin-gated read only.';
