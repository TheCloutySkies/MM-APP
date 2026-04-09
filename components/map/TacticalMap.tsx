import type { ComponentType } from "react";
import { Platform } from "react-native";

import type { Feature, FeatureCollection } from "geojson";

import type {
    MapBaseLayerId,
    MapFlyToRequest,
    MapPin,
    MapPointerMode,
    MapPolygonOverlay,
    MapPolylineOverlay,
    MapUserLocation,
} from "./mapTypes";
import type { GisDrawPalette, MeasurePreview } from "./gisMapTypes";

export type { MapFlyToRequest, MapPin, MapPolygonOverlay, MapPolylineOverlay };

type Props = {
  pins: MapPin[];
  polylines?: MapPolylineOverlay[];
  polygons?: MapPolygonOverlay[];
  onLongPress?: (lat: number, lng: number) => void;
  onPress?: (lat: number, lng: number) => void;
  flyTo?: MapFlyToRequest | null;
  baseLayer?: MapBaseLayerId;
  userLocation?: MapUserLocation | null;
  pointerMode?: MapPointerMode;
  /** Map center update (used for crosshair coordinate readout). */
  onCenterChange?: (lat: number, lng: number, zoom?: number) => void;
  /** 0–100: extra darken (Night Ops basemap); 0 disables. */
  mapDimPercent?: number;
  /** Pin tapped (Calcite-style intel panel); when set, Leaflet skips popup for pins. */
  onPinSelect?: (pin: MapPin) => void;
  /** Web GIS engine — Leaflet only. */
  gisFeatureCollection?: FeatureCollection | null;
  onGisFeatureSelect?: (feature: Feature) => void;
  geomanEnabled?: boolean;
  onPmCreate?: (feature: Feature) => void;
  onMouseMoveLatLng?: (lat: number, lng: number) => void;
  gisMapZoom?: number;
  measurePreview?: MeasurePreview | null;
  gisPalette?: Partial<GisDrawPalette>;
};

/**
 * IDE/tsconfig entry for `import "@/components/map/TacticalMap"`.
 *
 * Do **not** use `import TacticalMapWeb from "./TacticalMap.web"` here — Metro turns that into an
 * async chunk (`TacticalMap.web.bundle`) and web dev often hits “Failed to fetch”. CommonJS
 * `require()` keeps the platform implementation in the same graph.
 */
const TacticalMapImpl: ComponentType<Props> =
  Platform.OS === "web"
    ? // Metro: synchronous resolution; avoids lazy `asyncRequire` for `.web`.
      (require("./TacticalMap.web") as typeof import("./TacticalMap.web")).TacticalMap
    : (require("./TacticalMap.native") as typeof import("./TacticalMap.native")).TacticalMap;

export function TacticalMap(props: Props) {
  return <TacticalMapImpl {...props} />;
}
