import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTacticalChrome } from "@/hooks/useTacticalChrome";

/**
 * Unobtrusive local date/time (24h) — top-right of the app shell, not in the tab rail.
 */
export function TacticalClockBadge() {
  const insets = useSafeAreaInsets();
  const theme = useTacticalChrome();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const line = now.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        Platform.OS === "web" ? ({ userSelect: "none" } as const) : null,
        {
          top: insets.top + 2,
          right: Math.max(insets.right, 6),
        },
      ]}>
      <Text style={[styles.text, { color: theme.tabIconDefault }]} numberOfLines={1}>
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    zIndex: 40,
  },
  text: {
    fontSize: 10,
    fontWeight: "500",
    opacity: 0.42,
    letterSpacing: 0.2,
    fontVariant: ["tabular-nums"],
  },
});
