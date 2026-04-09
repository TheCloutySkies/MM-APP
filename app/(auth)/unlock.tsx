import { useRouter } from "expo-router";
import { useState } from "react";
import {
    Alert,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from "react-native";

import { LayoutOverrideBar } from "@/components/layout/LayoutOverrideBar";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { bootstrapIdentityOnDevice, hasLocalIdentity } from "@/lib/e2ee/identity";
import { useMMStore } from "@/store/mmStore";

export default function UnlockScreen() {
  const { width } = useWindowDimensions();
  const mmSize = Math.min(168, Math.max(88, width * 0.32));
  const router = useRouter();
  const tryUnlock = useMMStore((s) => s.tryUnlock);
  const touchRealUnlock = useMMStore((s) => s.touchRealUnlock);
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);

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
      if (Platform.OS === "web" && r.mode === "main" && supabase && profileId) {
        const local = await hasLocalIdentity(profileId);
        if (!local) {
          const { error: msgErr } = await bootstrapIdentityOnDevice(supabase, profileId, pin);
          if (msgErr) console.warn("Team chat keys:", msgErr.message);
        }
      }
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
      <TextInput
        placeholder="Master password"
        placeholderTextColor={TacticalPalette.boneMuted}
        secureTextEntry
        value={master}
        onChangeText={setMaster}
        selectionColor={TacticalPalette.coyote}
        cursorColor={TacticalPalette.bone}
        underlineColorAndroid="transparent"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        importantForAutofill="yes"
        style={[
          styles.input,
          {
            borderColor: TacticalPalette.border,
            color: "#fffefb",
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
        selectionColor={TacticalPalette.coyote}
        cursorColor={TacticalPalette.bone}
        underlineColorAndroid="transparent"
        textContentType="password"
        importantForAutofill="yes"
        style={[
          styles.input,
          {
            borderColor: TacticalPalette.border,
            color: "#fffefb",
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
        <LayoutOverrideBar />
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
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, fontSize: 18, minHeight: 52 },
  btn: { paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  btnTx: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 16 },
});
