import { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";
import { isOpsScreeningAnswerCorrect } from "@/lib/opsScreening";
import { useMMStore } from "@/store/mmStore";

/**
 * One-time (per device) gate after main-vault unlock: screening question, then stored universal team ops key.
 */
export function OpsScreeningGate() {
  const hydrated = useMMStore((s) => s.hydrated);
  const vaultMode = useMMStore((s) => s.vaultMode);
  const opsScreeningComplete = useMMStore((s) => s.opsScreeningComplete);
  const completeOpsScreening = useMMStore((s) => s.completeOpsScreening);

  const [blank, setBlank] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = hydrated && vaultMode === "main" && !opsScreeningComplete;

  const onSubmit = async () => {
    setError(null);
    if (!isOpsScreeningAnswerCorrect(blank)) {
      setError("Incorrect. Check the phrase and try again.");
      return;
    }
    setBusy(true);
    try {
      await completeOpsScreening();
      setBlank("");
      Alert.alert(
        "Access granted",
        "The universal team operations key is saved on this device. You can decrypt the same map and mission data as everyone else who completed screening (see Settings → Team operations key).",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not enable team key.";
      Alert.alert("Configuration needed", msg);
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.title}>Final screening</Text>
          <Text style={styles.sub}>
            Fill in the blank. Smell like you ____{"\n\n"}
            Enter the missing word to receive the universal operations key (shared unit decrypt).
          </Text>
          <TextInput
            accessibilityLabel="Fill in the blank answer"
            value={blank}
            onChangeText={setBlank}
            placeholder="Word"
            placeholderTextColor={TacticalPalette.boneMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            onSubmitEditing={() => void onSubmit()}
            returnKeyType="done"
            selectionColor={TacticalPalette.coyote}
            cursorColor={TacticalPalette.bone}
            underlineColorAndroid="transparent"
            style={styles.input}
          />
          {error ? <Text style={styles.err}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || blank.trim().length === 0}
            onPress={() => void onSubmit()}
            style={({ pressed }) => [
              styles.btn,
              {
                opacity: busy || blank.trim().length === 0 ? 0.55 : 1,
                backgroundColor: pressed ? TacticalPalette.accentDim : TacticalPalette.accent,
              },
            ]}>
            {busy ? (
              <ActivityIndicator color={TacticalPalette.bone} />
            ) : (
              <Text style={styles.btnTx}>Submit</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.82)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    maxWidth: 440,
    width: "100%" as const,
    alignSelf: "center",
    backgroundColor: TacticalPalette.charcoal,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    padding: 22,
    gap: 14,
  },
  title: {
    color: TacticalPalette.bone,
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  sub: {
    color: TacticalPalette.boneMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    color: "#fffefb",
    backgroundColor: TacticalPalette.elevated,
    minHeight: 52,
  },
  err: {
    color: "#e57373",
    fontSize: 13,
    textAlign: "center",
  },
  btn: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },
  btnTx: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 16 },
});
