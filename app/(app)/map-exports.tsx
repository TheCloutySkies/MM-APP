import { cacheDirectory, writeAsStringAsync, EncodingType } from "expo-file-system/legacy";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";

import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { decryptUtf8 } from "@/lib/crypto/aesGcm";
import { hexToBytes } from "@/lib/crypto/bytes";
import { getMapSharedKeyHex } from "@/lib/env";
import { buildGpxFromTacticalPayloads } from "@/lib/gpx";
import { normalizeTacticalPayload, type TacticalMapPayload } from "@/lib/mapMarkers";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";

type ExportRow = {
  id: string;
  author_id: string;
  author_username: string;
  title: string;
  gpx_xml: string;
  point_count: number;
  route_count: number;
  zone_count: number;
  created_at: string;
};

export default function MapExportsScreen() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const vaultMode = useMMStore((s) => s.vaultMode) as VaultMode | null;

  const mapKey = useMemo(() => {
    const hex = resolveMapEncryptKey() ?? getMapSharedKeyHex();
    if (!hex || hex.length !== 64) return null;
    try {
      return hexToBytes(hex);
    } catch {
      return null;
    }
  }, [vaultMode]);

  const [rows, setRows] = useState<ExportRow[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("map_team_gpx_exports")
      .select(
        "id, author_id, author_username, title, gpx_xml, point_count, route_count, zone_count, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) {
      console.warn(error.message);
      return;
    }
    setRows((data ?? []) as ExportRow[]);
  }, [supabase]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const publishFromMap = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("GPX export", "Team map key unavailable.");
      return;
    }
    const t = title.trim() || `Tactical export ${new Date().toISOString().slice(0, 10)}`;
    setBusy(true);
    try {
      const { data, error } = await supabase.from("map_markers").select("id, encrypted_payload");
      if (error) {
        Alert.alert("GPX export", error.message);
        return;
      }
      const payloads: TacticalMapPayload[] = [];
      for (const row of data ?? []) {
        try {
          const json = decryptUtf8(mapKey, row.encrypted_payload as string, "mm-map-marker");
          const pl = normalizeTacticalPayload(JSON.parse(json) as unknown);
          if (pl) payloads.push(pl);
        } catch {
          /* skip */
        }
      }
      if (payloads.length === 0) {
        Alert.alert("GPX export", "No tactical features decrypted — add pins/routes/zones on the map first.");
        return;
      }
      const creator = username?.trim() || "operator";
      const { xml, counts } = buildGpxFromTacticalPayloads({
        gpxName: t,
        creatorLabel: creator,
        payloads,
      });
      if (xml.length > 4_500_000) {
        Alert.alert("GPX export", "Export too large for a single row — reduce map features.");
        return;
      }
      const { error: insErr } = await supabase.from("map_team_gpx_exports").insert({
        author_id: profileId,
        author_username: creator,
        title: t,
        gpx_xml: xml,
        point_count: counts.pointCount,
        route_count: counts.routeCount,
        zone_count: counts.zoneCount,
      });
      if (insErr) {
        Alert.alert("GPX export", insErr.message);
        return;
      }
      setTitle("");
      void refresh();
      Alert.alert("GPX export", "Published for the whole team.");
    } finally {
      setBusy(false);
    }
  };

  const shareGpx = async (row: ExportRow) => {
    const name = `${row.title.replace(/[^\w\-]+/g, "_").slice(0, 48) || "export"}.gpx`;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const blob = new Blob([row.gpx_xml], { type: "application/gpx+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    try {
      const dir = cacheDirectory;
      if (dir) {
        const path = `${dir}${name}`;
        await writeAsStringAsync(path, row.gpx_xml, { encoding: EncodingType.UTF8 });
        await Share.share({ title: name, url: path });
        return;
      }
    } catch {
      /* fall through */
    }
    await Share.share({ message: row.gpx_xml, title: name });
  };

  const removeRow = async (row: ExportRow) => {
    if (!supabase || row.author_id !== profileId) return;
    const { error } = await supabase.from("map_team_gpx_exports").delete().eq("id", row.id);
    if (error) Alert.alert("GPX export", error.message);
    else void refresh();
  };

  const inputStyle = [
    styles.input,
    {
      color: p.text,
      borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
      backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
    },
  ];

  return (
    <View style={[styles.wrap, { backgroundColor: p.background }]}>
      <Text style={[styles.lede, { color: p.tabIconDefault }]}>
        Plaintext GPX snapshots for Gaia GPS, Garmin BaseCamp, QGIS, or mesh tools. Only features you can decrypt with
        the unit map key are included. Published rows are readable by every signed-in teammate.
      </Text>
      <Text style={[styles.label, { color: p.tabIconDefault }]}>Snapshot title (optional)</Text>
      <TextInput
        placeholder="e.g. AO North — week 12"
        placeholderTextColor="#888"
        value={title}
        onChangeText={setTitle}
        style={inputStyle}
      />
      <Pressable
        style={[styles.primary, { backgroundColor: p.tint, opacity: busy ? 0.65 : 1 }]}
        disabled={busy}
        onPress={() => void publishFromMap()}>
        <Text style={[styles.primaryTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>
          {busy ? "Working…" : "Publish GPX from current map"}
        </Text>
      </Pressable>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        style={{ marginTop: 20 }}
        ListHeaderComponent={<Text style={[styles.listHead, { color: p.tabIconDefault }]}>Team library</Text>}
        renderItem={({ item }) => (
          <View style={[styles.card, { borderColor: TacticalPalette.border }]}>
            <Text style={[styles.cardTitle, { color: p.text }]}>{item.title}</Text>
            <Text style={[styles.cardMeta, { color: p.tabIconDefault }]}>
              {item.author_username} · {item.created_at}
            </Text>
            <Text style={[styles.cardMeta, { color: p.tabIconDefault }]}>
              Points {item.point_count} · routes {item.route_count} · zones {item.zone_count}
            </Text>
            <View style={styles.row}>
              <Pressable style={[styles.smallBtn, { borderColor: p.tint }]} onPress={() => void shareGpx(item)}>
                <Text style={[styles.smallBtnTx, { color: p.tint }]}>Download / share .gpx</Text>
              </Pressable>
              {item.author_id === profileId ? (
                <Pressable style={[styles.smallBtn, { borderColor: TacticalPalette.danger }]} onPress={() => removeRow(item)}>
                  <Text style={[styles.smallBtnTx, { color: TacticalPalette.danger }]}>Delete</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  lede: { fontSize: 12, lineHeight: 18, marginBottom: 12 },
  label: { fontSize: 11, fontWeight: "700", marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 10 },
  primary: { paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  primaryTx: { fontSize: 16, fontWeight: "800" },
  listHead: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardMeta: { fontSize: 12, marginTop: 4 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  smallBtn: { borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  smallBtnTx: { fontWeight: "700", fontSize: 13 },
});
