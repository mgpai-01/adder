-- Per-account UI language preference. Null means "use the role default"
-- (managers start in Spanish, everyone else in English). Values: 'en' | 'es'.
alter table public.profiles
  add column if not exists preferred_language text;

comment on column public.profiles.preferred_language is 'UI language preference: en or es. Null = fall back to role default.';
