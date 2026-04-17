import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { Button, Card, Divider, Text } from "react-native-paper";

import { useLiveSocketContext } from "@/components/comms/LiveSocketProvider";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { useMMStore } from "@/store/mmStore";

export default function ProfileScreen() {
  const router = useRouter();
  const chrome = useTacticalChrome();
  const profileId = useMMStore((s) => s.profileId) ?? "";
  const username = useMMStore((s) => s.username) ?? "";
  const { status, presenceRoster, endpoint, error } = useLiveSocketContext();

  const others = presenceRoster
    .filter((u) => u.user_id !== profileId)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const epLabel = endpoint ? endpoint.replace(/^https?:\/\//, "").split("/")[0] : "—";

  const statusLabel =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting…"
        : status === "error"
          ? "Error"
          : "Offline";

  const copyId = async () => {
    if (!profileId) return;
    await Clipboard.setStringAsync(profileId);
    Alert.alert("Copied", "Profile ID copied to clipboard.");
  };

  return (
    <ScrollView style={[styles.wrap, { backgroundColor: chrome.background }]} contentContainerStyle={styles.content}>
      <Button mode="text" onPress={() => router.back()} icon="chevron-left" textColor={chrome.accent} style={styles.back}>
        Back
      </Button>
      <Text variant="headlineSmall" style={{ color: chrome.text, marginBottom: 16, fontWeight: "900" }}>
        Profile & presence
      </Text>

      <Card mode="elevated" style={styles.card}>
        <Card.Title title="Account" titleStyle={{ color: chrome.text }} />
        <Card.Content>
          <Text variant="bodyMedium" style={{ color: chrome.textMuted }}>
            Username
          </Text>
          <Text variant="titleMedium" style={{ color: chrome.text }}>
            {username || "—"}
          </Text>
          <Divider style={{ marginVertical: 12 }} />
          <Text variant="bodyMedium" style={{ color: chrome.textMuted }}>
            Profile ID
          </Text>
          <Text variant="bodySmall" style={{ color: chrome.text }} selectable>
            {profileId || "—"}
          </Text>
          {profileId ? (
            <Button mode="outlined" compact onPress={() => void copyId()} style={{ marginTop: 8 }} textColor={chrome.accent}>
              Copy ID
            </Button>
          ) : null}
        </Card.Content>
      </Card>

      <Card mode="elevated" style={styles.card}>
        <Card.Title title="Live comms" titleStyle={{ color: chrome.text }} />
        <Card.Content>
          <Text style={{ color: chrome.text }}>
            {statusLabel}
            {error ? ` — ${error}` : ""}
          </Text>
          <Text style={{ color: chrome.textMuted, marginTop: 8 }}>Server: {epLabel}</Text>
          <Text style={{ color: chrome.textMuted, marginTop: 12, fontSize: 12, lineHeight: 18 }}>
            Roster lists teammates with an active Socket.IO session to the chat server. Open Comms to use group chat and DMs.
          </Text>
        </Card.Content>
      </Card>

      <Card mode="elevated" style={styles.card}>
        <Card.Title title={`Online now (${others.length})`} titleStyle={{ color: chrome.text }} subtitle="Excluding you" subtitleStyle={{ color: chrome.textMuted }} />
        <Card.Content>
          {others.length === 0 ? (
            <Text style={{ color: chrome.textMuted }}>No other teammates connected.</Text>
          ) : (
            <View style={{ gap: 6 }}>
              {others.map((u) => (
                <View key={u.user_id} style={styles.rosterRow}>
                  <View style={styles.onlineDot} />
                  <Text style={{ color: chrome.text }}>{u.display_name}</Text>
                </View>
              ))}
            </View>
          )}
        </Card.Content>
      </Card>

      <Button
        mode="contained"
        onPress={() => router.push("/(app)/settings")}
        buttonColor={chrome.accent}
        textColor={TacticalPalette.matteBlack}>
        Open settings
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  back: { alignSelf: "flex-start", marginBottom: 8 },
  card: { marginBottom: 16, backgroundColor: TacticalPalette.elevated, borderWidth: 1, borderColor: TacticalPalette.border },
  rosterRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: TacticalPalette.success },
});
