/** Single radius entry in the buffer / measure UI — converted to km for Turf. */
export type GisDistanceUnit = "km" | "m" | "mi" | "yd";

export const BUFFER_RANGE: Record<GisDistanceUnit, { min: number; max: number; step: number }> = {
  km: { min: 0.05, max: 50, step: 0.05 },
  m: { min: 10, max: 500_000, step: 10 },
  mi: { min: 0.03, max: 31, step: 0.01 },
  yd: { min: 50, max: 50_000, step: 10 },
};

/** Convert a length in `unit` to kilometers (for turf.buffer etc.). */
export function toKilometers(amount: number, unit: GisDistanceUnit): number {
  switch (unit) {
    case "km":
      return amount;
    case "m":
      return amount / 1000;
    case "mi":
      return amount * 1.609344;
    case "yd":
      return amount * 0.0009144;
    default:
      return amount;
  }
}

/** Format geodesic distance from km into a readable string for the active unit family. */
export function formatDistanceFromKm(km: number, mode: "metric" | "imperial"): string {
  if (!Number.isFinite(km) || km < 0) return "—";
  if (mode === "metric") {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(3)} km`;
  }
  const mi = km / 1.609344;
  if (mi < 0.25) return `${Math.round(km * 1093.61)} yd`;
  return `${mi.toFixed(3)} mi`;
}

/** Convert radius in current unit to Turf kilometers, clamped to a sane minimum. */
export function bufferAmountToKm(amount: number, unit: GisDistanceUnit): number {
  const km = toKilometers(amount, unit);
  return Math.max(0.00005, km);
}

export function convertAmountBetweenUnits(amount: number, from: GisDistanceUnit, to: GisDistanceUnit): number {
  const km = toKilometers(amount, from);
  switch (to) {
    case "km":
      return km;
    case "m":
      return km * 1000;
    case "mi":
      return km / 1.609344;
    case "yd":
      return km / 0.0009144;
    default:
      return amount;
  }
}
