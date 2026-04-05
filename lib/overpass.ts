/** Preset Overpass QL queries (bbox substituted by caller). */
export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/** Public mirrors (try in order if one fails). */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;

const OVERPASS_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
  /** Some instances reject anonymous default UAs; keep a stable app id. */
  "User-Agent": "MM-APP/1.0 (https://github.com/)",
} as const;

/** Returns `application/x-www-form-urlencoded` body for Overpass interpreter. */
export function buildOverpassFormBody(
  ql: string,
  south: number,
  west: number,
  north: number,
  east: number,
): string {
  const bboxParen = `(${south},${west},${north},${east})`;
  let q = ql
    .replaceAll("__BBOX__", bboxParen)
    .replaceAll("{{BBOX}}", bboxParen)
    .replaceAll("(BBOX)", bboxParen);

  const trimmed = q.trim();
  const looksComplete =
    /\[out\s*:\s*json\]/i.test(trimmed) && /;\s*out\s*;?\s*$/i.test(trimmed);

  const inner = looksComplete ? `[timeout:40];${trimmed}` : `[out:json][timeout:40];${q}out geom;`;
  return `data=${encodeURIComponent(inner)}`;
}

/** POST to first Overpass endpoint that responds with OK (mobile fetch is flaky on some networks). */
export async function fetchOverpass(body: string): Promise<Response> {
  let lastError: unknown;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: OVERPASS_HEADERS,
        body,
      });
      if (res.ok) return res;
      lastError = new Error(`Overpass HTTP ${res.status} at ${url}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to fetch Overpass");
}

export const OVERPASS_PRESETS = {
  water: `node["natural"="water"](__BBOX__);node["natural"="spring"](__BBOX__);way["natural"="water"](__BBOX__);`,
  power: `way["power"="line"](__BBOX__);way["power"="minor_line"](__BBOX__);`,
  emergency: `node["amenity"="hospital"](__BBOX__);node["amenity"="police"](__BBOX__);node["emergency"="ambulance_station"](__BBOX__);`,
} as const;

/** Doctrine / infrastructure presets (full Overpass QL fragments). */
export const OVERPASS_C4ISR_PRESETS = {
  power_substations: `[out:json];node["power"="substation"](BBOX);out;`,
  medical: `[out:json];node["amenity"="hospital"](BBOX);out;`,
  fuel: `[out:json];node["amenity"="fuel"](BBOX);out;`,
  natural_water: `[out:json];node["waterway"="waterfall"](BBOX);out;`,
  comm_towers: `[out:json];node["man_made"="communications_tower"](BBOX);out;`,
} as const;
