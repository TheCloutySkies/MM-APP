import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, useColorScheme, View } from "react-native";
import { Button, Card, Text } from "react-native-paper";

import { TacticalBlock } from "@/components/shell/TacticalBlock";
import { TacticalSandTableModal } from "@/components/sand-table/TacticalSandTableModal";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { TacticalPalette, type TacticalColors } from "@/constants/TacticalTheme";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";
import { hexToBytes } from "@/lib/crypto/bytes";
import { getMapSharedKeyHex } from "@/lib/env";

/**
 * Product entry for the **Sand Table Route Creator** (tactical sketch / digital sand table).
 * Full MapLibre + Geoman + milsymbol + encrypted plan vault + print pipeline ships incrementally; map drawing today lives under Map.
 */
export default function SandTableScreen() {
  const router = useRouter();
  const chrome = useTacticalChrome();
  const scheme = useColorScheme() ?? "light";
  const sch = scheme === "dark" ? "dark" : "light";
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
  const [sandOpen, setSandOpen] = useState(false);

  return (
    <View style={[styles.wrap, { backgroundColor: chrome.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button mode="text" onPress={() => router.back()} icon="chevron-left" textColor={chrome.accent} style={styles.back}>
          Back
        </Button>

        <Text variant="labelLarge" style={[styles.kicker, { color: chrome.textMuted }]}>
          SAND TABLE ROUTE CREATOR
        </Text>
        <Text variant="headlineSmall" style={[styles.h1, { color: chrome.text }]}>
          Tactical sketch planner
        </Text>
        <Text variant="bodyMedium" style={[styles.lede, { color: chrome.textMuted }]}>
          The Sand Table is a fullscreen, isolated Leaflet workspace (web) — it never shares layers with the global Map tab. Draw
          routes, zones, MIL-STD symbols, and labels; export encrypted GeoJSON + PNG into a Route recon report.
        </Text>

        <Card
          mode="elevated"
          style={[styles.ctaCard, { borderColor: TacticalPalette.accent }]}
          onPress={() => {
            if (!mapKey || mapKey.length !== 32) {
              Alert.alert("Sand Table", "Unlock your vault or set a team ops key before exporting plans.");
              return;
            }
            setSandOpen(true);
          }}>
          <Card.Title
            title="Open Sand Table editor"
            titleStyle={{ color: TacticalPalette.accent, fontSize: 16 }}
            subtitle="Temporary sandbox map — approve to encrypt vectors + snapshot. On mobile, use Route recon → Sand Table to attach the same export to a report."
            subtitleNumberOfLines={4}
            subtitleStyle={{ color: chrome.textMuted, fontSize: 12, lineHeight: 17 }}
            left={() => <FontAwesome name="map" size={20} color={TacticalPalette.accent} style={{ marginLeft: 12 }} />}
            right={() => <FontAwesome name="chevron-right" size={12} color={chrome.textMuted} style={{ marginRight: 12 }} />}
          />
        </Card>

        <Button mode="text" onPress={() => router.push("/(app)/map")} textColor={chrome.accent} style={styles.secondary}>
          Open live team map (global tab)
        </Button>

        <TacticalSandTableModal
          visible={sandOpen}
          onClose={() => setSandOpen(false)}
          mapKey={mapKey}
          scheme={sch}
          onExport={() => {
            Alert.alert(
              "Sand Table",
              "Plan encrypted on-device. To file it with your team, open Reports → Route recon → Open Sand Table editor and export from there — those bundles attach to the encrypted route recon payload.",
            );
          }}
        />

        <TacticalBlock title="Architecture checkpoints" defaultOpen={false}>
          <Bullet text="OSM / topo vector tiles cached in IndexedDB (MapLibre-class stack)" chrome={chrome} />
          <Bullet text="Leaflet Geoman toolbar — routes, zones, buffers, measurements" chrome={chrome} />
          <Bullet text="milsymbol-generated SVG markers (affiliation + unit type)" chrome={chrome} />
          <Bullet text="Map-anchored labels + Calcite-style property rail" chrome={chrome} />
          <Bullet text="Encrypted GeoJSON “operation plans” + optional Cloudflare print worker" chrome={chrome} />
        </TacticalBlock>
      </ScrollView>
    </View>
  );
}

function Bullet({ text, chrome }: { text: string; chrome: TacticalColors }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
      <Text style={{ color: TacticalPalette.accent, fontWeight: "900" }}>•</Text>
      <Text style={{ flex: 1, color: chrome.text, fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  back: { alignSelf: "flex-start", marginBottom: 8 },
  kicker: { letterSpacing: 1.1, marginBottom: 8 },
  h1: { fontWeight: "900", marginBottom: 10 },
  lede: { lineHeight: 21, marginBottom: 18 },
  ctaCard: {
    marginBottom: 18,
    borderRadius: 12,
    borderWidth: 2,
    backgroundColor: TacticalPalette.elevated,
  },
  secondary: {
    alignSelf: "flex-start",
    marginBottom: 18,
  },
});
