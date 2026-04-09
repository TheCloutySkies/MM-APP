import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { lngLatToMgrs } from "@/lib/geo/mgrsFormat";
import { encryptUtf8 } from "@/lib/crypto/aesGcm";
import { OPS_AAD, type RouteReconMarkerKind, type RouteReconMarkerV1, type RouteReconPayloadV1 } from "@/lib/opsReports";
import { useMMStore } from "@/store/mmStore";
import type { SupabaseClient } from "@supabase/supabase-js";

import { TacticalSandTableModal } from "@/components/sand-table/TacticalSandTableModal";

import { RouteReconMiniMap } from "./RouteReconMiniMap";

type Props = {
  visible: boolean;
  onClose: () => void;
  scheme: "light" | "dark";
  supabase: SupabaseClient | null;
  profileId: string | null;
  username: string | null;
  mapKey: Uint8Array | null;
  onSaved: () => void;
  operationId?: string | null;
};

function updateMarkers(list: RouteReconMarkerV1[], id: string, next: RouteReconMarkerV1): RouteReconMarkerV1[] {
  return list.map((m) => (m.id === id ? next : m));
}

export function RouteReconModal({
  visible,
  onClose,
  scheme,
  supabase,
  profileId,
  username,
  mapKey,
  onSaved,
  operationId = null,
}: Props) {
  const router = useRouter();
  const setMgrsPickHandler = useMMStore((s) => s.setMgrsPickHandler);
  const p = Colors[scheme];
  const { width: winW } = useWindowDimensions();
  const rowLayout = winW >= 760;

  const [routeName, setRouteName] = useState("");
  const [startMgrs, setStartMgrs] = useState("");
  const [endMgrs, setEndMgrs] = useState("");
  const [markers, setMarkers] = useState<RouteReconMarkerV1[]>([]);
  const [dropKind, setDropKind] = useState<RouteReconMarkerKind>("bridge");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSandTable, setShowSandTable] = useState(false);
  const [sandTableGeoJsonCipher, setSandTableGeoJsonCipher] = useState<string | null>(null);
  const [sandTablePngCipher, setSandTablePngCipher] = useState<string | null>(null);

  const selected = useMemo(() => markers.find((m) => m.id === selectedId) ?? null, [markers, selectedId]);

  const inputStyle = [
    styles.input,
    {
      color: p.text,
      borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
      backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
    },
  ];

  const fillStartGps = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Route recon", "Location permission required.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const g = lngLatToMgrs(pos.coords.latitude, pos.coords.longitude, 5);
      if (g) setStartMgrs(g);
    } catch (e) {
      Alert.alert("Route recon", e instanceof Error ? e.message : "GPS failed");
    }
  };

  const fillEndGps = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Route recon", "Location permission required.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const g = lngLatToMgrs(pos.coords.latitude, pos.coords.longitude, 5);
      if (g) setEndMgrs(g);
    } catch (e) {
      Alert.alert("Route recon", e instanceof Error ? e.message : "GPS failed");
    }
  };

  const refineStartMap = () => {
    setMgrsPickHandler((grid) => {
      setStartMgrs(grid);
      setMgrsPickHandler(null);
    });
    router.push("/(app)/map");
  };

  const refineEndMap = () => {
    setMgrsPickHandler((grid) => {
      setEndMgrs(grid);
      setMgrsPickHandler(null);
    });
    router.push("/(app)/map");
  };

  const save = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("Route recon", "Operations encryption key not available.");
      return;
    }
    if (!routeName.trim() || !startMgrs.trim() || !endMgrs.trim()) {
      Alert.alert("Route recon", "Route name, start MGRS, and end MGRS are required.");
      return;
    }
    setBusy(true);
    try {
      const preparedBy = username?.trim() || "unknown";
      const payload: RouteReconPayloadV1 = {
        v: 1,
        kind: "route_recon",
        routeName: routeName.trim(),
        startMgrs: startMgrs.trim(),
        endMgrs: endMgrs.trim(),
        markers,
        createdAt: Date.now(),
        ...(sandTableGeoJsonCipher ? { sandTableGeoJsonCipher } : {}),
        ...(sandTablePngCipher ? { sandTablePngCipher } : {}),
      };
      const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), OPS_AAD.route_recon);
      const { error } = await supabase.from("ops_reports").insert({
        author_id: profileId,
        author_username: preparedBy,
        doc_kind: "route_recon",
        encrypted_payload: encrypted,
        ...(operationId ? { operation_id: operationId } : {}),
      });
      if (error) throw new Error(error.message);
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert("Route recon", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const dropChip = (k: RouteReconMarkerKind, label: string) => {
    const on = dropKind === k;
    return (
      <Pressable
        key={k}
        onPress={() => setDropKind(k)}
        style={[
          styles.chip,
          { borderColor: on ? p.tint : scheme === "dark" ? "#3f3f46" : "#d4d4d8", backgroundColor: on ? `${p.tint}22` : "transparent" },
        ]}>
        <Text style={{ color: p.text, fontWeight: on ? "900" : "600", fontSize: 13 }}>{label}</Text>
      </Pressable>
    );
  };

  const formPanel = (
    <View style={{ flex: 1, minWidth: 280 }}>
      <Text style={[styles.hint, { color: p.tabIconDefault }]}>
        Document a trail for follow-on teams: grids, hazards/choke points, bridges, and where comms holds up.
      </Text>

      <Text style={[styles.label, { color: p.tabIconDefault }]}>Route name / ID</Text>
      <TextInput placeholderTextColor="#888" value={routeName} onChangeText={setRouteName} style={inputStyle} />

      <Text style={[styles.label, { color: p.tabIconDefault }]}>Start (MGRS)</Text>
      <TextInput placeholderTextColor="#888" value={startMgrs} onChangeText={setStartMgrs} style={inputStyle} />
      <View style={styles.row}>
        <Pressable onPress={() => void fillStartGps()} style={[styles.mini, { borderColor: p.tint }]}>
          <Text style={{ color: p.tint, fontWeight: "800" }}>GPS</Text>
        </Pressable>
        <Pressable onPress={refineStartMap} style={[styles.mini, { borderColor: p.tint }]}>
          <Text style={{ color: p.tint, fontWeight: "800" }}>Map</Text>
        </Pressable>
      </View>

      <Text style={[styles.label, { color: p.tabIconDefault }]}>End (MGRS)</Text>
      <TextInput placeholderTextColor="#888" value={endMgrs} onChangeText={setEndMgrs} style={inputStyle} />
      <View style={styles.row}>
        <Pressable onPress={() => void fillEndGps()} style={[styles.mini, { borderColor: p.tint }]}>
          <Text style={{ color: p.tint, fontWeight: "800" }}>GPS</Text>
        </Pressable>
        <Pressable onPress={refineEndMap} style={[styles.mini, { borderColor: p.tint }]}>
          <Text style={{ color: p.tint, fontWeight: "800" }}>Map</Text>
        </Pressable>
      </View>

      <Text style={[styles.kicker, { color: p.tint }]}>Sand Table (isolated editor)</Text>
      <Pressable
        onPress={() => {
          if (!mapKey || mapKey.length !== 32) {
            Alert.alert("Route recon", "Operations encryption key required for Sand Table export.");
            return;
          }
          if (Platform.OS !== "web") {
            Alert.alert(
              "Sand Table",
              "The isolated Leaflet Sand Table runs on MM Web. This device build still has the mini-map + team map for navigation.",
            );
            return;
          }
          setShowSandTable(true);
        }}
        style={[styles.sandBtn, { borderColor: TacticalPalette.accent }]}>
        <Text style={{ color: TacticalPalette.accent, fontWeight: "900", fontSize: 14 }}>Open Sand Table editor</Text>
        <Text style={{ color: p.tabIconDefault, fontSize: 12, marginTop: 6, lineHeight: 17 }}>
          Fullscreen sandbox map — exports encrypted GeoJSON + PNG into this report (web).
        </Text>
      </Pressable>
      {sandTableGeoJsonCipher && sandTablePngCipher ? (
        <Text style={{ color: TacticalPalette.accent, fontWeight: "800", fontSize: 12, marginBottom: 8 }}>
          Sand Table plan attached (encrypted GeoJSON + PNG).
        </Text>
      ) : null}

      <Text style={[styles.kicker, { color: p.tint }]}>Marker type (tap map)</Text>
      <View style={styles.chipRow}>
        {dropChip("bridge", "Bridge")}
        {dropChip("choke", "Hazard")}
        {dropChip("comm_zone", "Comm")}
      </View>

      {selected && selected.kind === "bridge" ? (
        <View style={[styles.editor, { borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8" }]}>
          <Text style={[styles.editorTitle, { color: p.text }]}>Bridge details</Text>
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Weight limit</Text>
          <TextInput
            placeholderTextColor="#888"
            value={selected.weightLimit ?? ""}
            onChangeText={(t) => setMarkers((prev) => updateMarkers(prev, selected.id, { ...selected, weightLimit: t }))}
            style={inputStyle}
          />
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Height clearance</Text>
          <TextInput
            placeholderTextColor="#888"
            value={selected.heightClearance ?? ""}
            onChangeText={(t) => setMarkers((prev) => updateMarkers(prev, selected.id, { ...selected, heightClearance: t }))}
            style={inputStyle}
          />
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Notes</Text>
          <TextInput
            placeholderTextColor="#888"
            value={selected.notes ?? ""}
            onChangeText={(t) => setMarkers((prev) => updateMarkers(prev, selected.id, { ...selected, notes: t }))}
            style={[inputStyle, styles.tall]}
            multiline
          />
        </View>
      ) : null}

      {selected && selected.kind === "choke" ? (
        <View style={[styles.editor, { borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8" }]}>
          <Text style={[styles.editorTitle, { color: p.text }]}>Hazard / choke</Text>
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Description</Text>
          <TextInput
            placeholderTextColor="#888"
            value={selected.description ?? ""}
            onChangeText={(t) => setMarkers((prev) => updateMarkers(prev, selected.id, { ...selected, description: t }))}
            style={[inputStyle, styles.tall]}
            multiline
          />
        </View>
      ) : null}

      {selected && selected.kind === "comm_zone" ? (
        <View style={[styles.editor, { borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8" }]}>
          <Text style={[styles.editorTitle, { color: p.text }]}>Comm zone (signal strength)</Text>
          <View style={styles.row}>
            {(
              [
                ["good", "Good"],
                ["marginal", "Marginal"],
                ["dead", "Dead"],
              ] as const
            ).map(([id, label]) => {
              const on = selected.signalStrength === id;
              return (
                <Pressable
                  key={id}
                  onPress={() =>
                    setMarkers((prev) => updateMarkers(prev, selected.id, { ...selected, signalStrength: id }))
                  }
                  style={[
                    styles.sigChip,
                    {
                      borderColor: on ? p.tint : scheme === "dark" ? "#3f3f46" : "#d4d4d8",
                      backgroundColor: on ? `${p.tint}18` : "transparent",
                    },
                  ]}>
                  <Text style={{ color: p.text, fontWeight: on ? "900" : "600", fontSize: 12 }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Notes</Text>
          <TextInput
            placeholderTextColor="#888"
            value={selected.notes ?? ""}
            onChangeText={(t) => setMarkers((prev) => updateMarkers(prev, selected.id, { ...selected, notes: t }))}
            style={[inputStyle, styles.tall]}
            multiline
          />
        </View>
      ) : null}

      {selected ? (
        <Pressable
          onPress={() => {
            setMarkers((prev) => prev.filter((m) => m.id !== selected.id));
            setSelectedId(null);
          }}
          style={styles.delBtn}>
          <Text style={styles.delTx}>Remove selected marker</Text>
        </Pressable>
      ) : null}

      <Pressable disabled={busy} onPress={() => void save()} style={[styles.saveBtn, { backgroundColor: p.tint, opacity: busy ? 0.7 : 1 }]}>
        <Text style={[styles.saveTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>{busy ? "Saving…" : "Save route recon (team)"}</Text>
      </Pressable>
    </View>
  );

  const mapPanel = (
    <View style={{ flex: 1, minWidth: 280 }}>
      <RouteReconMiniMap
        markers={markers}
        dropKind={dropKind}
        onAddMarker={(m) => setMarkers((prev) => [...prev, m])}
        onSelectMarkerId={setSelectedId}
        scheme={scheme}
      />
      <Text style={{ color: p.tabIconDefault, fontSize: 12, lineHeight: 17 }}>
        {markers.length} marker{markers.length === 1 ? "" : "s"} on route sketch.
      </Text>
    </View>
  );

  return (
    <>
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <KeyboardAvoidingView
          style={[styles.wrap, { backgroundColor: p.background }]}
          behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: p.text }]}>Route reconnaissance</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.close, { color: p.tint }]}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={[styles.body, rowLayout ? styles.bodyRow : undefined]} keyboardShouldPersistTaps="handled">
            {formPanel}
            {mapPanel}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <TacticalSandTableModal
        visible={showSandTable}
        onClose={() => setShowSandTable(false)}
        mapKey={mapKey}
        scheme={scheme}
        onExport={({ geoJsonCipher, pngCipher }) => {
          setSandTableGeoJsonCipher(geoJsonCipher);
          setSandTablePngCipher(pngCipher);
          setShowSandTable(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingTop: Platform.OS === "ios" ? 54 : 28 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  title: { fontSize: 20, fontWeight: "800" },
  close: { fontSize: 17, fontWeight: "700" },
  body: { padding: 16, paddingBottom: 40, gap: 16 },
  bodyRow: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  label: { fontSize: 11, fontWeight: "700", marginTop: 10 },
  kicker: { fontSize: 12, fontWeight: "900", letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },
  sandBtn: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 10,
    backgroundColor: "transparent",
  },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  tall: { minHeight: 88, textAlignVertical: "top" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 4 },
  mini: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 2 },
  editor: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
  editorTitle: { fontWeight: "900", marginBottom: 6 },
  sigChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 2 },
  delBtn: { marginTop: 12, alignSelf: "flex-start", padding: 10 },
  delTx: { color: "#b91c1c", fontWeight: "800" },
  saveBtn: { marginTop: 18, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  saveTx: { fontWeight: "900", fontSize: 16 },
});
