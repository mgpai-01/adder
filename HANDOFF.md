# MGP Pallet Repair Tracking - Project Handoff

This is a mobile-friendly pallet repair tracking and payroll management app for MGP.

## What The App Does

- Counter app for floor production counts on phone/tablet.
- Management dashboard for production totals.
- Production Grid with spreadsheet-style weekly views.
- Payroll reporting with piece-rate, minimum wage make-up pay, and overtime logic.
- Admin management for pallet types, employees, locations, shifts, and minimum wage settings.
- Count Sheets module for uploading count sheet photos.
- Live Production Board for warehouse TVs.

## Main URLs

- `/` - Main management app with Entry, Count Sheets, Production Grid, Dashboard, Payroll, and Admin tabs.
- `/counter` - Counter-only app for floor supervisors and counters.
- `/live-board` - TV production board.
- `/api/entries` - Production entry API.
- `/api/count-sheets` - Count Sheet photo API.
- `/api/pallet-types` - Pallet type API.
- `/api/settings` - Payroll/settings API.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Supabase-ready API structure
- Google Sheets API-ready integration
- Local JSON/file storage fallback for MVP testing

## Local Setup

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open the app on the Mac:

```text
http://localhost:3000
http://localhost:3000/counter
http://localhost:3000/live-board
```

For iPhone/iPad testing on the same Wi-Fi, use the Network URL shown by Next.js, for example:

```text
http://192.168.x.x:3000/counter
```

## Production Build

```bash
npm run build
npm run start
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in values when Supabase or Google Sheets is configured.

```bash
cp .env.example .env.local
```

Current MVP can run without Supabase by using local file storage.

## Local MVP Storage

When Supabase is not configured, the app uses local files:

- `data/production-entries.json`
- `data/pallet-types.json`
- `data/payroll-settings.json`
- `data/count-sheets.json`
- `public/uploads/count-sheets/`

These files can contain real production/payroll data and photos. They are intentionally excluded from the handoff zip and Git.

## Supabase Setup

SQL files are included:

- `supabase/schema.sql`
- `supabase/pallet-types-admin-migration.sql`

Recommended production migration path:

1. Create a Supabase project.
2. Run `supabase/schema.sql`.
3. Add the Supabase environment variables.
4. Move Count Sheet photos to Supabase Storage.
5. Move production entries from local JSON into Supabase tables.

## Important Business Rules

- California minimum wage default: `$16.90/hour`.
- Daily overtime after 8 hours.
- Overtime multiplier: `1.5x`.
- Piece-rate earnings compare against minimum wage requirements.
- Make-up pay is calculated when piece-rate earnings are below minimum wage requirement.

## Counter App Notes

The Counter App is intentionally separated from payroll and management screens.

Counter users should not see:

- Piece rates
- Dollar amounts
- Payroll totals
- Earnings
- Minimum wage calculations

Counter saves production entries through the same `/api/entries` source used by:

- Production Grid
- Dashboard
- Payroll
- Live Board

## Live Board Notes

The Live Board reads production entries from `/api/entries` and refreshes every 15 seconds.

Useful URLs:

```text
/live-board
/live-board?location=Fontana
/live-board?location=Citrus
/live-board?location=Mesa
/live-board?location=Fontana&shift=AM
/live-board?date=2026-06-09
```

## Files To Send To A Developer

Send the clean zip file generated from this project. It should include:

- `app/`
- `lib/`
- `supabase/`
- `public/` without uploaded production photos
- `package.json`
- `package-lock.json`
- `README.md`
- `HANDOFF.md`
- config files

Do not send:

- `node_modules/`
- `.next/`
- `.env.local`
- real `data/*.json`
- real uploaded count sheet photos

## Current Status

The app is an MVP/prototype that is ready for developer handoff. It runs locally and has working local fallback storage, with Supabase and Google Sheets integration points prepared for production hardening.
