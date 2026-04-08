import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";

/**
 * One-time hint after `/sw.js` registers (see `registerMmServiceWorker`).
 */
export function PwaShellReadyBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onReady = () => setVisible(true);
    window.addEventListener("mm-offline-shell-ready", onReady);
    return () => window.removeEventListener("mm-offline-shell-ready", onReady);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.box} pointerEvents="none">
      <Text style={styles.tx}>
        Offline-ready: this browser cached the app shell. Re-open without network after you have loaded the app once
        while online.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    zIndex: 100000,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(12,14,11,0.94)",
    borderWidth: 1,
    borderColor: TacticalPalette.border,
  },
  tx: {
    color: TacticalPalette.boneMuted,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
});
