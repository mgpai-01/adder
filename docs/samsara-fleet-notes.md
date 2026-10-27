# Samsara fleet map — setup notes

Dashboard → Samsara button → live map of trucks, trailers and yards, with a
Traffic layer and full-screen Expand. Code: components/FleetMap.tsx,
lib/samsara.ts, app/api/samsara/fleet and app/api/samsara/traffic.

## Who sees it
lib/previewAccess.ts decides, on the server:
- Live app (Vercel Production): only the listed logins (mgpai@palletmail.com).
- Test deployments (Vercel Preview): everyone who can sign in, so a test link
  can be shared for feedback. They still need an MGP login (and Vercel access
  if Deployment Protection is on). Test deployments use the live database.
The Dashboard asks /api/samsara/access before showing the button, and every
Samsara route checks the same rule. Open it to everyone on the live app by
adding emails there, or by changing canSeeSamsaraPreview.

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
