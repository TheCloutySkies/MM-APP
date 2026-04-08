import type { ComponentType } from "react";
import { Platform } from "react-native";

import type {
  MapBaseLayerId,
  MapFlyToRequest,
  MapPin,
  MapPolygonOverlay,
  MapPolylineOverlay,
  MapPointerMode,
  MapUserLocation,
} from "./mapTypes";

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
