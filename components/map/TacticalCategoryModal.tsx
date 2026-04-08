import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions } from "react-native";

import Colors from "@/constants/Colors";
import { TAC_CATEGORIES, type TacCategoryId } from "@/lib/mapMarkers";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (category: TacCategoryId) => void;
  title: string;
  scheme: "light" | "dark";
};

export function TacticalCategoryModal({ visible, onClose, onSelect, title, scheme }: Props) {
  const p = Colors[scheme];
  const { width } = useWindowDimensions();
  const webMobile = Platform.OS === "web" && width < 768;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, webMobile && styles.backdropFullBleed]}
        onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            { backgroundColor: p.background, borderColor: scheme === "dark" ? "#3f3f46" : "#e4e4e7" },
            webMobile && styles.cardFullBleed,
          ]}
          onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.cardTitle, { color: p.text }]}>{title}</Text>
          <Text style={[styles.cardHint, { color: p.tabIconDefault }]}>
            Choose a category — others will see who placed it on the map.
          </Text>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {TAC_CATEGORIES.map((c) => (
              <Pressable
                key={c.id}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderColor: scheme === "dark" ? "#3f3f46" : "#e4e4e7",
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => onSelect(c.id)}>
                <Text style={[styles.rowLabel, { color: p.text }]}>{c.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable style={[styles.cancelBtn, { borderColor: p.tabIconDefault }]} onPress={onClose}>
            <Text style={[styles.cancelLabel, { color: p.text }]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  backdropFullBleed: {
    justifyContent: "flex-end",
    paddingHorizontal: 0,
    ...(Platform.OS === "web"
      ? ({ minHeight: "100dvh" as never, width: "100%" as never } as const)
      : null),
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    maxHeight: "78%",
  },
  cardFullBleed: {
    width: "100%",
    maxWidth: "100%",
    borderRadius: 0,
    alignSelf: "stretch",
    maxHeight: "92dvh" as never,
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  cardHint: {
    fontSize: 12,
    marginTop: 6,
    lineHeight: 17,
  },
  list: {
    marginTop: 14,
    maxHeight: 360,
  },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  cancelBtn: {
    marginTop: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
});
