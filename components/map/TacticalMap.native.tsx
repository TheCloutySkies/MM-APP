import { useEffect, useRef } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import MapView, {
    MAP_TYPES,
    Marker,
    Polygon,
    Polyline,
    PROVIDER_DEFAULT,
    UrlTile,
} from "react-native-maps";

import type {
  MapBaseLayerId,
  MapFlyToRequest,
  MapPin,
  MapPolygonOverlay,
  MapPolylineOverlay,
  MapPointerMode,
  MapUserLocation,
} from "./mapTypes";

export type { MapFlyToRequest, MapPin };

/** Standard OSM raster tiles ({@link https://wiki.openstreetmap.org/wiki/Raster_tile_providers}). */
export const OSM_TILE_URL_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Esri World Imagery (subject to Esri / ArcGIS terms of use). */
export const ESRI_SATELLITE_TILE_TEMPLATE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

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
}: Props) {
  const mapRef = useRef<MapView>(null);
  const baseMapType =
    Platform.OS === "android" ? MAP_TYPES.NONE : MAP_TYPES.MUTEDSTANDARD;

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
        }}>
        <UrlTile
          flipY={false}
          maximumZ={19}
          minimumZ={0}
          tileSize={256}
          urlTemplate={baseLayer === "satellite" ? ESRI_SATELLITE_TILE_TEMPLATE : OSM_TILE_URL_TEMPLATE}
          zIndex={-1}
        />
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
          />
        ))}
      </MapView>
      <View style={styles.attribution} pointerEvents="none">
        <Text style={styles.attributionText}>© OpenStreetMap contributors</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
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
