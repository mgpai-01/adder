create extension if not exists "pgcrypto";

create type public.user_role as enum ('admin', 'supervisor', 'employee');
create type public.shift_name as enum ('AM', 'PM', 'Swing');
create type public.break_profile as enum ('standard', 'paidLunch', 'noLunch');
create type public.pallet_category as enum ('Stacker', 'Repair', 'Extend', 'Cut', 'Outside', 'QC Deductions');
create type public.count_sheet_status as enum ('Pending', 'Approved', 'Rejected');

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'supervisor',
  location_id uuid references public.locations(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  location_id uuid not null references public.locations(id),
  shift public.shift_name not null default 'AM',
  active boolean not null default true,
  payroll_id text,
  notes text,
  photo_url text,
  created_at timestamptz not null default now()
);

create table public.pallet_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  category public.pallet_category not null default 'Repair',
  repair_rate numeric(8, 2) not null,
  photo_url text,
  bilingual_label text,
  customer_rate_note text,
  location_rate_note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.production_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  employee_id uuid not null references public.employees(id),
  location_id uuid not null references public.locations(id),
  shift public.shift_name not null,
  clock_in time,
  clock_out time,
  manual_hours numeric(5, 2) not null check (manual_hours >= 0),
  break_profile public.break_profile not null default 'standard',
  notes text,
  entered_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by text
);

create table public.production_entry_lines (
  id uuid primary key default gen_random_uuid(),
  production_entry_id uuid not null references public.production_entries(id) on delete cascade,
  pallet_type_id uuid not null references public.pallet_types(id),
  quantity integer not null check (quantity >= 0),
  created_at timestamptz not null default now()
);

create table public.payroll_settings (
  id boolean primary key default true,
  minimum_wage numeric(8, 2) not null default 16.90,
  overtime_multiplier numeric(4, 2) not null default 1.50,
  daily_overtime_threshold numeric(4, 2) not null default 8.00,
  daily_production_goal integer not null default 4500 check (daily_production_goal >= 0),
  updated_at timestamptz not null default now(),
  constraint one_settings_row check (id)
);

create table public.count_sheets (
  id uuid primary key default gen_random_uuid(),
  sheet_date date not null,
  location_id text not null,
  shift public.shift_name not null,
  uploaded_by text not null default 'Counter',
  upload_time timestamptz not null default now(),
  notes text,
  status public.count_sheet_status not null default 'Pending',
  comments text,
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  updated_at timestamptz,
  updated_by text,
  created_at timestamptz not null default now()
);

create table public.count_sheet_photos (
  id uuid primary key default gen_random_uuid(),
  count_sheet_id uuid not null references public.count_sheets(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  public_url text not null,
  size integer,
  content_type text,
  uploaded_at timestamptz not null default now()
);

create view public.payroll_entry_calculations as
select
  pe.id,
  pe.entry_date,
  pe.employee_id,
  pe.location_id,
  pe.shift,
  sum(pel.quantity) as quantity,
  greatest(
    0,
    case
      when pe.break_profile = 'standard' then pe.manual_hours - 0.50
      else pe.manual_hours
    end
  ) as paid_hours,
  greatest(
    0,
    case
      when pe.break_profile = 'standard' then pe.manual_hours - 0.50
      else pe.manual_hours
    end - ps.daily_overtime_threshold
  ) as overtime_hours,
  sum(pel.quantity * pt.repair_rate) as piece_earnings,
  greatest(
    0,
    (
      least(
        case
          when pe.break_profile = 'standard' then pe.manual_hours - 0.50
          else pe.manual_hours
        end,
        ps.daily_overtime_threshold
      ) * ps.minimum_wage
    ) +
    (
      greatest(
        0,
        case
          when pe.break_profile = 'standard' then pe.manual_hours - 0.50
          else pe.manual_hours
        end - ps.daily_overtime_threshold
      ) * ps.minimum_wage * ps.overtime_multiplier
    )
  ) as minimum_wage_required
from public.production_entries pe
join public.production_entry_lines pel on pel.production_entry_id = pe.id
join public.pallet_types pt on pt.id = pel.pallet_type_id
cross join public.payroll_settings ps
group by
  pe.id,
  pe.entry_date,
  pe.employee_id,
  pe.location_id,
  pe.shift,
  pe.break_profile,
  pe.manual_hours,
  ps.daily_overtime_threshold,
  ps.minimum_wage,
  ps.overtime_multiplier;

alter table public.locations enable row level security;
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.pallet_types enable row level security;
alter table public.production_entries enable row level security;
alter table public.production_entry_lines enable row level security;
alter table public.payroll_settings enable row level security;
alter table public.count_sheets enable row level security;
alter table public.count_sheet_photos enable row level security;

create policy "Authenticated users can read setup data"
on public.locations for select
to authenticated
using (true);

create policy "Authenticated users can read employees"
on public.employees for select
to authenticated
using (true);

create policy "Authenticated users can read pallet types"
on public.pallet_types for select
to authenticated
using (true);

create policy "Supervisors and admins can insert production"
on public.production_entries for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('admin', 'supervisor')
    and profiles.active
  )
);

