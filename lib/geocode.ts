/**
 * Client-side geocoding aligned with SuperMap’s `/api/geocode` fallback chain:
 * Open-Meteo first, then Nominatim. (Mapbox/Geoapify require server keys.)
 *
 * Nominatim [usage policy](https://operations.osmfoundation.org/policies/nominatim/) —
 * identify the app; burst traffic should stay modest (search is user-initiated).
 */

export type GeocodeHit = {
  lat: number;
  lng: number;
  label: string;
  source: "open-meteo" | "nominatim";
};

const NOMINATIM_UA = "MM-APP/1.0 (contact: mobile map; geocoding-only)";

async function openMeteoSearch(q: string, limit: number): Promise<GeocodeHit[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", q);
  url.searchParams.set("count", String(Math.min(Math.max(limit, 1), 20)));

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: {
      name?: string;
      latitude?: number;
      longitude?: number;
      admin1?: string;
      country?: string;
    }[];
  };

  const out: GeocodeHit[] = [];
  for (const r of data.results ?? []) {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const label =
      [r.name, r.admin1, r.country].filter(Boolean).join(", ") ||
      r.name ||
      `${lat}, ${lng}`;
    out.push({ lat, lng, label, source: "open-meteo" });
    if (out.length >= limit) break;
  }
  return out;
}

async function nominatimSearch(q: string, limit: number): Promise<GeocodeHit[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 10)));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": NOMINATIM_UA,
      },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  const data = (await res.json()) as {
    lat?: string;
    lon?: string;
    display_name?: string;
    name?: string;
  }[];

  if (!Array.isArray(data)) return [];

  const out: GeocodeHit[] = [];
  for (const r of data) {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      lat,
      lng,
      label: r.display_name || r.name || `${lat}, ${lng}`,
      source: "nominatim",
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function geocodeSearch(query: string, limit = 8): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (!q) return [];

  try {
    const om = await openMeteoSearch(q, limit);
    if (om.length) return om;
  } catch {
    /* try nominatim */
  }

  try {
    return await nominatimSearch(q, limit);
  } catch {
    return [];
  }
}
