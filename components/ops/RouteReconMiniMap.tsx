import * as Location from "expo-location";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { TacticalMap } from "@/components/map/TacticalMap";
import type { MapFlyToRequest, MapPin } from "@/components/map/mapTypes";
import { lngLatToMgrs } from "@/lib/geo/mgrsFormat";
import type { RouteReconMarkerKind, RouteReconMarkerV1 } from "@/lib/opsReports";

type Props = {
  markers: RouteReconMarkerV1[];
  dropKind: RouteReconMarkerKind;
  onAddMarker: (m: RouteReconMarkerV1) => void;
  onSelectMarkerId: (id: string | null) => void;
  scheme: "light" | "dark";
};

function kindTint(kind: RouteReconMarkerKind): string {
  if (kind === "bridge") return "#3b82f6";
  if (kind === "choke") return "#f97316";
  return "#22c55e";
}

export function RouteReconMiniMap({ markers, dropKind, onAddMarker, onSelectMarkerId, scheme }: Props) {
  const { width: winW } = useWindowDimensions();
  const mapHeight = winW < 520 ? 220 : 260;
  const [flyTo, setFlyTo] = useState<MapFlyToRequest | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted" || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        setFlyTo({ lat: pos.coords.latitude, lng: pos.coords.longitude, zoom: 12, seq: Date.now() });
      } catch {
        /* map default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pins: MapPin[] = useMemo(
    () =>
      markers.map((m) => ({
        id: m.id,
        lat: m.lat,
        lng: m.lng,
        title:
          m.kind === "bridge" ? "Bridge" : m.kind === "choke" ? "Hazard / choke" : `Comm (${m.signalStrength})`,
        subtitle: m.mgrs?.trim() || undefined,
        tint: m.kind === "bridge" ? "#3b82f6" : m.kind === "choke" ? "#f97316" : "#22c55e",
      })),
    [markers],
  );

  const border = scheme === "dark" ? "#3f3f46" : "#d4d4d8";

  return (
    <View style={[styles.wrap, { borderColor: border }]}>
      <View style={[styles.hintRow, winW < 560 ? styles.hintRowStack : null]}>
        <Text style={[styles.hint, { color: scheme === "dark" ? "#a1a1aa" : "#52525b" }]}>
          Tap the map to drop a <Text style={{ fontWeight: "900" }}>{dropKind === "comm_zone" ? "comm zone" : dropKind}</Text>{" "}
          marker. Tap a pin to select it for editing.
        </Text>
        <Pressable
          onPress={() => {
            void (async () => {
              try {
                const perm = await Location.requestForegroundPermissionsAsync();
                if (perm.status !== "granted") return;
                const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                setFlyTo({ lat: pos.coords.latitude, lng: pos.coords.longitude, zoom: 14, seq: Date.now() });
              } catch {
                /* ignore */
              }
            })();
          }}
          style={[styles.recenter, { borderColor: kindTint(dropKind) }]}>
          <Text style={{ color: kindTint(dropKind), fontWeight: "800", fontSize: 12 }}>GPS</Text>
        </Pressable>
      </View>
      <View style={[styles.mapBox, { height: mapHeight }]}>
        <TacticalMap
          pins={pins}
          flyTo={flyTo}
          baseLayer="topo"
          pointerMode="crosshair"
          onPress={(lat, lng) => {
            const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const mgrs = lngLatToMgrs(lat, lng, 5);
            if (dropKind === "bridge") {
              onAddMarker({
                kind: "bridge",
                id,
                lat,
                lng,
                mgrs: mgrs || undefined,
                weightLimit: "",
                heightClearance: "",
                notes: "",
              });
            } else if (dropKind === "choke") {
              onAddMarker({ kind: "choke", id, lat, lng, mgrs: mgrs || undefined, description: "" });
            } else {
              onAddMarker({
                kind: "comm_zone",
                id,
                lat,
                lng,
                mgrs: mgrs || undefined,
                signalStrength: "good",
                notes: "",
              });
            }
            onSelectMarkerId(id);
          }}
          onPinSelect={(pin) => onSelectMarkerId(pin.id)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 14, overflow: "hidden", marginBottom: 12 },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 8 },
  hintRowStack: { flexDirection: "column", alignItems: "stretch" },
  hint: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17 },
  recenter: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 2, alignSelf: "flex-start" },
  mapBox: { width: "100%", minHeight: 200 },
});
