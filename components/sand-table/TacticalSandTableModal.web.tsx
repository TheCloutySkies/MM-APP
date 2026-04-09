import type { FeatureCollection } from "geojson";
import { useMemo } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { encryptUtf8 } from "@/lib/crypto/aesGcm";
import { SAND_TABLE_GEOJSON_AAD, SAND_TABLE_PNG_AAD } from "@/lib/opsReports";

import type { TacticalSandTableModalProps } from "./TacticalSandTableModal";
import { TacticalSandTableMap } from "./TacticalSandTableMap.web";

export function TacticalSandTableModal({ visible, onClose, mapKey, scheme, onExport }: TacticalSandTableModalProps) {
  const p = Colors[scheme];
  const insets = useSafeAreaInsets();

  const canEncrypt = useMemo(() => Boolean(mapKey && mapKey.length === 32), [mapKey]);

  const handleApprove = (geo: FeatureCollection, pngDataUrl: string) => {
    if (!mapKey || mapKey.length !== 32) {
      Alert.alert("Sand Table", "Encryption key not available.");
      return;
    }
    try {
      const geoJsonCipher = encryptUtf8(mapKey, JSON.stringify(geo), SAND_TABLE_GEOJSON_AAD);
      const pngCipher = encryptUtf8(mapKey, pngDataUrl, SAND_TABLE_PNG_AAD);
      onExport?.({ geoJsonCipher, pngCipher });
    } catch (e) {
      Alert.alert("Sand Table", e instanceof Error ? e.message : "Encryption failed");
      return;
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.shell, { backgroundColor: scheme === "dark" ? "#020617" : TacticalPalette.matteBlack }]}>
        <View style={[styles.topBar, { paddingTop: 12 + insets.top, borderBottomColor: p.tabIconDefault }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.kicker, { color: TacticalPalette.accent }]}>ISOLATED WORKSPACE</Text>
            <Text style={[styles.headline, { color: "#f8fafc" }]}>Sand Table Route Creator</Text>
            <Text style={[styles.sub, { color: "#94a3b8" }]}>
              Separate Leaflet engine — nothing here is shared with the global Map tab.
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={[styles.closeBtn, { borderColor: "#334155" }]}>
            <Text style={{ color: "#e2e8f0", fontWeight: "900" }}>Close</Text>
          </Pressable>
        </View>
        {!canEncrypt ? (
          <View style={{ padding: 20 }}>
            <Text style={{ color: "#fecaca", fontWeight: "800" }}>
              Unlock your vault or team ops key before opening the Sand Table editor.
            </Text>
          </View>
        ) : (
          <View style={styles.mapWrap}>
            <TacticalSandTableMap scheme={scheme} onApprove={handleApprove} />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kicker: { fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  headline: { fontSize: 20, fontWeight: "900", marginTop: 4 },
  sub: { fontSize: 12, lineHeight: 17, marginTop: 6, maxWidth: 560 },
  closeBtn: { marginTop: 4, borderWidth: 2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  mapWrap: { flex: 1, minHeight: 0 },
});
