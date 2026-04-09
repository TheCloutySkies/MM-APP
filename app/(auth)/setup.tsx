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
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LayoutOverrideBar } from "@/components/layout/LayoutOverrideBar";
import { TacticalPalette } from "@/constants/TacticalTheme";
import type { LayoutPreference } from "@/lib/layout/layoutPreference";
import { bootstrapIdentityOnDevice } from "@/lib/e2ee/identity";
import { syncCalendarPinsAfterSetup } from "@/lib/supabase/calendarProfile";
import { updateProfileLayoutPreference } from "@/lib/supabase/profileLayout";
import { useMMStore } from "@/store/mmStore";

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const completeSetup = useMMStore((s) => s.completeSetup);
  const setLayoutTriPreference = useMMStore((s) => s.setLayoutTriPreference);
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);

  const [master, setMaster] = useState("");
  const [pinP, setPinP] = useState("");
  const [pinD, setPinD] = useState("");
  const [iface, setIface] = useState<LayoutPreference | null>(null);
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
    if (!iface) {
      Alert.alert("Interface", "Select your primary interface layout (mobile, desktop, or auto).");
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
      if (supabase && profileId) {
        const { error: layoutErr } = await updateProfileLayoutPreference(supabase, profileId, iface);
        if (layoutErr) {
          Alert.alert(
            "Display preference",
            "Could not save layout to your server profile. You can change it later in Settings.",
          );
        }
        const { error: calErr } = await syncCalendarPinsAfterSetup(supabase, profileId, pinP, pinD);
        if (calErr) {
          Alert.alert(
            "Calendar sync",
            "Could not save calendar PIN verification to your profile. Calendar duress routing may be limited until you sign in online again.",
          );
        }
        if (Platform.OS === "web") {
          const { error: msgKeyErr } = await bootstrapIdentityOnDevice(supabase, profileId, pinP);
          if (msgKeyErr) {
            console.warn("Team chat keys:", msgKeyErr.message);
          }
        }
      }
      await setLayoutTriPreference(iface);
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
        <Text style={[styles.subhdr, { color: TacticalPalette.bone }]}>Select primary interface</Text>
        <Text style={[styles.paraSm, { color: TacticalPalette.boneMuted }]}>
          Syncs to your roster profile so your layout follows you across devices.
        </Text>
        <View style={styles.ifaceRow}>
          {(
            [
              { id: "mobile" as const, t: "Mobile tactical", d: "Phone / narrow screens" },
              { id: "desktop" as const, t: "Desktop war room", d: "Side rail, wide tools" },
              { id: "auto" as const, t: "Match device", d: "Switch by screen width" },
            ] as const
          ).map((opt) => (
            <Pressable
              key={opt.id}
              accessibilityRole="button"
              onPress={() => setIface(opt.id)}
              style={[
                styles.ifaceCard,
                iface === opt.id ? styles.ifaceCardOn : { borderColor: TacticalPalette.border },
              ]}>
              <Text style={[styles.ifaceTitle, { color: TacticalPalette.bone }]}>{opt.t}</Text>
              <Text style={[styles.ifaceSub, { color: TacticalPalette.boneMuted }]}>{opt.d}</Text>
            </Pressable>
          ))}
        </View>
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
        <LayoutOverrideBar />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  wrap: { padding: 24, gap: 14, flexGrow: 1, maxWidth: 520, alignSelf: "center", width: "100%" },
  para: { fontSize: 14, lineHeight: 20 },
  paraSm: { fontSize: 12, lineHeight: 17 },
  subhdr: { fontSize: 15, fontWeight: "800", marginTop: 4 },
  ifaceRow: { gap: 10 },
  ifaceCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    backgroundColor: TacticalPalette.charcoal,
  },
  ifaceCardOn: {
    borderColor: TacticalPalette.coyote,
    backgroundColor: "rgba(107, 142, 92, 0.12)",
  },
  ifaceTitle: { fontSize: 15, fontWeight: "800", marginBottom: 4 },
  ifaceSub: { fontSize: 12, lineHeight: 16 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, minHeight: 52 },
  btn: { paddingVertical: 16, borderRadius: 12, alignItems: "center", marginTop: 8 },
  btnTx: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 16 },
});
