import type { Feature, FeatureCollection } from "geojson";

import type { MapPin } from "@/components/map/mapTypes";

export type ActiveMapTool = "navigate" | "buffer" | "measure" | "draw" | "mil_symbol";

export type MapSelection =
  | { kind: "pin"; pin: MapPin }
  | { kind: "gis"; feature: Feature }
  | null;

/** Ensures GeoJSON Feature has id in properties for UI + Intel links. */
export function ensureFeatureId(f: Feature): Feature {
  const props = { ...((f.properties as Record<string, unknown>) ?? {}) };
  if (typeof props.mmId !== "string" || !props.mmId) {
    props.mmId =
      typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto
        ? globalThis.crypto.randomUUID()
        : `mm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
  return { ...f, properties: props };
}

export function appendFeature(fc: FeatureCollection, f: Feature): FeatureCollection {
  const feature = ensureFeatureId(f);
  return {
    ...fc,
    features: [...fc.features, feature],
  };
}

/** Replace a feature with the same `properties.mmId` (or append if missing). */
export function upsertFeatureInCollection(fc: FeatureCollection, next: Feature): FeatureCollection {
  const mmId = String((next.properties as Record<string, unknown>)?.mmId ?? "");
  const fixed = ensureFeatureId(next);
  if (!mmId) {
    return { ...fc, features: [...fc.features, fixed] };
  }
  const i = fc.features.findIndex((f) => String((f.properties as Record<string, unknown>)?.mmId) === mmId);
  if (i === -1) {
    return { ...fc, features: [...fc.features, fixed] };
  }
  const features = fc.features.slice();
  features[i] = fixed;
  return { ...fc, features };
}
