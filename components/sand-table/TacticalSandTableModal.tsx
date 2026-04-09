import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import Colors from "@/constants/Colors";

export type TacticalSandTableModalProps = {
  visible: boolean;
  onClose: () => void;
  /** 32-byte AES key (same material as map / ops). */
  mapKey: Uint8Array | null;
  scheme: "light" | "dark";
  /**
   * Receives AES-GCM JSON bundles from `encryptUtf8` for GeoJSON text + PNG data URL.
   * Only fired on web where the isolated Leaflet sandbox exists.
   */
  onExport?: (payload: { geoJsonCipher: string; pngCipher: string }) => void;
};

/**
 * Native / non-web: the Sand Table editor is web-only (isolated Leaflet + DOM export).
 */
export function TacticalSandTableModal({ visible, onClose, scheme }: TacticalSandTableModalProps) {
  const p = Colors[scheme];
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.wrap, { backgroundColor: p.background }]}>
        <Text style={[styles.title, { color: p.text }]}>Sand Table</Text>
        <Text style={[styles.body, { color: p.tabIconDefault }]}>
          The isolated tactical sketch workspace runs on MM Web today (fullscreen Leaflet + export). Open the Reports → Sand
          Table entry in a browser to draw, symbolize, and export without touching your phone&apos;s map tab.
        </Text>
        <Pressable onPress={onClose} style={[styles.btn, { borderColor: p.tint }]}>
          <Text style={{ color: p.tint, fontWeight: "900" }}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, justifyContent: "center", gap: 16 },
  title: { fontSize: 22, fontWeight: "900" },
  body: { fontSize: 15, lineHeight: 22 },
  btn: { alignSelf: "flex-start", borderWidth: 2, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
});
