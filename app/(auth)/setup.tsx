import { randomBytes } from "@noble/hashes/utils.js";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TacticalPalette } from "@/constants/TacticalTheme";
import { useMMStore } from "@/store/mmStore";

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const completeSetup = useMMStore((s) => s.completeSetup);

  const [master, setMaster] = useState("");
  const [pinP, setPinP] = useState("");
  const [pinD, setPinD] = useState("");
  const [busy, setBusy] = useState(false);

  const inputStyle = [
    styles.input,
    {
      borderColor: TacticalPalette.border,
      color: "#fffefb",
      backgroundColor: TacticalPalette.charcoal,
    },
  ];

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
    <KeyboardAvoidingView
      style={[styles.shell, { backgroundColor: TacticalPalette.matteBlack }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 8 : 0}>
      <ScrollView
        contentContainerStyle={[styles.wrap, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <Text style={[styles.para, { color: TacticalPalette.boneMuted }]}>
          Create a master password and two PINs. Only the primary PIN opens the real vault; the duress PIN opens an
          identical-looking decoy. There is no indication which PIN was accepted.
        </Text>
        <TextInput
          placeholder="Master password"
          placeholderTextColor={TacticalPalette.boneMuted}
          secureTextEntry
          value={master}
          onChangeText={setMaster}
          selectionColor={TacticalPalette.coyote}
          cursorColor={TacticalPalette.bone}
          underlineColorAndroid="transparent"
          textContentType="newPassword"
          autoCapitalize="none"
          style={inputStyle}
        />
        <TextInput
          placeholder="Primary PIN"
          placeholderTextColor={TacticalPalette.boneMuted}
          keyboardType="number-pad"
          secureTextEntry
          value={pinP}
          onChangeText={setPinP}
          selectionColor={TacticalPalette.coyote}
          cursorColor={TacticalPalette.bone}
          underlineColorAndroid="transparent"
          textContentType="oneTimeCode"
          style={inputStyle}
        />
        <TextInput
          placeholder="Duress PIN"
          placeholderTextColor={TacticalPalette.boneMuted}
          keyboardType="number-pad"
          secureTextEntry
          value={pinD}
          onChangeText={setPinD}
          selectionColor={TacticalPalette.coyote}
          cursorColor={TacticalPalette.bone}
          underlineColorAndroid="transparent"
          textContentType="oneTimeCode"
          style={inputStyle}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void run()}
          style={({ pressed }) => [
            styles.btn,
            {
              backgroundColor: pressed ? TacticalPalette.accentDim : TacticalPalette.accent,
              opacity: busy ? 0.6 : 1,
            },
          ]}>
          <Text style={styles.btnTx}>Save and continue</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  wrap: { padding: 24, gap: 14, flexGrow: 1, maxWidth: 520, alignSelf: "center", width: "100%" },
  para: { fontSize: 14, lineHeight: 20 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, minHeight: 52 },
  btn: { paddingVertical: 16, borderRadius: 12, alignItems: "center", marginTop: 8 },
  btnTx: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 16 },
});
