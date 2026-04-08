import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";
import {
    LAYOUT_AUTO_DESKTOP_MIN_WIDTH,
    markLayoutWelcomeSeen,
    needsLayoutWelcome,
    reloadWebApp,
    setLayoutPreference,
    type LayoutPreference,
} from "@/lib/layout/layoutPreference";

/**
 * First-visit web dialog: pick mobile vs desktop layout, then full reload.
 */
export function LayoutWelcomeGate() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined") return;
    setOpen(needsLayoutWelcome());
  }, []);

  if (Platform.OS !== "web") return null;

  const commit = (pref: LayoutPreference) => {
    setLayoutPreference(pref);
    markLayoutWelcomeSeen();
    setOpen(false);
    reloadWebApp();
  };

  const wide = typeof window !== "undefined" && window.innerWidth >= LAYOUT_AUTO_DESKTOP_MIN_WIDTH;

  return (
    <Modal visible={open} animationType="fade" transparent statusBarTranslucent>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.title}>Select interface mode</Text>
          <Text style={styles.sub}>
            This loads once. You can change it later on the sign-in screen or under Settings → Display & interface. The
            page will reload to apply layout.
          </Text>
          <Pressable
            style={[styles.choice, styles.choicePrimary]}
            onPress={() => commit("mobile")}
            accessibilityRole="button"
            accessibilityLabel="Mobile or phone layout">
            <Text style={styles.choiceTitle}>Mobile/Phone</Text>
            <Text style={styles.choiceSub}>
              Bottom tools, narrow rail. Best for phones and small screens.
            </Text>
          </Pressable>
          <Pressable
            style={styles.choice}
            onPress={() => commit("desktop")}
            accessibilityRole="button"
            accessibilityLabel="Desktop layout">
            <Text style={styles.choiceTitle}>Desktop</Text>
          </Pressable>
          <Pressable
            style={styles.choiceMuted}
            onPress={() => commit("auto")}
            accessibilityRole="button"
            accessibilityLabel="Match screen width automatically">
            <Text style={styles.choiceMutedTx}>
              Match this device ({wide ? "desktop breakpoint" : "mobile breakpoint"})
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    maxWidth: 420,
    width: "100%" as const,
    alignSelf: "center",
    backgroundColor: TacticalPalette.charcoal,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    padding: 20,
    gap: 14,
  },
  title: {
    color: TacticalPalette.bone,
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  sub: {
    color: TacticalPalette.boneMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginBottom: 4,
  },
  choice: {
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 12,
    padding: 16,
    backgroundColor: TacticalPalette.elevated,
  },
  choicePrimary: {
    borderColor: TacticalPalette.coyote,
    backgroundColor: "rgba(107, 142, 92, 0.12)",
  },
  choiceTitle: {
    color: TacticalPalette.bone,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 6,
  },
  choiceSub: {
    color: TacticalPalette.boneMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  choiceMuted: {
    paddingVertical: 12,
    alignItems: "center",
  },
  choiceMutedTx: {
    color: TacticalPalette.coyote,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});
