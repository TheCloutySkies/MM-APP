import { useRouter } from "expo-router";
import { useState } from "react";
import {
    Alert,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
    useColorScheme,
} from "react-native";

import Colors from "@/constants/Colors";
import { isAllowlistedUsername } from "@/constants/allowlist";
import { invokeMmLogin } from "@/lib/supabase/mmClient";
import { useMMStore } from "@/store/mmStore";

export default function LoginScreen() {
  const scheme = useColorScheme() ?? "light";
  const palette = Colors[scheme];
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
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Text style={[styles.hint, { color: palette.text }]}>
        Closed roster. No self-service registration.
      </Text>
      <TextInput
        placeholder="Username"
        placeholderTextColor="#888"
        autoCapitalize="none"
        autoCorrect={false}
        value={user}
        onChangeText={setUser}
        style={[styles.input, { color: palette.text, borderColor: palette.tabIconDefault }]}
      />
      <TextInput
        placeholder="Access key"
        placeholderTextColor="#888"
        secureTextEntry
        value={key}
        onChangeText={setKey}
        style={[styles.input, { color: palette.text, borderColor: palette.tabIconDefault }]}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void submit()}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: pressed ? palette.tabIconSelected : palette.tint, opacity: busy ? 0.6 : 1 },
        ]}>
        <Text style={styles.btnText}>Enter vault</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center", gap: 16 },
  hint: { fontSize: 14, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  btn: { paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
