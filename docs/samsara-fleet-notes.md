# Samsara fleet map — setup notes

Fleet tab (top menu) → live map of trucks, trailers and yards, with a
Traffic layer and full-screen Expand. Code: components/FleetMap.tsx,
lib/samsara.ts, app/api/samsara/fleet and app/api/samsara/traffic.

## Who sees it
lib/previewAccess.ts decides, on the server: admins and managers (SAMSARA_ROLES:
admin, supervisor), on
the live app and test deployments alike, plus any email listed in
SAMSARA_EXTRA_EMAILS. Test deployments use the live database and the same
logins, so the rule is the same in both. The app asks /api/samsara/access
before showing the Fleet tab, and every Samsara route checks the same rule.

## Vercel environment variables (Production + Preview)
- `SAMSARA_API_TOKEN` — Samsara → Settings → Developer → API Tokens.
  Read-only scopes: Vehicles (all Read), Assets (Read), Trailers (Read,
  including Read Trailer Statistics), plus Samsara's auto-selected ones.
- `TOMTOM_API_KEY` — my.tomtom.com → Keys ("My First API key"; includes the
  Traffic API). It never reaches the browser: traffic tiles load through
  app/api/samsara/traffic/tile with a signed 6-hour pass from
  app/api/samsara/traffic (lib/trafficToken.ts).
A saved variable only reaches deployments built after it — redeploy.

## Samsara calls (api.samsara.com)
- Trucks: `GET /fleet/vehicles/stats?types=gps`
- Trailers: `GET /fleet/trailers/stats?types=gps` (falls back to `/beta/...`)
- Everything else: `GET /assets/location-and-speed/stream` (last 72 h), then
  `/v1/fleet/assets/locations`, then `/fleet/equipment/locations`.
- Names: `GET /fleet/trailers`, `GET /fleet/equipment`.
Samsara files many trailers as generic assets, so lib/samsara.ts sorts by
name: trailer words / "TR" / a length → Trailers (size read from the name),
"Yard" → Yards.

## Map tiles
OpenStreetMap tiles (no key; dark mode recolors them in CSS). Traffic is
TomTom's flow tiles (`relative0` / `relative0-dark`) drawn on top.

## Usage limits (lib/rateLimit.ts)
Per user, per server instance: 40 ETA checks and 3,000 traffic tiles per
10 minutes. A brake on runaway use (each ETA is ~5 paid TomTom lookups), not
an exact quota.

## Yard alert (header bell)
Admins and managers (everyone who can see Fleet) get a bell next to EN/ES. It watches the production
yards (lib/yards `production: true`: Sultana, Merrill, Citrus) and turns red
when one has had no trailers parked for 30 minutes (lib/yardWatch). "Since
when" is kept in the `fleet_yard_watch` table — run
supabase/fleet-yard-watch-migration.sql once; until then the server's memory
is used. It updates on each fresh Samsara pull (lib/fleetCache): once a
minute from a Supabase scheduled job calling /api/samsara/yard-watch
(supabase/fleet-yard-watch-schedule.sql — pg_cron + pg_net), so it runs with
nobody on the site, and also whenever an admin has the app open.
