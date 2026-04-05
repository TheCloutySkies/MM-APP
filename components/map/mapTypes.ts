export type MapLatLng = {
  latitude: number;
  longitude: number;
};

export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  /** Shown under title (callout / popup) — e.g. creator, notes. */
  subtitle?: string;
  tint: string;
};

export type MapPolylineOverlay = {
  id: string;
  coordinates: MapLatLng[];
  color: string;
  title: string;
  subtitle?: string;
  /** Leaflet dash pattern e.g. `"8 6"` for draft lines */
  lineDash?: string;
};

export type MapPolygonOverlay = {
  id: string;
  coordinates: MapLatLng[];
  strokeColor: string;
  fillColor: string;
  title: string;
  subtitle?: string;
};

/** Increment `seq` on each navigation so the map animates even when coordinates repeat. */
export type MapFlyToRequest = {
  lat: number;
  lng: number;
  zoom?: number;
  seq: number;
};

export type MapBaseLayerId = "osm" | "satellite";

/** `crosshair` while placing routes / pins; map uses grab when panning (web Leaflet default). */
export type MapPointerMode = "default" | "crosshair";

export type MapUserLocation = { lat: number; lng: number };
