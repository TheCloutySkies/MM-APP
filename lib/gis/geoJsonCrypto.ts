import type { FeatureCollection } from "geojson";

import { decryptUtf8, encryptUtf8 } from "@/lib/crypto/aesGcm";

const GIS_FC_AAD = "mm-gis-featurecollection-v1";

export function encryptFeatureCollectionJson(
  fc: FeatureCollection,
  mapKey32: Uint8Array,
): string {
  return encryptUtf8(mapKey32, JSON.stringify(fc), GIS_FC_AAD);
}

export function decryptFeatureCollectionJson(
  ciphertext: string,
  mapKey32: Uint8Array,
): FeatureCollection {
  const json = decryptUtf8(mapKey32, ciphertext, GIS_FC_AAD);
  return JSON.parse(json) as FeatureCollection;
}
