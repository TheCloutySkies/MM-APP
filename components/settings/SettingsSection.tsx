import type { ReactNode } from "react";
import { StyleSheet, Text, View, useColorScheme } from "react-native";

import Colors from "@/constants/Colors";

type Props = { title: string; subtitle?: string; children: ReactNode };

export function SettingsSection({ title, subtitle, children }: Props) {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];

  return (
    <View style={styles.block}>
      <Text style={[styles.title, { color: p.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: p.tabIconDefault }]}>{subtitle}</Text>
      ) : null}
      <View style={styles.gap}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: 28 },
  title: { fontSize: 13, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  subtitle: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  gap: { marginTop: 14, gap: 12 },
});
