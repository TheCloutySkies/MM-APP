import { cacheDirectory, writeAsStringAsync, EncodingType } from "expo-file-system/legacy";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { Button, Card, Text, TextInput } from "react-native-paper";

import { useTacticalChrome } from "@/hooks/useTacticalChrome";
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
  const chrome = useTacticalChrome();
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

  const inputTheme = {
    colors: {
      onSurfaceVariant: chrome.textMuted,
      background: chrome.surface,
    },
  };

  return (
    <View style={[styles.wrap, { backgroundColor: chrome.background }]}>
      <Text variant="bodySmall" style={[styles.lede, { color: chrome.textMuted }]}>
        Plaintext GPX snapshots for Gaia GPS, Garmin BaseCamp, QGIS, or mesh tools. Only features you can decrypt with the unit map key
        are included. Published rows are readable by every signed-in teammate.
      </Text>
      <Text variant="labelLarge" style={[styles.label, { color: chrome.textMuted }]}>
        Snapshot title (optional)
      </Text>
      <TextInput
        mode="outlined"
        placeholder="e.g. AO North — week 12"
        value={title}
        onChangeText={setTitle}
        dense
        style={styles.input}
        outlineColor={TacticalPalette.border}
        activeOutlineColor={chrome.accent}
        textColor={chrome.text}
        placeholderTextColor={chrome.textMuted}
        theme={inputTheme}
      />
      <Button
        mode="contained"
        disabled={busy}
        loading={busy}
        onPress={() => void publishFromMap()}
        buttonColor={chrome.accent}
        textColor={TacticalPalette.matteBlack}>
        Publish GPX from current map
      </Button>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        style={{ marginTop: 20 }}
        ListHeaderComponent={
          <Text variant="labelLarge" style={[styles.listHead, { color: chrome.textMuted }]}>
            Team library
          </Text>
        }
        renderItem={({ item }) => (
          <Card mode="outlined" style={[styles.card, { borderColor: TacticalPalette.border }]}>
            <Card.Title title={item.title} titleStyle={{ color: chrome.text }} />
            <Card.Content>
              <Text variant="bodySmall" style={{ color: chrome.textMuted }}>
                {item.author_username} · {item.created_at}
              </Text>
              <Text variant="bodySmall" style={{ color: chrome.textMuted, marginTop: 4 }}>
                Points {item.point_count} · routes {item.route_count} · zones {item.zone_count}
              </Text>
              <View style={styles.row}>
                <Button mode="outlined" onPress={() => void shareGpx(item)} textColor={chrome.accent}>
                  Download / share .gpx
                </Button>
                {item.author_id === profileId ? (
                  <Button mode="text" textColor={TacticalPalette.danger} onPress={() => void removeRow(item)}>
                    Delete
                  </Button>
                ) : null}
              </View>
            </Card.Content>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  lede: { lineHeight: 18, marginBottom: 12 },
  label: { marginBottom: 8 },
  input: { marginBottom: 10, backgroundColor: "transparent" },
  listHead: { letterSpacing: 0.6, marginBottom: 8 },
  card: { marginBottom: 10, borderRadius: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" },
});
