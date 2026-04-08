import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { markLayoutWelcomeSeen } from "@/lib/layout/layoutPreference";

type Props = { style?: object | object[] };

/**
 * Web-only: force mobile vs desktop layout and reload (PWA viewport lock friendly).
 */
export function LayoutOverrideBar({ style }: Props) {
  const { preference, setPreferenceAndReload } = useLayoutMode();

  if (Platform.OS !== "web") return null;

  const prefLabel =
    preference === "auto" ? "Auto (screen width)" : preference === "desktop" ? "Desktop" : "Mobile";

  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.caption}>Layout: {prefLabel}</Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.btn, preference === "mobile" && styles.btnOn]}
          onPress={() => {
            markLayoutWelcomeSeen();
            setPreferenceAndReload("mobile");
          }}>
          <Text style={[styles.btnTx, preference === "mobile" && styles.btnTxOn]}>Mobile</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, preference === "desktop" && styles.btnOn]}
          onPress={() => {
            markLayoutWelcomeSeen();
            setPreferenceAndReload("desktop");
          }}>
          <Text style={[styles.btnTx, preference === "desktop" && styles.btnTxOn]}>Desktop</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TacticalPalette.border,
    gap: 10,
    width: "100%" as const,
  },
  caption: {
    color: TacticalPalette.boneMuted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    backgroundColor: TacticalPalette.charcoal,
  },
  btnOn: {
    borderColor: TacticalPalette.coyote,
    backgroundColor: "rgba(107, 142, 92, 0.15)",
  },
  btnTx: {
    color: TacticalPalette.boneMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  btnTxOn: {
    color: TacticalPalette.bone,
  },
});
