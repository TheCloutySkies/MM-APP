import { randomBytes } from "@noble/hashes/utils.js";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    useColorScheme
} from "react-native";

import Colors from "@/constants/Colors";
import { useMMStore } from "@/store/mmStore";

export default function SetupScreen() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const router = useRouter();
  const completeSetup = useMMStore((s) => s.completeSetup);

  const [master, setMaster] = useState("");
  const [pinP, setPinP] = useState("");
  const [pinD, setPinD] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (master.length < 8) {
      Alert.alert("Master password", "Use at least 8 characters.");
      return;
    }
    if (pinP.length < 4 || pinD.length < 4) {
      Alert.alert("PINs", "PINs must be at least 4 digits.");
      return;
    }
    if (pinP === pinD) {
      Alert.alert("PINs", "Primary and duress PINs must differ.");
      return;
    }
    setBusy(true);
    try {
      const mainVaultKey = randomBytes(32);
      const decoyVaultKey = randomBytes(32);
      await completeSetup({
        masterPassword: master,
        primaryPin: pinP,
        duressPin: pinD,
        mainVaultKey,
        decoyVaultKey,
      });
      mainVaultKey.fill(0);
      decoyVaultKey.fill(0);
      setMaster("");
      setPinP("");
      setPinD("");
      router.replace("/(auth)/unlock");
    } catch (e) {
      Alert.alert("Setup failed", e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.wrap, { backgroundColor: p.background }]}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.para, { color: p.text }]}>
        Create a master password and two PINs. Only the primary PIN opens the real vault; the duress
        PIN opens an identical-looking decoy. There is no indication which PIN was accepted.
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
        placeholder="Primary PIN"
        placeholderTextColor="#888"
        keyboardType="number-pad"
        secureTextEntry
        value={pinP}
        onChangeText={setPinP}
        style={[styles.input, { borderColor: p.tabIconDefault, color: p.text }]}
      />
      <TextInput
        placeholder="Duress PIN"
        placeholderTextColor="#888"
        keyboardType="number-pad"
        secureTextEntry
        value={pinD}
        onChangeText={setPinD}
        style={[styles.input, { borderColor: p.tabIconDefault, color: p.text }]}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void run()}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: pressed ? p.tabIconSelected : p.tint, opacity: busy ? 0.6 : 1 },
        ]}>
        <Text style={styles.btnTx}>Save and continue</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 24, gap: 14, flexGrow: 1 },
  para: { fontSize: 14, lineHeight: 20 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  btn: { paddingVertical: 16, borderRadius: 12, alignItems: "center", marginTop: 8 },
  btnTx: { color: "#fff", fontWeight: "700" },
});
