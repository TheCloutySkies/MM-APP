import { getMmGeoProxyUrl } from "@/lib/env";

export type OpenMeteoCurrent = {
  temperature_2m?: number;
  wind_speed_10m?: number;
  weather_code?: number;
};

function buildUrl(lat: number, lng: number): string {
  const q = `latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(String(lng))}&current=temperature_2m,wind_speed_10m,weather_code`;
  const proxy = getMmGeoProxyUrl();
  if (proxy) {
    return `${proxy.replace(/\/$/, "")}/forecast?${q}`;
  }
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** Minimal current conditions via Open-Meteo (free, no API key). */
export async function fetchOpenMeteoCurrent(lat: number, lng: number): Promise<{
  current: OpenMeteoCurrent;
  raw?: unknown;
}> {
  const url = buildUrl(lat, lng);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
  const json = (await res.json()) as { current?: OpenMeteoCurrent };
  if (!json.current) throw new Error("Weather response missing current");
  return { current: json.current, raw: json };
}
