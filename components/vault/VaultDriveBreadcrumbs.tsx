import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";

export type VaultCrumb = { id: string | null; label: string };

type Props = {
  crumbs: VaultCrumb[];
  onCrumbPress: (index: number) => void;
};

export function VaultDriveBreadcrumbs({ crumbs, onCrumbPress }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <View key={`${c.id ?? "root"}-${i}`} style={styles.segment}>
            <Pressable
              onPress={() => onCrumbPress(i)}
              hitSlop={6}
              disabled={last && i === 0}
              style={({ pressed }) => ({ opacity: pressed && !last ? 0.75 : 1 })}>
              <Text style={[styles.crumbTx, last && styles.crumbLast]} numberOfLines={1}>
                {c.label}
              </Text>
            </Pressable>
            {!last ? <FontAwesome name="angle-right" size={12} color={TacticalPalette.boneMuted} style={styles.sep} /> : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    paddingVertical: 4,
    gap: 2,
  },
  segment: { flexDirection: "row", alignItems: "center", maxWidth: 520 },
  sep: { marginHorizontal: 6 },
  crumbTx: {
    color: TacticalPalette.boneMuted,
    fontWeight: "700",
    fontSize: 13,
  },
  crumbLast: { color: TacticalPalette.bone, fontWeight: "900" },
});