create policy "Authenticated users can read production"
on public.production_entries for select
to authenticated
using (true);

create policy "Supervisors and admins can insert production lines"
on public.production_entry_lines for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('admin', 'supervisor')
    and profiles.active
  )
);

create policy "Authenticated users can read production lines"
on public.production_entry_lines for select
to authenticated
using (true);

create policy "Supervisors and admins can manage count sheets"
on public.count_sheets for all
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('admin', 'supervisor')
    and profiles.active
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('admin', 'supervisor')
    and profiles.active
  )
);

create policy "Authenticated users can read count sheet photos"
on public.count_sheet_photos for select
to authenticated
using (true);

create policy "Supervisors and admins can manage count sheet photos"
on public.count_sheet_photos for all
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('admin', 'supervisor')
    and profiles.active
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('admin', 'supervisor')
    and profiles.active
  )
);

insert into storage.buckets (id, name, public)
values ('count-sheets', 'count-sheets', true)
on conflict (id) do nothing;

create policy "Admins can manage setup"
on public.pallet_types for all
to authenticated
using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin')
)
with check (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

insert into public.locations (code, name) values
  ('fontana', 'Fontana'),
  ('citrus', 'Citrus'),
  ('mesa', 'Mesa')
on conflict (code) do nothing;

insert into public.payroll_settings (id, minimum_wage, overtime_multiplier, daily_overtime_threshold, daily_production_goal)
values (true, 16.90, 1.50, 8.00, 4500)
on conflict (id) do nothing;

insert into public.pallet_types (code, description, category, repair_rate) values
  ('1 STACKER', 'BLOCK', 'Stacker', 1.00),
  ('2 STACKER', 'GRADE B #2', 'Stacker', 1.00),
  ('3 STACKER', 'REGULAR', 'Stacker', 1.00),
  ('4 STACKER', 'GRADE A #1', 'Stacker', 1.00),
  ('5 STACKER', 'Pallet Grande que sale para fuera', 'Stacker', 1.00),
  ('STACK BY HAND', '#1 CAMBIAR BARROTE', 'Stacker', 1.35),
  ('REPAIR', '60x40', 'Repair', 1.75),
  ('EXTEND', '60x40', 'Extend', 2.00),
  ('CUT', '60x40', 'Cut', 2.25),
  ('OUTSIDE BLOCK', 'BLOCK', 'Outside', 1.00),
  ('OUTSIDE GRADE B #2', 'GRADE B #2', 'Outside', 1.00),
  ('OUTSIDE REGULAR', 'REGULAR', 'Outside', 1.00),
  ('OUTSIDE GRADE A #1', 'GRADE A #1', 'Outside', 1.00),
  ('Quality Control Rejects', 'Reject deduction', 'QC Deductions', -2.00)
on conflict (code) do nothing;
