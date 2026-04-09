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
