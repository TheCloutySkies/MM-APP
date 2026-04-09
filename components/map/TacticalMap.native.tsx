import { useEffect, useRef } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, {
    MAP_TYPES,
    Marker,
    Polygon,
    Polyline,
    PROVIDER_DEFAULT,
    UrlTile,
} from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type {
    MapBaseLayerId,
    MapFlyToRequest,
    MapPin,
    MapPointerMode,
    MapPolygonOverlay,
    MapPolylineOverlay,
    MapUserLocation,
} from "./mapTypes";

export type { MapFlyToRequest, MapPin };

/** Standard OSM raster tiles ({@link https://wiki.openstreetmap.org/wiki/Raster_tile_providers}). */
export const OSM_TILE_URL_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
/** Dark OSM basemap (CartoDB Dark Matter). */
export const OSM_DARK_TILE_TEMPLATE = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
/** Topographic basemap (OpenTopoMap). */
export const OPENTOPOMAP_TILE_TEMPLATE = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";

/** Esri World Imagery (subject to Esri / ArcGIS terms of use). */
export const ESRI_SATELLITE_TILE_TEMPLATE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/** Esri reference labels on top of imagery (hybrid / “Bing-style” stack). */
export const ESRI_REFERENCE_LABELS_TILE_TEMPLATE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

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
  onPinSelect?: (pin: MapPin) => void;
};

function zoomToDeltas(lat: number, zoom: number) {
  const z = Math.max(2, Math.min(18, zoom));
  const scale = Math.pow(2, 10 - z);
  const latitudeDelta = Math.max(0.004, 0.06 * scale);
  const cos = Math.cos((lat * Math.PI) / 180) || 1;
  const longitudeDelta = Math.max(0.004, latitudeDelta / cos);
  return { latitudeDelta, longitudeDelta };
}

export function TacticalMap({
  pins,
  polylines = [],
  polygons = [],
  onLongPress,
  onPress,
  flyTo,
  baseLayer = "osm",
  userLocation,
  pointerMode: _pointerMode = "default",
  onCenterChange,
  mapDimPercent = 0,
  onPinSelect,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  /**
   * Android: `NONE` shows only custom tiles.
   * iOS: `MUTEDSTANDARD` still draws an opaque basemap; `UrlTile` with zIndex &lt; 0 renders *under* that layer,
   * which looks like a “broken” map. Use `NONE` on iOS too so raster tiles are actually visible.
   */
  const baseMapType = MAP_TYPES.NONE;

  useEffect(() => {
    if (flyTo == null) return;
    const z = flyTo.zoom ?? 10;
    const { latitudeDelta, longitudeDelta } = zoomToDeltas(flyTo.lat, z);
    mapRef.current?.animateToRegion(
      {
        latitude: flyTo.lat,
        longitude: flyTo.lng,
        latitudeDelta,
        longitudeDelta,
      },
      900,
    );
  }, [flyTo?.seq]);

  const showCallout = (title: string, subtitle?: string) => {
    const s = subtitle?.trim();
    if (s) Alert.alert(title, s);
    else Alert.alert(title);
  };

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        style={styles.fill}
        provider={PROVIDER_DEFAULT}
        mapType={baseMapType}
        initialRegion={{
          latitude: 39.5,
          longitude: -120.2,
          latitudeDelta: 2,
          longitudeDelta: 2,
        }}
        onPress={(e) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          onPress?.(latitude, longitude);
        }}
        onLongPress={(e) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          onLongPress?.(latitude, longitude);
        }}
        onRegionChangeComplete={(r) => {
          onCenterChange?.(r.latitude, r.longitude);
        }}>
        <UrlTile
          flipY={false}
          maximumZ={19}
          minimumZ={0}
          tileSize={256}
          urlTemplate={
            baseLayer === "satellite" || baseLayer === "hybrid"
              ? ESRI_SATELLITE_TILE_TEMPLATE
              : baseLayer === "topo"
                ? OPENTOPOMAP_TILE_TEMPLATE
                : baseLayer === "osm_dark"
                  ? OSM_DARK_TILE_TEMPLATE
                  : OSM_TILE_URL_TEMPLATE
          }
          {...(baseLayer === "osm_dark" || baseLayer === "topo"
            ? { tileCacheMaxAge: 60 * 60 * 24 }
            : {})}
          zIndex={100}
        />
        {baseLayer === "hybrid" ? (
          <UrlTile
            flipY={false}
            maximumZ={19}
            minimumZ={0}
            tileSize={256}
            urlTemplate={ESRI_REFERENCE_LABELS_TILE_TEMPLATE}
            zIndex={110}
          />
        ) : null}
        {polygons.map((poly) => (
          <Polygon
            key={poly.id}
            coordinates={poly.coordinates}
            strokeColor={poly.strokeColor}
            fillColor={poly.fillColor}
            strokeWidth={2}
            tappable
            onPress={() => showCallout(poly.title, poly.subtitle)}
          />
        ))}
        {polylines.map((line) => (
          <Polyline
            key={line.id}
            coordinates={line.coordinates}
            strokeColor={line.color}
            strokeWidth={4}
            {...(line.lineDash
              ? {
                  lineDashPattern: line.lineDash
                    .split(/\s+/)
                    .map(Number)
                    .filter((n) => !Number.isNaN(n)),
                }
              : {})}
            tappable
            onPress={() => showCallout(line.title, line.subtitle)}
          />
        ))}
        {userLocation ? (
          <Marker
            coordinate={{ latitude: userLocation.lat, longitude: userLocation.lng }}
            title="You"
            description="Live position"
            pinColor="#1e88e5"
          />
        ) : null}
        {pins.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            title={p.title}
            description={p.subtitle}
            pinColor={p.tint}
            onPress={() => onPinSelect?.(p)}
          />
        ))}
      </MapView>
      {mapDimPercent > 0 ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: `rgba(0,0,0,${Math.max(0, Math.min(100, mapDimPercent)) / 100 * 0.72})`,
            },
          ]}
        />
      ) : null}
      {userLocation ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom to current location"
          onPress={() => {
            const z = 15;
            const { latitudeDelta, longitudeDelta } = zoomToDeltas(userLocation.lat, z);
            mapRef.current?.animateToRegion(
              {
                latitude: userLocation.lat,
                longitude: userLocation.lng,
                latitudeDelta,
                longitudeDelta,
              },
              650,
            );
          }}
          style={[
            styles.locateFab,
            {
              bottom: 88 + Math.max(insets.bottom, 8),
            },
          ]}>
          <Text style={styles.locateFabIcon}>⌖</Text>
        </Pressable>
      ) : null}
      <View style={styles.attribution} pointerEvents="none">
        <Text style={styles.attributionText}>© OpenStreetMap contributors</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  /** Mirrors web Leaflet stack: locate above bottom-right chrome (approx. zoom / map controls). */
  locateFab: {
    position: "absolute",
    right: 12,
    width: 34,
    height: 34,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.22)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
    elevation: 6,
  },
  locateFabIcon: {
    fontSize: 18,
    color: "#333",
    lineHeight: 20,
  },
  attribution: {
    position: "absolute",
    right: 6,
    bottom: 4,
    left: 6,
    alignItems: "flex-end",
  },
  attributionText: {
    fontSize: 10,
    color: "rgba(255,255,255,0.85)",
    textShadowColor: "rgba(0,0,0,0.75)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
});
