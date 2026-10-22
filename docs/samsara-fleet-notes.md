# Samsara fleet map — setup notes

Dashboard → Samsara button → live map of trucks, trailers and yards, with a
Traffic layer and full-screen Expand. Code: components/FleetMap.tsx,
lib/samsara.ts, app/api/samsara/fleet and app/api/samsara/traffic.

## Preview lock
Only the logins in lib/previewAccess.ts (currently mgpai@palletmail.com) see
the button, and both API routes check the caller's email on the server.
Remove the lock there when it's ready for everyone.

## Vercel environment variables (Production + Preview)
- `SAMSARA_API_TOKEN` — Samsara → Settings → Developer → API Tokens.
  Read-only scopes: Vehicles (all Read), Assets (Read), Trailers (Read,
  including Read Trailer Statistics), plus Samsara's auto-selected ones.
- `TOMTOM_API_KEY` — my.tomtom.com → Keys ("My First API key"; includes the
  Traffic API). Optional: turn on the key's domain whitelist for the app's
  Vercel domains.
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
