import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";

/** Turf buffer around WGS84 point; radius in kilometers. */
export function bufferPointKm(lat: number, lng: number, radiusKm: number): Feature<Polygon> {
  const pt = turf.point([lng, lat]);
  return turf.buffer(pt, radiusKm, { units: "kilometers" }) as Feature<Polygon>;
}

/** Geodesic length of a LineString in miles (for ETA from mph). */
export function lineLengthMiles(line: Feature<LineString>): number {
  return turf.length(line, { units: "miles" });
}

/** Distance between two WGS84 points in kilometers. */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return turf.distance(turf.point([lng1, lat1]), turf.point([lng2, lat2]), { units: "kilometers" });
}

export function emptyFeatureCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
