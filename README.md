# MGP Pallet Repair Tracking and Payroll System

Full local project for the MGP pallet repair tracking, production count, count sheet, live board, and payroll MVP.

## Included App Areas

- Main management app at `/`
- Counter-only floor app at `/counter`
- Live warehouse TV board at `/live-board`
- Production Grid
- Entry History
- Count Sheets and photo uploads
- Dashboard
- Payroll reports
- Admin settings
- Pallet type management
- Repairer management
- Local MVP storage
- Supabase-ready schema and API structure
- Google Sheets integration hooks

## Local Development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
http://localhost:3000/counter
http://localhost:3000/live-board
```

For phone/tablet testing, use the Network URL printed by Next.js, such as:

```text
http://192.168.x.x:3000/counter
```

## Build

```bash
npm run build
npm run start
```

## Storage

When Supabase is not configured, the MVP uses local files:

- `data/production-entries.json`
- `data/pallet-types.json`
- `data/payroll-settings.json`
- `data/count-sheets.json`
- `public/uploads/count-sheets/`

These files may include real production records and uploaded count sheet photos.

## Supabase

Schema files are in:

- `supabase/schema.sql`
- `supabase/pallet-types-admin-migration.sql`

## Notes

This folder may include generated build files, local data, uploaded photos, and installed dependencies if packaged as a complete handoff.
