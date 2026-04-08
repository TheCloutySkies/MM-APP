import Slider from "@react-native-community/slider";
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
} from "react-native";

import { useLayoutController } from "@/components/layout/LayoutProvider";
import { DistressWebhookCard } from "@/components/settings/DistressWebhookCard";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { MAIN_TAB_LABEL, MAIN_TAB_ROUTE_ORDER } from "@/constants/mainTabs";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { deriveKeyArgon2id } from "@/lib/crypto/kdf";
import { buildEncryptedVaultExport, copyExportToClipboard } from "@/lib/p2p/exportVault";
import { MAP_NIGHT_DIM, useMMStore } from "@/store/mmStore";

export default function SettingsScreen() {
  const chrome = useTacticalChrome();
  const router = useRouter();
  const visualTheme = useMMStore((s) => s.visualTheme);
  const setVisualTheme = useMMStore((s) => s.setVisualTheme);
  const mapNightDimPercent = useMMStore((s) => s.mapNightDimPercent);
  const setMapNightDimPercent = useMMStore((s) => s.setMapNightDimPercent);
  const { preference: layoutPref, setLayoutPreferenceFull } = useLayoutController();
  const logout = useMMStore((s) => s.logout);
  const lock = useMMStore((s) => s.lock);
  const fullLock = useMMStore((s) => s.fullLock);
  const tabBarOrder = useMMStore((s) => s.tabBarOrder);
  const setTabBarOrder = useMMStore((s) => s.setTabBarOrder);
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

  const moveTab = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= tabBarOrder.length) return;
    const next = [...tabBarOrder];
    [next[index], next[j]] = [next[j]!, next[index]!];
    void setTabBarOrder(next);
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
      style={[styles.screen, { backgroundColor: chrome.background }]}
      contentContainerStyle={styles.scrollInner}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <Text style={[styles.hero, { color: chrome.text }]}>Settings</Text>
      <Text style={[styles.heroSub, { color: chrome.tabIconDefault }]}>
        Session, distress routing, and data export.
      </Text>

      <SettingsSection
        title="Appearance"
        subtitle="Woodland tactical chrome, or Night Ops — near-black UI with crimson accents to cut glare and visible glow (device-style).">
        <View style={[styles.rowCard, { borderColor: chrome.tabIconDefault }]}>
          <Text style={[styles.rowLabel, { color: chrome.text }]}>Night Ops mode</Text>
          <Switch
            value={visualTheme === "nightops"}
            onValueChange={(v) => void setVisualTheme(v ? "nightops" : "woodland")}
          />
        </View>
        {visualTheme === "nightops" ? (
          <View style={[styles.dimCard, { borderColor: chrome.tabIconDefault }]}>
            <Text style={[styles.rowLabel, { color: chrome.text }]}>Map darkness</Text>
            <Text style={[styles.dimHint, { color: chrome.tabIconDefault }]}>
              Lowers basemap brightness while Night Ops is on. Does not change stored map data.
            </Text>
            <View style={styles.sliderRow}>
              <Text style={{ color: chrome.tabIconDefault, fontSize: 12 }}>Off</Text>
              <Slider
                style={styles.slider}
                minimumValue={MAP_NIGHT_DIM.min}
                maximumValue={MAP_NIGHT_DIM.max}
                step={1}
                value={mapNightDimPercent}
                onSlidingComplete={(v) => void setMapNightDimPercent(Math.round(v))}
                onValueChange={(v) => {
                  useMMStore.setState({ mapNightDimPercent: Math.round(v) });
                }}
                minimumTrackTintColor={chrome.tint}
                maximumTrackTintColor={chrome.border}
                thumbTintColor={Platform.OS === "ios" ? undefined : chrome.tint}
              />
              <Text style={{ color: chrome.tabIconDefault, fontSize: 12 }}>Max</Text>
            </View>
            <Text style={[styles.dimValue, { color: chrome.text }]}>{mapNightDimPercent}%</Text>
          </View>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Display & interface"
        subtitle="Mobile tactical, desktop war room, or match screen width. Saved to your profile and applied on every device after sign-in.">
        <View style={[styles.segWrap, { borderColor: chrome.tabIconDefault }]}>
          {(
            [
              { id: "mobile" as const, label: "Mobile" },
              { id: "auto" as const, label: "Auto" },
              { id: "desktop" as const, label: "Desktop" },
            ] as const
          ).map((opt) => (
            <Pressable
              key={opt.id}
              accessibilityRole="button"
              onPress={() => void setLayoutPreferenceFull(opt.id)}
              style={[
                styles.segBtn,
                {
                  borderColor: layoutPref === opt.id ? chrome.tint : chrome.tabIconDefault,
                  backgroundColor: layoutPref === opt.id ? `${chrome.tint}22` : "transparent",
                },
              ]}>
              <Text style={[styles.segBtnTx, { color: chrome.text }]}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </SettingsSection>

      <SettingsSection
        title="Navigation rail"
        subtitle="Reorder main tabs. On web, drag icons on the rail or drop Home modules onto the rail; long-press those cards on mobile to pin.">
        {tabBarOrder.map((id, i) => (
          <View
            key={id}
            style={[
              styles.rowCard,
              { borderColor: chrome.tabIconDefault, marginBottom: 10, justifyContent: "space-between" },
            ]}>
            <Text style={[styles.rowLabel, { color: chrome.text }]}>{MAIN_TAB_LABEL[id]}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => moveTab(i, -1)}
                disabled={i === 0}
                style={({ pressed }) => [
                  styles.tabOrderBtn,
                  { borderColor: chrome.tabIconDefault, opacity: i === 0 ? 0.35 : pressed ? 0.82 : 1 },
                ]}>
                <Text style={{ color: chrome.text, fontWeight: "800" }}>↑</Text>
              </Pressable>
              <Pressable
                onPress={() => moveTab(i, 1)}
                disabled={i === tabBarOrder.length - 1}
                style={({ pressed }) => [
                  styles.tabOrderBtn,
                  {
                    borderColor: chrome.tabIconDefault,
                    opacity: i === tabBarOrder.length - 1 ? 0.35 : pressed ? 0.82 : 1,
                  },
                ]}>
                <Text style={{ color: chrome.text, fontWeight: "800" }}>↓</Text>
              </Pressable>
            </View>
          </View>
        ))}
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: chrome.tint, opacity: pressed ? 0.88 : 1, marginTop: 4 },
          ]}
          onPress={() => void setTabBarOrder([...MAIN_TAB_ROUTE_ORDER])}>
          <Text style={[styles.secondaryBtnText, { color: chrome.text }]}>Reset tab order</Text>
        </Pressable>
      </SettingsSection>

      <SettingsSection
        title="Emergency & distress"
        subtitle="Panic (long-press) can notify a server before wiping local keys. Other channels open outside the app.">
        <DistressWebhookCard />
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: chrome.tint, opacity: pressed ? 0.88 : 1 },
          ]}
          onPress={() => void signalSos()}>
          <Text style={[styles.secondaryBtnText, { color: chrome.text }]}>Signal SOS (deep link)</Text>
          <Text style={[styles.secondaryBtnHint, { color: chrome.tabIconDefault }]}>
            {Platform.OS === "web"
              ? "In the browser: copies distress text (optional browser location) for you to paste into Signal."
              : "Opens Signal with a prefilled message if installed."}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: chrome.tint, opacity: pressed ? 0.88 : 1 },
          ]}
          onPress={() => void smsDistress()}>
          <Text style={[styles.secondaryBtnText, { color: chrome.text }]}>SMS composer</Text>
          <Text style={[styles.secondaryBtnHint, { color: chrome.tabIconDefault }]}>
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
          style={[styles.input, { color: chrome.text, borderColor: chrome.tabIconDefault, backgroundColor: chrome.background }]}
        />
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: chrome.tint, opacity: pressed ? 0.92 : 1 },
          ]}
          onPress={() => void runExport()}>
          <Text style={styles.primaryBtnText}>Build encrypted bundle → clipboard</Text>
        </Pressable>
      </SettingsSection>

      <SettingsSection title="Identity" subtitle="Non-secret handle for pairing or support.">
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: chrome.tabIconDefault, opacity: pressed ? 0.88 : 1 },
          ]}
          onPress={async () => {
            await Clipboard.setStringAsync(JSON.stringify({ u: username, id: profileId }, null, 0));
            Alert.alert("Clipboard", "Non-sensitive handle copied.");
          }}>
          <Text style={[styles.secondaryBtnText, { color: chrome.text }]}>Copy public handle</Text>
          <Text style={[styles.secondaryBtnHint, { color: chrome.tabIconDefault }]}>Username and profile id as JSON.</Text>
        </Pressable>
      </SettingsSection>

      <SettingsSection title="Session">
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: chrome.tabIconDefault, opacity: pressed ? 0.88 : 1 },
          ]}
          onPress={async () => {
            await lock();
            router.replace("/(auth)/unlock");
          }}>
          <Text style={[styles.secondaryBtnText, { color: chrome.text }]}>Lock</Text>
          <Text style={[styles.secondaryBtnHint, { color: chrome.tabIconDefault }]}>PIN screen; keeps session tokens.</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: chrome.tabIconDefault, opacity: pressed ? 0.88 : 1 },
          ]}
          onPress={async () => {
            await logout();
            router.replace("/(auth)/login");
          }}>
          <Text style={[styles.secondaryBtnText, { color: chrome.text }]}>Sign out</Text>
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
  dimCard: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 8,
  },
  dimHint: { fontSize: 13, lineHeight: 18 },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  slider: { flex: 1, height: 40 },
  dimValue: { fontSize: 14, fontWeight: "700", textAlign: "center" },
  segWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
  },
  segBtn: {
    flex: 1,
    minWidth: 88,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  segBtnTx: { fontSize: 15, fontWeight: "700" },
  tabOrderBtn: {
    minWidth: 44,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
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
