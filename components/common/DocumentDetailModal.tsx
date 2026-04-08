import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  body: string;
  onClose: () => void;
};

/**
 * Full-screen readable document view (replaces Alert.alert for long ciphertext / web).
 */
export function DocumentDetailModal({ visible, title, subtitle, body, onClose }: Props) {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const insets = useSafeAreaInsets();
  const webInsetShell =
    Platform.OS === "web"
      ? ({
          minHeight: "100dvh" as never,
          width: "100%" as never,
          maxWidth: "100vw" as never,
          paddingTop: insets.top,
        } as const)
      : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={onClose}>
      <View style={[styles.shell, { backgroundColor: p.background }, webInsetShell]}>
        <View style={[styles.head, { borderBottomColor: scheme === "dark" ? "#27272a" : "#e4e4e7" }]}>
          <Pressable onPress={onClose} hitSlop={14} style={styles.closeRow} accessibilityRole="button">
            <FontAwesome name="times" size={22} color={p.tint} />
            <Text style={[styles.closeTx, { color: p.tint }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollInner, { paddingBottom: Math.max(28, insets.bottom + 16) }]}
          keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: p.text }]} selectable>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: p.tabIconDefault }]} selectable>
              {subtitle}
            </Text>
          ) : null}
          <View style={[styles.bodyBox, { borderColor: TacticalPalette.border }]}>
            <Text style={[styles.body, { color: p.text }]} selectable>
              {body || "—"}
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  head: {
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "ios" ? 12 : 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeRow: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start" },
  closeTx: { fontSize: 17, fontWeight: "700" },
  scroll: { flex: 1 },
  scrollInner: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 6 },
  subtitle: { fontSize: 13, marginBottom: 14 },
  bodyBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    backgroundColor: "rgba(58, 66, 56, 0.15)",
  },
  body: { fontSize: 15, lineHeight: 22 },
});
