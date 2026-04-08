import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
    ActivityIndicator,
    InteractionManager,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    CALLSIGN_GUIDANCE,
    CALLSIGN_SUGGESTIONS,
    normalizeCallsignInput,
    validateCallsign,
} from "@/constants/callsign";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { useMMStore } from "@/store/mmStore";

export default function CallsignScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const mmSize = Math.min(152, Math.max(72, width * 0.28));
  const router = useRouter();
  const profileId = useMMStore((s) => s.profileId);
  const supabase = useMMStore((s) => s.supabase);
  const setupComplete = useMMStore((s) => s.setupComplete);
  const syncMmProfileRow = useMMStore((s) => s.syncMmProfileRow);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goNext = async () => {
    const next = (setupComplete ? "/(auth)/unlock" : "/(auth)/setup") as Href;
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });
    router.replace(next);
  };

  const save = async () => {
    setError(null);
    const normalized = normalizeCallsignInput(draft);
    const msg = validateCallsign(normalized);
    if (msg) {
      setError(msg);
      return;
    }
    if (!supabase || !profileId) {
      setError("Session not ready. Go back and sign in again.");
      return;
    }
    setBusy(true);
    try {
      const { data: updatedRows, error: upErr } = await supabase
        .from("mm_profiles")
        .update({ username: normalized, callsign_ok: true })
        .eq("id", profileId)
        .select("id");

      if (upErr) {
        const code = (upErr as { code?: string }).code;
        const dup =
          code === "23505" ||
          upErr.message.toLowerCase().includes("unique") ||
          upErr.message.toLowerCase().includes("duplicate");
        if (dup) {
          setError("That handle is already taken. Pick another.");
        } else {
          setError(upErr.message);
        }
        return;
      }

      if (!updatedRows?.length) {
        const { error: insErr } = await supabase.from("mm_profiles").insert({
          id: profileId,
          username: normalized,
          callsign_ok: true,
          access_key_hash: null,
        });
        if (insErr) {
          const code = (insErr as { code?: string }).code;
          const dup =
            code === "23505" ||
            insErr.message.toLowerCase().includes("unique") ||
            insErr.message.toLowerCase().includes("duplicate");
          if (dup) {
            setError("That handle is already taken. Pick another.");
          } else {
            setError(
              insErr.message ||
                "Could not create your profile. Try signing out and back in, or contact support.",
            );
          }
          return;
        }
      }

      await syncMmProfileRow();
      await goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save callsign.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.shell, { backgroundColor: TacticalPalette.matteBlack }]}
      behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 8 : 0}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <View style={styles.box}>
          <Text style={styles.kicker}>CALLSIGN</Text>
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
          <Text style={[styles.guidance, { color: TacticalPalette.boneMuted }]}>{CALLSIGN_GUIDANCE}</Text>
          <Text style={[styles.examplesLabel, { color: TacticalPalette.coyote }]}>
            Examples (tap to use as a starting point)
          </Text>
          <View style={styles.chips}>
            {CALLSIGN_SUGGESTIONS.map((s) => (
              <Pressable
                key={s}
                onPress={() => {
                  setDraft(s);
                  setError(null);
                }}
                style={({ pressed }) => [
                  styles.chip,
                  { opacity: pressed ? 0.85 : 1, borderColor: TacticalPalette.border },
                ]}>
                <Text style={styles.chipTx}>{s}</Text>
              </Pressable>
            ))}
          </View>
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <TextInput
            placeholder="your-callsign"
            placeholderTextColor={TacticalPalette.boneMuted}
            autoCapitalize="none"
            autoCorrect={false}
            selectionColor={TacticalPalette.coyote}
            cursorColor={TacticalPalette.bone}
            underlineColorAndroid="transparent"
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              if (error) setError(null);
            }}
            style={[
              styles.input,
              {
                borderColor: error ? TacticalPalette.accent : TacticalPalette.border,
                color: TacticalPalette.bone,
                backgroundColor: TacticalPalette.charcoal,
              },
            ]}
          />
          <Text style={[styles.hint, { color: TacticalPalette.boneMuted }]}>
            Lowercase kebab-case only — NATO words (alpha, bravo, charlie…) or a short codename. You can edit the
            suggestion.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.btn,
              {
                backgroundColor: pressed ? TacticalPalette.accentDim : TacticalPalette.accent,
                opacity: busy ? 0.75 : 1,
              },
            ]}>
            {busy ? (
              <ActivityIndicator color={TacticalPalette.bone} />
            ) : (
              <Text style={styles.btnTx}>Save callsign & continue</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, width: "100%" },
  scrollContent: { flexGrow: 1, alignItems: "center" },
  box: {
    flex: 1,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    padding: 24,
    gap: 12,
    paddingBottom: 40,
  },
  kicker: {
    color: TacticalPalette.coyote,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 24,
  },
  mmMark: {
    fontWeight: "900",
    letterSpacing: -6,
    textAlign: "center",
    marginBottom: 4,
  },
  guidance: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  examplesLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5, marginTop: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: TacticalPalette.charcoal,
  },
  chipTx: { color: TacticalPalette.bone, fontSize: 13, fontWeight: "600" },
  errorBanner: {
    backgroundColor: "rgba(139, 90, 60, 0.25)",
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 10,
    padding: 12,
  },
  errorText: { color: TacticalPalette.bone, fontSize: 14, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    minHeight: 52,
  },
  hint: { fontSize: 13, lineHeight: 18 },
  btn: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
    marginTop: 8,
  },
  btnTx: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 16 },
});
