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
import { useMMStore } from "@/store/mmStore";

export default function UnlockScreen() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const router = useRouter();
  const tryUnlock = useMMStore((s) => s.tryUnlock);
  const touchRealUnlock = useMMStore((s) => s.touchRealUnlock);

  const [master, setMaster] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await tryUnlock(master, pin);
      if (!r.ok) {
        Alert.alert("Unable to open", "Check your credentials.");
        return;
      }
      if (r.mode === "main") await touchRealUnlock();
      router.replace("/(app)/vault");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.box, { backgroundColor: p.background }]}>
      <Text style={[styles.note, { color: p.text }]}>
        Same screen for primary or duress PIN. Master password + PIN.
      </Text>
      <TextInput
        placeholder="Master password"
        placeholderTextColor="#888"
        secureTextEntry
        value={master}
        onChangeText={setMaster}
        style={[styles.input, { borderColor: p.tabIconDefault, color: p.text }]}
      />
      <TextInput
        placeholder="PIN"
        placeholderTextColor="#888"
        keyboardType="number-pad"
        secureTextEntry
        value={pin}
        onChangeText={setPin}
        style={[styles.input, { borderColor: p.tabIconDefault, color: p.text }]}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void submit()}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: pressed ? p.tabIconSelected : p.tint, opacity: busy ? 0.6 : 1 },
        ]}>
        <Text style={styles.btnTx}>Unlock</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 24, justifyContent: "center", gap: 14 },
  note: { marginBottom: 8, fontSize: 14 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 18 },
  btn: { paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  btnTx: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
