import * as Linking from "expo-linking";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";

const PALANTIR_URL = "https://good-palantir.vercel.app";

type Props = {
  visible: boolean;
  onClose: () => void;
};

/** Native: no iframe embed — offer external launch (same URL as web fall-back). */
export function GoodPalantirWindow({ visible, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Open Good Palantir</Text>
          <Text style={styles.body}>
            The draggable embed panel runs on web. On this device, open the dashboard in your browser.
          </Text>
          <Pressable
            style={styles.primary}
            onPress={() => {
              void Linking.openURL(PALANTIR_URL);
            }}>
            <Text style={styles.primaryTx}>Launch external</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.secondary}>
            <Text style={styles.secondaryTx}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: TacticalPalette.elevated,
    borderRadius: 12,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TacticalPalette.border,
    maxWidth: 400,
    alignSelf: "center",
    width: "100%",
  },
  title: { color: TacticalPalette.bone, fontSize: 18, fontWeight: "800", marginBottom: 10 },
  body: { color: TacticalPalette.boneMuted, fontSize: 14, lineHeight: 20, marginBottom: 18 },
  primary: {
    backgroundColor: TacticalPalette.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryTx: { color: "#0f172a", fontSize: 16, fontWeight: "800" },
  secondary: { paddingVertical: 12, alignItems: "center" },
  secondaryTx: { color: TacticalPalette.coyote, fontSize: 15, fontWeight: "600" },
});
