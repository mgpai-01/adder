do $$
begin
  create type public.pallet_category as enum ('Stacker', 'Repair', 'Extend', 'Cut', 'Outside', 'QC Deductions');
exception
  when duplicate_object then null;
end $$;

alter table public.pallet_types
  add column if not exists category public.pallet_category not null default 'Repair',
  add column if not exists bilingual_label text,
  add column if not exists customer_rate_note text,
  add column if not exists location_rate_note text;

alter table public.pallet_types
  drop constraint if exists pallet_types_repair_rate_check;

alter table public.pallet_types
  alter column repair_rate type numeric(8, 2);

comment on column public.pallet_types.repair_rate is 'Piece rate per pallet. Supports positive earnings and negative deduction rates.';
comment on column public.pallet_types.bilingual_label is 'Placeholder for Spanish or bilingual UI labels.';
comment on column public.pallet_types.customer_rate_note is 'Placeholder for future customer-specific rate overrides.';
comment on column public.pallet_types.location_rate_note is 'Placeholder for future location-specific rate overrides.';

update public.payroll_settings
set minimum_wage = 16.90,
    updated_at = now()
where id = true
  and minimum_wage = 16.50;

alter table public.employees
  add column if not exists shift public.shift_name not null default 'AM',
  add column if not exists notes text,
  add column if not exists photo_url text;

create table if not exists public.production_entry_lines (
  id uuid primary key default gen_random_uuid(),
  production_entry_id uuid not null references public.production_entries(id) on delete cascade,
  pallet_type_id uuid not null references public.pallet_types(id),
  quantity integer not null check (quantity >= 0),
  created_at timestamptz not null default now()
);

alter table public.production_entry_lines enable row level security;
