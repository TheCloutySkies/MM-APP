import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
    Alert,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
    useColorScheme,
} from "react-native";

import { DistressWebhookCard } from "@/components/settings/DistressWebhookCard";
import { SettingsSection } from "@/components/settings/SettingsSection";
import Colors from "@/constants/Colors";
import { deriveKeyArgon2id } from "@/lib/crypto/kdf";
import { buildEncryptedVaultExport, copyExportToClipboard } from "@/lib/p2p/exportVault";
import { useMMStore } from "@/store/mmStore";

export default function SettingsScreen() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const router = useRouter();
  const desktopMode = useMMStore((s) => s.desktopMode);
  const setDesktopMode = useMMStore((s) => s.setDesktopMode);
  const logout = useMMStore((s) => s.logout);
  const lock = useMMStore((s) => s.lock);
  const fullLock = useMMStore((s) => s.fullLock);
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const [exportPhrase, setExportPhrase] = useState("");

  const signalSos = async () => {
    /** `expo-location` is lazy-split on web; calling it triggers Metro `asyncRequire` → “Failed to fetch” in dev. */
    if (Platform.OS === "web") {
      let q = "MM DISTRESS SIGNAL";
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              q += ` ${pos.coords.latitude},${pos.coords.longitude}`;
              resolve();
            },
            () => resolve(),
            { timeout: 8000, maximumAge: 60_000 },
          );
        });
      }
      await Clipboard.setStringAsync(q);
      Alert.alert(
        "Signal (web)",
        "Signal links only work in the mobile app. Your distress text was copied — paste it into Signal (or any app) manually.",
      );
      return;
    }

    const Location = require("expo-location") as typeof import("expo-location");
    const perm = await Location.requestForegroundPermissionsAsync();
    let q = "MM DISTRESS SIGNAL";
    if (perm.status === "granted") {
      const pos = await Location.getCurrentPositionAsync({});
      q += ` ${pos.coords.latitude},${pos.coords.longitude}`;
    }
    const url = `sgnl://send?text=${encodeURIComponent(q)}`;
    const can = await Linking.canOpenURL(url);
    if (!can) {
      Alert.alert("Signal", "Signal is not installed or URL scheme unavailable.");
      return;
    }
    await Linking.openURL(url);
  };

  const smsDistress = async () => {
    if (Platform.OS === "web") {
      Alert.alert(
        "SMS",
        "Opening the system SMS app is not supported in the browser. Use the iOS or Android app, or copy a message manually.",
      );
      return;
    }
    const Location = require("expo-location") as typeof import("expo-location");
    const perm = await Location.requestForegroundPermissionsAsync();
    let body = "MM DISTRESS";
    if (perm.status === "granted") {
      const pos = await Location.getCurrentPositionAsync({});
      body += ` https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
    }
    await Linking.openURL(`sms:?&body=${encodeURIComponent(body)}`);
  };

  const runExport = async () => {
    if (!supabase || !profileId || exportPhrase.length < 8) {
      Alert.alert("Export", "Enter an export passphrase (8+ chars).");
      return;
    }
    try {
      const exportKey32 = await deriveKeyArgon2id(exportPhrase, "mm-p2p-export-salt-v1");
      const packed = await buildEncryptedVaultExport({ supabase, exportKey32 });
      exportKey32.fill(0);
      await copyExportToClipboard(packed);
      Alert.alert("Export", "Encrypted bundle copied to clipboard.");
    } catch (e) {
      Alert.alert("Export", e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: p.background }]}
      contentContainerStyle={styles.scrollInner}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <Text style={[styles.hero, { color: p.text }]}>Settings</Text>
      <Text style={[styles.heroSub, { color: p.tabIconDefault }]}>
        Session, distress routing, and data export.
      </Text>

      {Platform.OS === "web" ? (
        <SettingsSection
          title="Layout"
          subtitle="Wider screens can use a vertical tab rail instead of a bottom bar.">
          <View style={[styles.rowCard, { borderColor: p.tabIconDefault }]}>
            <Text style={[styles.rowLabel, { color: p.text }]}>Desktop-style navigation</Text>
            <Switch value={desktopMode} onValueChange={(v) => void setDesktopMode(v)} />
          </View>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="Emergency & distress"
        subtitle="Panic (long-press) can notify a server before wiping local keys. Other channels open outside the app.">
        <DistressWebhookCard />
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: p.tint, opacity: pressed ? 0.88 : 1 },
          ]}
          onPress={() => void signalSos()}>
          <Text style={[styles.secondaryBtnText, { color: p.text }]}>Signal SOS (deep link)</Text>
          <Text style={[styles.secondaryBtnHint, { color: p.tabIconDefault }]}>
            {Platform.OS === "web"
              ? "In the browser: copies distress text (optional browser location) for you to paste into Signal."
              : "Opens Signal with a prefilled message if installed."}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: p.tint, opacity: pressed ? 0.88 : 1 },
          ]}
          onPress={() => void smsDistress()}>
          <Text style={[styles.secondaryBtnText, { color: p.text }]}>SMS composer</Text>
          <Text style={[styles.secondaryBtnHint, { color: p.tabIconDefault }]}>
            Opens the system SMS app with location when permission is granted.
          </Text>
        </Pressable>
      </SettingsSection>

      <SettingsSection title="Air-gap export" subtitle="Encrypted vault bundle for offline transfer.">
        <TextInput
          placeholder="One-time export passphrase (8+ characters)"
          placeholderTextColor="#888"
          secureTextEntry
          value={exportPhrase}
          onChangeText={setExportPhrase}
          style={[styles.input, { color: p.text, borderColor: p.tabIconDefault, backgroundColor: p.background }]}
        />
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: p.tint, opacity: pressed ? 0.92 : 1 },
          ]}
          onPress={() => void runExport()}>
          <Text style={styles.primaryBtnText}>Build encrypted bundle → clipboard</Text>
        </Pressable>
      </SettingsSection>

      <SettingsSection title="Identity" subtitle="Non-secret handle for pairing or support.">
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: p.tabIconDefault, opacity: pressed ? 0.88 : 1 },
          ]}
          onPress={async () => {
            await Clipboard.setStringAsync(JSON.stringify({ u: username, id: profileId }, null, 0));
            Alert.alert("Clipboard", "Non-sensitive handle copied.");
          }}>
          <Text style={[styles.secondaryBtnText, { color: p.text }]}>Copy public handle</Text>
          <Text style={[styles.secondaryBtnHint, { color: p.tabIconDefault }]}>Username and profile id as JSON.</Text>
        </Pressable>
      </SettingsSection>

      <SettingsSection title="Session">
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: p.tabIconDefault, opacity: pressed ? 0.88 : 1 },
          ]}
          onPress={async () => {
            await lock();
            router.replace("/(auth)/unlock");
          }}>
          <Text style={[styles.secondaryBtnText, { color: p.text }]}>Lock</Text>
          <Text style={[styles.secondaryBtnHint, { color: p.tabIconDefault }]}>PIN screen; keeps session tokens.</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: p.tabIconDefault, opacity: pressed ? 0.88 : 1 },
          ]}
          onPress={async () => {
            await logout();
            router.replace("/(auth)/login");
          }}>
          <Text style={[styles.secondaryBtnText, { color: p.text }]}>Sign out</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.destructiveBtn,
            { opacity: pressed ? 0.9 : 1 },
          ]}
          onPress={async () => {
            await fullLock();
            router.replace("/(auth)/login");
          }}>
          <Text style={styles.destructiveBtnText}>Erase local keys + session</Text>
          <Text style={styles.destructiveHint}>Clears vault keys and stored tokens on this device.</Text>
        </Pressable>
      </SettingsSection>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollInner: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  hero: { fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  heroSub: { fontSize: 15, marginTop: 6, marginBottom: 8, lineHeight: 22 },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowLabel: { fontSize: 16, flex: 1, paddingRight: 12 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
  primaryBtn: { borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryBtn: { borderWidth: 1, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  secondaryBtnText: { fontSize: 16, fontWeight: "600" },
  secondaryBtnHint: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  destructiveBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "rgba(155,34,38,0.12)",
    borderWidth: 1,
    borderColor: "rgba(155,34,38,0.45)",
  },
  destructiveBtnText: { color: "#fca5a5", fontSize: 16, fontWeight: "600" },
  destructiveHint: { color: "rgba(252,165,165,0.75)", fontSize: 13, marginTop: 4, lineHeight: 18 },
});
