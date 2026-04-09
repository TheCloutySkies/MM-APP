/** MGRS grid string from WGS84 (library expects [lon, lat]). */

export function lngLatToMgrs(lat: number, lng: number, accuracy = 5): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("mgrs") as { forward: (lngLat: [number, number], acc?: number) => string };
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    return m.forward([lng, lat], accuracy);
  } catch {
    return "";
  }
}
