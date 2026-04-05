import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { useCallback, useMemo, useState } from "react";
import {
    Alert,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
    useColorScheme,
} from "react-native";

import Colors from "@/constants/Colors";
import { getDistressWebhookUrl } from "@/lib/env";
import { useMMStore } from "@/store/mmStore";

const EXPO_ENV_DOCS = "https://docs.expo.dev/guides/environment-variables/";

function maskEndpoint(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const short = path.length > 28 ? `${path.slice(0, 28)}…` : path;
    return `${u.hostname}${short}`;
  } catch {
    return "custom URL";
  }
}

export function DistressWebhookCard() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const username = useMMStore((s) => s.username);
  const [open, setOpen] = useState(false);

  const url = getDistressWebhookUrl().trim();
  const configured = url.length > 0;
  const endpointLabel = configured ? maskEndpoint(url) : null;

  const samplePayload = useMemo(
    () =>
      JSON.stringify(
        { t: "mm_distress", u: username ?? "your_username", lat: 0, lng: 0, ts: Date.now() },
        null,
        2,
      ),
    [username],
  );

  const copyEnvTemplate = useCallback(async () => {
    await Clipboard.setStringAsync(
      "# Paste your HTTPS webhook URL after the = sign\nEXPO_PUBLIC_DISTRESS_WEBHOOK_URL=\n",
    );
    Alert.alert("Copied", "Paste into your project `.env`, add your URL, then restart Expo.");
  }, []);

  const copyPayload = useCallback(async () => {
    await Clipboard.setStringAsync(samplePayload);
    Alert.alert("Copied", "Sample JSON body your endpoint should expect.");
  }, [samplePayload]);

  const openEnvDocs = useCallback(() => {
    void Linking.openURL(EXPO_ENV_DOCS);
  }, []);

  return (
    <View style={[styles.card, { borderColor: p.tabIconDefault, backgroundColor: p.background }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: p.text }]}>Distress webhook</Text>
          <Text style={[styles.cardBlurb, { color: p.tabIconDefault }]}>
            Long-press Panic sends a POST with your last known coordinates, then locks the app. The URL
            is read at build time from{" "}
            <Text style={{ fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) }}>
              EXPO_PUBLIC_DISTRESS_WEBHOOK_URL
            </Text>
            .
          </Text>
        </View>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: configured ? "rgba(34,197,94,0.15)" : "rgba(148,163,184,0.12)",
              borderColor: configured ? "rgba(34,197,94,0.45)" : "rgba(148,163,184,0.35)",
            },
          ]}>
          <Text style={[styles.badgeText, { color: configured ? "#4ade80" : p.tabIconDefault }]}>
            {configured ? "On" : "Off"}
          </Text>
        </View>
      </View>

      {configured && endpointLabel ? (
        <View style={[styles.endpointRow, { backgroundColor: "rgba(0,0,0,0.06)" }]}>
          <Text style={[styles.endpointLabel, { color: p.tabIconDefault }]}>Endpoint</Text>
          <Text style={[styles.endpointValue, { color: p.text }]} numberOfLines={2}>
            {endpointLabel}
          </Text>
        </View>
      ) : (
        <View style={[styles.hintBox, { borderColor: p.tabIconDefault }]}>
          <Text style={[styles.hintTitle, { color: p.text }]}>Not configured yet</Text>
          <Text style={[styles.hintBody, { color: p.tabIconDefault }]}>
            Add the variable to <Text style={{ fontWeight: "600" }}>.env</Text> in your project root,
            restart <Text style={{ fontWeight: "600" }}>expo start</Text>, and reopen this screen.
          </Text>
        </View>
      )}

      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.accordionHit,
          { opacity: pressed ? 0.75 : 1 },
        ]}>
        <Text style={[styles.accordionLabel, { color: p.tint }]}>
          {open ? "Hide setup steps" : "Show setup steps"}
        </Text>
      </Pressable>

      {open ? (
        <View style={styles.steps}>
          {[
            "Create an HTTPS endpoint that accepts POST + JSON (Zapier Catch Hook, Make.com webhook, Discord webhook, Cloudflare Worker, your own API).",
            "Copy the full URL (include any secret path or query token your provider gives you).",
            "In the MM-APP project root, open or create `.env` and add:\nEXPO_PUBLIC_DISTRESS_WEBHOOK_URL=https://…",
            "Stop and restart the dev server (or rebuild) so Expo embeds the value.",
            "Optional: verify with a test Panic long-press in a safe environment.",
          ].map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={[styles.stepNum, { borderColor: p.tint, backgroundColor: p.background }]}>
                <Text style={[styles.stepNumText, { color: p.tint }]}>{i + 1}</Text>
              </View>
              <Text style={[styles.stepText, { color: p.text }]}>{step}</Text>
            </View>
          ))}
          <View style={[styles.security, { borderColor: "rgba(251,191,36,0.4)", backgroundColor: "rgba(251,191,36,0.08)" }]}>
            <Text style={[styles.securityTitle, { color: p.text }]}>Security</Text>
            <Text style={[styles.securityBody, { color: p.tabIconDefault }]}>
              EXPO_PUBLIC_* values ship inside the client bundle. Treat the webhook URL like a shared
              secret: use a long random path, rotate if it leaks, and avoid putting database credentials in
              the URL.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() => void copyEnvTemplate()}
          style={({ pressed }) => [
            styles.actionBtn,
            { borderColor: p.tint, opacity: pressed ? 0.85 : 1 },
          ]}>
          <Text style={[styles.actionBtnText, { color: p.text }]}>Copy .env line template</Text>
        </Pressable>
        <Pressable
          onPress={() => void copyPayload()}
          style={({ pressed }) => [
            styles.actionBtn,
            { borderColor: p.tabIconDefault, opacity: pressed ? 0.85 : 1 },
          ]}>
          <Text style={[styles.actionBtnText, { color: p.text }]}>Copy sample JSON payload</Text>
        </Pressable>
        <Pressable
          onPress={() => void openEnvDocs()}
          style={({ pressed }) => [
            styles.actionBtn,
            { borderColor: p.tabIconDefault, opacity: pressed ? 0.85 : 1 },
          ]}>
          <Text style={[styles.actionBtnText, { color: p.tint }]}>Expo environment variables →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  cardHeaderText: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: "700" },
  cardBlurb: { fontSize: 14, marginTop: 6, lineHeight: 21 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: { fontSize: 12, fontWeight: "700" },
  endpointRow: { marginTop: 14, borderRadius: 12, padding: 12 },
  endpointLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 },
  endpointValue: { fontSize: 14, marginTop: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  hintBox: { marginTop: 14, borderWidth: 1, borderStyle: "dashed", borderRadius: 12, padding: 14 },
  hintTitle: { fontSize: 15, fontWeight: "600" },
  hintBody: { fontSize: 14, marginTop: 6, lineHeight: 21 },
  accordionHit: { marginTop: 14, alignSelf: "flex-start" },
  accordionLabel: { fontSize: 15, fontWeight: "600" },
  steps: { marginTop: 6, gap: 12 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { fontSize: 13, fontWeight: "700" },
  stepText: { flex: 1, fontSize: 14, lineHeight: 21 },
  security: { marginTop: 4, borderWidth: 1, borderRadius: 12, padding: 12 },
  securityTitle: { fontSize: 13, fontWeight: "700" },
  securityBody: { fontSize: 13, marginTop: 6, lineHeight: 19 },
  actions: { marginTop: 16, gap: 10 },
  actionBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  actionBtnText: { fontSize: 15, fontWeight: "600", textAlign: "center" },
});
