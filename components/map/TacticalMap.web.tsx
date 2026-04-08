import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { View } from "react-native";

import type {
    MapBaseLayerId,
    MapFlyToRequest,
    MapPin,
    MapPointerMode,
    MapPolygonOverlay,
    MapPolylineOverlay,
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
  onCenterChange?: (lat: number, lng: number, zoom?: number) => void;
  mapDimPercent?: number;
};

/**
 * Web map must not statically import `TacticalMapLeaflet` / `leaflet`: Leaflet touches `window` at
 * module load, which breaks Expo static SSR / prerender (`window is not defined`).
 * Load the chunk only after mount in the browser via `import()`.
 */
function TacticalMapWeb(props: Props) {
  const [Inner, setInner] = useState<ComponentType<Props> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    void import("./TacticalMapLeaflet").then((m) => {
      if (cancelled) return;
      const mod = m as {
        default?: ComponentType<Props>;
        TacticalMapLeaflet?: ComponentType<Props>;
      };
      const C = mod.default ?? mod.TacticalMapLeaflet;
      if (typeof C === "function") setInner(() => C);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const shellStyle = { flex: 1, minHeight: 0, width: "100%" as const };

  if (!Inner) {
    return <View style={shellStyle} />;
  }
  return (
    <View style={shellStyle}>
      <Inner {...props} />
    </View>
  );
}

/** Metro resolves `TacticalMap.ts(x)` to this file on web — must export this name. */
export function TacticalMap(props: Props) {
  return <TacticalMapWeb {...props} />;
}
