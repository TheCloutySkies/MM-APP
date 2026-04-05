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
import { useMMStore } from "@/store/mmStore";

export default function UnlockScreen() {
  const { width } = useWindowDimensions();
  const mmSize = Math.min(168, Math.max(88, width * 0.32));
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
      router.replace("/(app)/home");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.shell, { backgroundColor: TacticalPalette.matteBlack }]}>
      <View style={styles.box}>
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
        Same screen for primary or duress PIN. Master password + PIN.
      </Text>
      <TextInput
        placeholder="Master password"
        placeholderTextColor={TacticalPalette.boneMuted}
        secureTextEntry
        value={master}
        onChangeText={setMaster}
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
        placeholder="PIN"
        placeholderTextColor={TacticalPalette.boneMuted}
        keyboardType="number-pad"
        secureTextEntry
        value={pin}
        onChangeText={setPin}
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
        <Text style={styles.btnTx}>Unlock</Text>
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
  mmMark: {
    fontWeight: "900",
    letterSpacing: -6,
    textAlign: "center",
    marginBottom: 8,
    marginTop: -24,
  },
  note: { marginBottom: 8, fontSize: 14, textAlign: "center", lineHeight: 20 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 18 },
  btn: { paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  btnTx: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 16 },
});
