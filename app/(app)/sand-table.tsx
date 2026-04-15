import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";

import { TacticalBlock } from "@/components/shell/TacticalBlock";
import { TacticalSandTableModal } from "@/components/sand-table/TacticalSandTableModal";
import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";
import { hexToBytes } from "@/lib/crypto/bytes";
import { getMapSharedKeyHex } from "@/lib/env";

/**
 * Product entry for the **Sand Table Route Creator** (tactical sketch / digital sand table).
 * Full MapLibre + Geoman + milsymbol + encrypted plan vault + print pipeline ships incrementally; map drawing today lives under Map.
 */
export default function SandTableScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
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
    <View style={[styles.wrap, { backgroundColor: p.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <FontAwesome name="chevron-left" size={16} color={p.tint} />
          <Text style={[styles.backTx, { color: p.tint }]}>Back</Text>
        </Pressable>

        <Text style={[styles.kicker, { color: p.tabIconDefault }]}>SAND TABLE ROUTE CREATOR</Text>
        <Text style={[styles.h1, { color: p.text }]}>Tactical sketch planner</Text>
        <Text style={[styles.lede, { color: p.tabIconDefault }]}>
          The Sand Table is a fullscreen, isolated Leaflet workspace (web) — it never shares layers with the global Map tab.
          Draw routes, zones, MIL-STD symbols, and labels; export encrypted GeoJSON + PNG into a Route recon report.
        </Text>

        <Pressable
          onPress={() => {
            if (!mapKey || mapKey.length !== 32) {
              Alert.alert("Sand Table", "Unlock your vault or set a team ops key before exporting plans.");
              return;
            }
            setSandOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Open isolated Sand Table editor"
          style={styles.cta}>
          <View style={[styles.ctaInner, { borderColor: TacticalPalette.accent }]}>
            <FontAwesome name="map" size={20} color={TacticalPalette.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.ctaTitle, { color: TacticalPalette.accent }]}>Open Sand Table editor</Text>
              <Text style={{ color: p.tabIconDefault, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
                Temporary sandbox map — approve to encrypt vectors + snapshot. On mobile, use Route recon → Sand Table to attach the
                same export to a report.
              </Text>
            </View>
            <FontAwesome name="chevron-right" size={12} color={p.tabIconDefault} />
          </View>
        </Pressable>

        <Pressable
          onPress={() => router.push("/(app)/map")}
          accessibilityRole="button"
          accessibilityLabel="Open live tactical map"
          style={styles.secondary}>
          <Text style={{ color: p.tint, fontWeight: "800" }}>Open live team map (global tab)</Text>
        </Pressable>

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
          <Bullet text="OSM / topo vector tiles cached in IndexedDB (MapLibre-class stack)" scheme={sch} />
          <Bullet text="Leaflet Geoman toolbar — routes, zones, buffers, measurements" scheme={sch} />
          <Bullet text="milsymbol-generated SVG markers (affiliation + unit type)" scheme={sch} />
          <Bullet text="Map-anchored labels + Calcite-style property rail" scheme={sch} />
          <Bullet text="Encrypted GeoJSON “operation plans” + optional Cloudflare print worker" scheme={sch} />
        </TacticalBlock>
      </ScrollView>
    </View>
  );
}

function Bullet({ text, scheme }: { text: string; scheme: "light" | "dark" }) {
  const p = Colors[scheme];
  return (
    <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
      <Text style={{ color: TacticalPalette.accent, fontWeight: "900" }}>•</Text>
      <Text style={{ flex: 1, color: p.text, fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  backTx: { fontWeight: "800", fontSize: 15 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1.1, marginBottom: 8 },
  h1: { fontSize: 24, fontWeight: "900", marginBottom: 10 },
  lede: { fontSize: 14, lineHeight: 21, marginBottom: 18 },
  cta: { marginBottom: 18 },
  ctaInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    backgroundColor: TacticalPalette.elevated,
  },
  ctaTitle: { fontSize: 16, fontWeight: "900" },
  secondary: {
    alignSelf: "flex-start",
    marginBottom: 18,
    paddingVertical: 10,
  },
});
