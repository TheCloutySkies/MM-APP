import * as Linking from "expo-linking";
import { useLayoutEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Rnd } from "react-rnd";

import { TacticalPalette } from "@/constants/TacticalTheme";

const PALANTIR_URL = "https://good-palantir.vercel.app";
const HOST_DOM_ID = "mm-palantir-iframe-slot";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function GoodPalantirWindow({ visible, onClose }: Props) {
  const [embedState, setEmbedState] = useState<"loading" | "loaded" | "suspect">("loading");
  const suspectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const launchExternal = () => {
    void Linking.openURL(PALANTIR_URL);
  };

  useLayoutEffect(() => {
    if (!visible) {
      setEmbedState("loading");
      return;
    }
    const host = document.getElementById(HOST_DOM_ID);
    if (!host) return;
    host.innerHTML = "";
    setEmbedState("loading");
    const iframe = document.createElement("iframe");
    iframe.title = "Good Palantir";
    iframe.src = PALANTIR_URL;
    iframe.setAttribute("style", "border:0;width:100%;height:100%;display:block");
    iframe.referrerPolicy = "no-referrer";
    iframe.onload = () => {
      if (suspectTimer.current) clearTimeout(suspectTimer.current);
      setEmbedState("loaded");
    };
    suspectTimer.current = setTimeout(() => setEmbedState((s) => (s === "loaded" ? s : "suspect")), 4000);
    host.appendChild(iframe);
    return () => {
      if (suspectTimer.current) clearTimeout(suspectTimer.current);
      host.innerHTML = "";
    };
  }, [visible]);

  if (!visible) return null;

  const w = typeof window !== "undefined" ? Math.min(560, window.innerWidth - 32) : 560;
  const h = typeof window !== "undefined" ? Math.min(420, window.innerHeight - 48) : 420;
  const x = typeof window !== "undefined" ? Math.max(8, (window.innerWidth - w) / 2) : 40;
  const y = typeof window !== "undefined" ? Math.max(48, (window.innerHeight - h) / 3) : 72;
  const showIframe = embedState !== "suspect";

  return (
    <Rnd
      bounds="window"
      default={{ x, y, width: w, height: h }}
      minWidth={300}
      minHeight={220}
      // eslint-disable-next-line react-native/no-inline-styles
      style={{ zIndex: 50000 }}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Open Good Palantir</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close panel">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        {embedState === "suspect" ? (
          <View style={styles.fallback}>
            <Text style={styles.fallbackTitle}>Connection refused by host</Text>
            <Text style={styles.fallbackBody}>
              The page may be blank if the site sends X-Frame-Options or a Content-Security-Policy that blocks embedding.
              You can still open it in a full browser tab.
            </Text>
            <Pressable style={styles.launchBtn} onPress={launchExternal}>
              <Text style={styles.launchTx}>Launch external</Text>
            </Pressable>
          </View>
        ) : null}

        {showIframe ? <View style={styles.frameHost} collapsable={false} nativeID={HOST_DOM_ID} /> : null}

        {embedState === "loading" && showIframe ? (
          <View style={styles.loadingStrip}>
            <Text style={styles.loadingTx}>Loading embed…</Text>
            <Pressable onPress={launchExternal}>
              <Text style={styles.linkTx}>Open in new tab</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Rnd>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: TacticalPalette.charcoal,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 10,
    overflow: "hidden",
    flexDirection: "column",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: TacticalPalette.elevated,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TacticalPalette.border,
  },
  headerTitle: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 15 },
  close: { color: TacticalPalette.coyote, fontSize: 18, fontWeight: "700" },
  frameHost: { flex: 1, minHeight: 120, backgroundColor: "#000" },
  loadingStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: TacticalPalette.matteBlack,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TacticalPalette.border,
  },
  loadingTx: { color: TacticalPalette.boneMuted, fontSize: 12 },
  linkTx: { color: TacticalPalette.accent, fontSize: 12, fontWeight: "700" },
  fallback: {
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TacticalPalette.border,
    backgroundColor: "#1a0a0c",
  },
  fallbackTitle: {
    color: TacticalPalette.danger,
    fontWeight: "800",
    fontSize: 15,
    marginBottom: 6,
  },
  fallbackBody: { color: TacticalPalette.boneMuted, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  launchBtn: {
    alignSelf: "flex-start",
    backgroundColor: TacticalPalette.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  launchTx: { color: "#0f172a", fontWeight: "800" },
});
