import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";

import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { probeMeshtasticHttp } from "@/lib/meshtastic";

const MESHTASTIC_DOCS = "https://meshtastic.org/docs/";
const MESHTASTIC_GITHUB = "https://github.com/meshtastic";

export default function IntegrationsScreen() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const [baseUrl, setBaseUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const runProbe = async () => {
    const u = baseUrl.trim();
    if (!u) {
      Alert.alert("Meshtastic", "Enter your node base URL (e.g. http://192.168.1.42)");
      return;
    }
    setProbing(true);
    setLastResult(null);
    try {
      const r = await probeMeshtasticHttp(u);
      setLastResult(`${r.ok ? "OK" : "Failed"}: ${r.message}`);
    } finally {
      setProbing(false);
    }
  };

  const inputStyle = [
    styles.input,
    {
      color: p.text,
      borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
      backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
    },
  ];

  return (
    <ScrollView style={[styles.wrap, { backgroundColor: p.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.h1, { color: p.text }]}>Integrations</Text>

      <Text style={[styles.section, { color: TacticalPalette.coyote }]}>Meshtastic (open source)</Text>
      <Text style={[styles.body, { color: p.tabIconDefault }]}>
        Meshtastic uses LoRa mesh radios. This app does not bundle a full Meshtastic client — use the official mobile
        app for Bluetooth provisioning. If your node exposes HTTP on Wi‑Fi (depends on firmware), you can probe it
        below from the same LAN. Browsers often block requests to private IPs (CORS); the native build is more likely to
        succeed.
      </Text>
      {Platform.OS === "web" ? (
        <Text style={[styles.warn, { color: TacticalPalette.accent }]}>
          Web: local HTTP probes may be blocked by the browser. Use the dev app or paste the GPX you exported from Map →
          Team GPX into desktop mesh tools.
        </Text>
      ) : null}
      <TextInput
        placeholder="http://192.168.x.x or http://meshtastic.local"
        placeholderTextColor="#888"
        value={baseUrl}
        onChangeText={setBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        style={inputStyle}
      />
      <Pressable
        style={[styles.btn, { backgroundColor: p.tint, opacity: probing ? 0.7 : 1 }]}
        disabled={probing}
        onPress={() => void runProbe()}>
        {probing ? (
          <ActivityIndicator color={scheme === "dark" ? "#0f172a" : "#fff"} />
        ) : (
          <Text style={[styles.btnTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>Probe HTTP API</Text>
        )}
      </Pressable>
      {lastResult ? (
        <Text style={[styles.mono, { color: p.text }]} selectable>
          {lastResult}
        </Text>
      ) : null}

      <Pressable style={[styles.linkBtn, { borderColor: p.tint }]} onPress={() => void Linking.openURL(MESHTASTIC_DOCS)}>
        <Text style={[styles.linkTx, { color: p.tint }]}>Meshtastic documentation</Text>
      </Pressable>
      <Pressable style={[styles.linkBtn, { borderColor: p.tabIconDefault }]} onPress={() => void Linking.openURL(MESHTASTIC_GITHUB)}>
        <Text style={[styles.linkTx, { color: p.tabIconDefault }]}>GitHub — meshtastic</Text>
      </Pressable>

      <Text style={[styles.section, { color: TacticalPalette.coyote, marginTop: 24 }]}>GPX & maps</Text>
      <Text style={[styles.body, { color: p.tabIconDefault }]}>
        Publish team tactical layers from <Text style={{ fontWeight: "800" }}>Map → Team GPX library</Text> as standard
        GPX files. You can import them into field GPS apps, QGIS, or share with anyone running Meshtastic-side utilities
        on a laptop.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, maxWidth: 720, alignSelf: "center", width: "100%" },
  h1: { fontSize: 22, fontWeight: "800", marginBottom: 12 },
  section: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 22, marginBottom: 12 },
  warn: { fontSize: 13, lineHeight: 20, marginBottom: 12, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 10 },
  btn: { paddingVertical: 14, borderRadius: 12, alignItems: "center", marginBottom: 12 },
  btnTx: { fontSize: 16, fontWeight: "800" },
  mono: { fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", lineHeight: 16, marginTop: 8 },
  linkBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  linkTx: { fontWeight: "700", fontSize: 15 },
});
