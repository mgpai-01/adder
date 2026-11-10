import { allowCall } from "@/lib/rateLimit";
import { checkTrafficToken } from "@/lib/trafficToken";

export const dynamic = "force-dynamic";

// One live-traffic map tile, fetched from TomTom on the browser's behalf so
// the TomTom key never reaches it. GET /api/samsara/traffic/tile/<source>/<z>/<x>/<y>?t=<pass>&theme=light|dark
// The pass comes from /api/samsara/traffic (signed in + allowed to see Fleet).
//
// TomTom serves traffic images from three generations of its API; which one a
// key can use depends on the account, so the map tries them in order.

const TOMTOM = "https://api.tomtom.com";

function upstream(source: number, z: number, x: number, y: number, dark: boolean, key: string): string | null {
  const k = encodeURIComponent(key);
  const theme = dark ? "dark" : "light";
  if (source === 0) return `${TOMTOM}/traffic/map/4/tile/flow/${dark ? "relative0-dark" : "relative0"}/${z}/${x}/${y}.png?key=${k}&thickness=8`;
  if (source === 1) return `${TOMTOM}/maps/orbis/traffic/flow/raster/tile/${z}/${x}/${y}?apiVersion=2&key=${k}&style=${theme}`;
  if (source === 2) return `${TOMTOM}/maps/orbis/traffic/tile/flow/${z}/${x}/${y}.png?apiVersion=1&key=${k}&style=${theme}`;
  return null;
}

const whole = (value: string) => (/^\d{1,7}$/.test(value) ? Number(value) : NaN);

export async function GET(request: Request, context: { params: Promise<{ source: string; z: string; x: string; y: string }> }) {
  const url = new URL(request.url);
  const userId = checkTrafficToken(url.searchParams.get("t") ?? "");
  if (!userId) return new Response("Traffic pass expired — reload the page", { status: 401 });

  const params = await context.params;
  const [source, z, x, y] = [whole(params.source), whole(params.z), whole(params.x), whole(params.y)];
  // Zoom 0–22; x and y must exist at that zoom.
  if (![source, z, x, y].every(Number.isFinite) || z > 22 || x >= 2 ** z || y >= 2 ** z) {
    return new Response("Bad tile", { status: 400 });
  }
  const key = process.env.TOMTOM_API_KEY ?? "";
  const target = key ? upstream(source, z, x, y, url.searchParams.get("theme") === "dark", key) : null;
  if (!target) return new Response("Traffic not available", { status: 404 });

  // Generous for normal panning; stops a runaway script from running up the TomTom bill.
  if (!allowCall(`tiles:${userId}`, 3000, 10 * 60 * 1000)) return new Response("Too many traffic requests — try again in a few minutes", { status: 429 });

  const response = await fetch(target, { cache: "no-store" }).catch(() => null);
  if (!response || !response.ok) return new Response("Traffic tile unavailable", { status: response?.status === 403 ? 403 : 502 });
  return new Response(await response.arrayBuffer(), {
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "image/png",
      // Traffic changes by the minute; let this browser reuse a tile briefly.
      "Cache-Control": "private, max-age=60"
    }
  });
}
