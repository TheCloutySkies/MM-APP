import { useRouter } from "expo-router";
import { useState } from "react";
import {
    Alert,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";
import { isAllowlistedUsername } from "@/constants/allowlist";
import { invokeMmLogin } from "@/lib/supabase/mmClient";
import { useMMStore } from "@/store/mmStore";

export default function LoginScreen() {
  const { width } = useWindowDimensions();
  const mmSize = Math.min(168, Math.max(88, width * 0.32));
  const router = useRouter();
  const login = useMMStore((s) => s.login);
  const setupComplete = useMMStore((s) => s.setupComplete);

  const [user, setUser] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const u = user.trim().toLowerCase();
    if (!isAllowlistedUsername(u)) {
      Alert.alert("Unauthorized", "Unknown username.");
      return;
    }
    setBusy(true);
    try {
      const { access_token, profile } = await invokeMmLogin(u, key);
      await login(access_token, profile.id, profile.username);
      router.replace(setupComplete ? "/(auth)/unlock" : "/(auth)/setup");
    } catch (e) {
      Alert.alert("Login failed", e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.shell, { backgroundColor: TacticalPalette.matteBlack }]}>
      <View style={styles.box}>
        <Text style={styles.kicker}>ACCESS</Text>
        <Text
          accessibilityRole="header"
          style={[
            styles.mmMark,
            {
              fontSize: mmSize,
              lineHeight: mmSize * 1.02,
              color: TacticalPalette.bone,
            },
          ]}>
          MM
        </Text>
        <Text style={[styles.note, { color: TacticalPalette.boneMuted }]}>
          Closed roster. No self-service registration. Username + team access key.
        </Text>
        <TextInput
          placeholder="Username"
          placeholderTextColor={TacticalPalette.boneMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={user}
          onChangeText={setUser}
          style={[
            styles.input,
            {
              borderColor: TacticalPalette.border,
              color: TacticalPalette.bone,
              backgroundColor: TacticalPalette.charcoal,
            },
          ]}
        />
        <TextInput
          placeholder="Access key"
          placeholderTextColor={TacticalPalette.boneMuted}
          secureTextEntry
          value={key}
          onChangeText={setKey}
          style={[
            styles.input,
            {
              borderColor: TacticalPalette.border,
              color: TacticalPalette.bone,
              backgroundColor: TacticalPalette.charcoal,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.btn,
            {
              backgroundColor: pressed ? TacticalPalette.accentDim : TacticalPalette.accent,
              opacity: busy ? 0.6 : 1,
            },
          ]}>
          <Text style={styles.btnTx}>Enter vault</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    width: "100%",
    alignItems: "center",
  },
  /** Same constraints as unlock — readable width on desktop, full width on phones */
  box: {
    flex: 1,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    padding: 24,
    justifyContent: "center",
    gap: 14,
    alignItems: "stretch",
  },
  kicker: {
    color: TacticalPalette.coyote,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: -4,
  },
  mmMark: {
    fontWeight: "900",
    letterSpacing: -6,
    textAlign: "center",
    marginBottom: 8,
  },
  note: { marginBottom: 8, fontSize: 14, textAlign: "center", lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    minHeight: 52,
  },
  btn: { paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  btnTx: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 16 },
});
