/**
 * Portable OSINT fetchers adapted from SuperMap layerServices (public APIs only).
 * Optional EXPO_PUBLIC_SUPERMAP_API_URL proxies paid/backend routes later.
 */

import type { MapPin, MapPolylineOverlay } from "@/components/map/mapTypes";
import { getSupermapApiUrl } from "@/lib/env";
import { buildOverpassFormBody, fetchOverpass } from "@/lib/overpass";

/** [west, south, east, north] */
export type GeoBBox = [number, number, number, number];

export function bboxAroundPoint(lat: number, lng: number, padDeg = 0.35): GeoBBox {
  return [lng - padDeg, lat - padDeg, lng + padDeg, lat + padDeg];
}

const POWER_PRESET = `
(
  way["power"~"line|cable"](__BBOX__);
  node["power"~"substation|plant"](__BBOX__);
);
`;

/** NASA FIRMS public map key (same as SuperMap upstream). */
const FIRMS_MAP_KEY = "09415b5df0304c3802335984b511c111";

type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
};

export type PowerLayerResult = {
  pins: MapPin[];
  polylines: MapPolylineOverlay[];
};

export async function fetchPowerInfrastructure(bbox: GeoBBox): Promise<PowerLayerResult> {
  const [w, s, e, n] = bbox;
  const body = buildOverpassFormBody(POWER_PRESET, s, w, n, e);
  const res = await fetchOverpass(body);
  const json = (await res.json()) as { elements?: OsmElement[] };
  const pins: MapPin[] = [];
  const polylines: MapPolylineOverlay[] = [];
  const lineTint = "#5a7d4e";
  const pointTint = "#6b8e5c";

  for (const el of json.elements ?? []) {
    if (el.type === "way" && el.geometry?.length) {
      const coords = el.geometry.map((p) => ({ latitude: p.lat, longitude: p.lon }));
      if (coords.length < 2) continue;
      polylines.push({
        id: `pwr-way-${el.id}`,
        coordinates: coords,
        color: lineTint,
        title: el.tags?.name ?? "Power line",
        lineDash: "6 4",
      });
    } else if (el.type === "node" && el.lat != null && el.lon != null) {
      const raw = (el.tags?.power ?? "substation").toLowerCase();
      const label = /plant|generator/.test(raw) ? "Power plant" : "Substation";
      pins.push({
        id: `pwr-node-${el.id}`,
        lat: el.lat,
        lng: el.lon,
        title: el.tags?.name ?? label,
        tint: pointTint,
      });
    }
  }

  return { pins, polylines };
}

export async function fetchUsgsEarthquakes(bbox: GeoBBox): Promise<MapPin[]> {
  const api = getSupermapApiUrl();
  if (api) {
    try {
      const bboxStr = bbox.join(",");
      const res = await fetch(`${api.replace(/\/$/, "")}/api/earthquakes?bbox=${encodeURIComponent(bboxStr)}`);
      if (res.ok) {
        const fc = (await res.json()) as GeoJSON.FeatureCollection;
        return geojsonPointsToPins(fc, "usgs", "#c45c4a");
      }
    } catch {
      /* fall through */
    }
  }
  const [w, s, e, n] = bbox;
  let url =
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time-asc";
  url += `&minlatitude=${s}&maxlatitude=${n}&minlongitude=${w}&maxlongitude=${e}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const fc = (await res.json()) as GeoJSON.FeatureCollection;
  return geojsonPointsToPins(fc, "usgs", "#c45c4a");
}

export async function fetchNasaFirmsHotspots(bbox: GeoBBox): Promise<MapPin[]> {
  const [w, s, e, n] = bbox;
  const area = `${w},${s},${e},${n}`;
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/VIIRS_NOAA20_NRT/${area}/1`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  const latIdx = headers.indexOf("latitude");
  const lonIdx = headers.indexOf("longitude");
  if (latIdx === -1 || lonIdx === -1) return [];
  const pins: MapPin[] = [];
  let i = 0;
  for (const line of lines.slice(1)) {
    const vals = line.split(",");
    const lat = parseFloat(vals[latIdx]);
    const lon = parseFloat(vals[lonIdx]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    pins.push({
      id: `firms-${i++}`,
      lat,
      lng: lon,
      title: "Heat hotspot",
      tint: "#8b7355",
    });
  }
  return pins;
}

function geojsonPointsToPins(fc: GeoJSON.FeatureCollection, prefix: string, tint: string): MapPin[] {
  const out: MapPin[] = [];
  let i = 0;
  for (const f of fc.features ?? []) {
    const geom = f.geometry as GeoJSON.Point | undefined;
    if (!geom || geom.type !== "Point") continue;
    const [lng, lat] = geom.coordinates;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const mag = props.mag ?? props.magnitude;
    const title =
      typeof mag === "number" || typeof mag === "string"
        ? `EQ M${mag}`
        : (props.title as string) || "Earthquake";
    out.push({
      id: `${prefix}-${i++}`,
      lat,
      lng,
      title,
      subtitle: props.place as string | undefined,
      tint,
    });
  }
  return out;
}
