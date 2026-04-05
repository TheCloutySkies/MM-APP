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

import { TacticalPalette } from "@/constants/TacticalTheme";
import { isAllowlistedUsername } from "@/constants/allowlist";
import { getAuthSupabase } from "@/lib/supabase/authSupabase";
import { invokeMmLogin, mmLoginErrorMessage } from "@/lib/supabase/mmClient";
import { useMMStore } from "@/store/mmStore";

type AuthMode = "signIn" | "signUp";

export default function LoginScreen() {
  const { width } = useWindowDimensions();
  const mmSize = Math.min(168, Math.max(88, width * 0.32));
  const router = useRouter();
  const mmLogin = useMMStore((s) => s.login);

  const [authMode, setAuthMode] = useState<AuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showLegacy, setShowLegacy] = useState(false);
  const [user, setUser] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const goNextAfterSession = async () => {
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });
    const { callsignOk, setupComplete } = useMMStore.getState();
    if (!callsignOk) {
      router.replace("/(auth)/callsign" as Href);
      return;
    }
    const next = (setupComplete ? "/(auth)/unlock" : "/(auth)/setup") as Href;
    router.replace(next);
  };

  const submitEmailAuth = async () => {
    setError(null);
    setInfo(null);
    const e = email.trim().toLowerCase();
    if (!e || !password) {
      setError("Enter email and password.");
      return;
    }
    if (authMode === "signUp") {
      if (password.length < 8) {
        setError("Use a password with at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
    }

    setBusy(true);
    try {
      const supabase = getAuthSupabase();
      if (authMode === "signUp") {
        const { data, error: suErr } = await supabase.auth.signUp({
          email: e,
          password,
        });
        if (suErr) {
          setError(suErr.message);
          return;
        }
        if (data.session && data.user) {
          await mmLogin(data.session.access_token, data.user.id, data.user.email ?? e, "auth");
          await goNextAfterSession();
          return;
        }
        setInfo(
          "Account created. If email confirmation is on for your project, open the link in your mail, then tap Sign in.",
        );
        setAuthMode("signIn");
        return;
      }

      const { data, error: siErr } = await supabase.auth.signInWithPassword({
        email: e,
        password,
      });
      if (siErr) {
        setError(siErr.message);
        return;
      }
      if (!data.session?.user) {
        setError("No session returned. Confirm your email if the project requires it.");
        return;
      }
      await mmLogin(data.session.access_token, data.session.user.id, data.session.user.email ?? e, "auth");
      await goNextAfterSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitLegacy = async () => {
    setError(null);
    setInfo(null);
    const u = user.trim().toLowerCase();
    const k = key.trim();
    if (!u || !k) {
      setError("Enter both username and access key.");
      return;
    }
    if (!isAllowlistedUsername(u)) {
      setError(
        "Unknown username on this app for team login. Use email sign-in above, or ask for roster access.",
      );
      return;
    }
    setBusy(true);
    try {
      const { access_token, profile } = await invokeMmLogin(u, k);
      await mmLogin(access_token, profile.id, profile.username, "legacy");
      await goNextAfterSession();
    } catch (e) {
      setError(mmLoginErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.shell, { backgroundColor: TacticalPalette.matteBlack }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
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
            {authMode === "signIn"
              ? "Sign in with your email and password."
              : "Create an account with email and password — no access keys or SQL."}
          </Text>

          <View style={styles.segment}>
            <Pressable
              onPress={() => {
                setAuthMode("signIn");
                setError(null);
                setInfo(null);
              }}
              style={[styles.segmentBtn, authMode === "signIn" && styles.segmentBtnOn]}>
              <Text style={[styles.segmentTx, authMode === "signIn" && styles.segmentTxOn]}>Sign in</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setAuthMode("signUp");
                setError(null);
                setInfo(null);
              }}
              style={[styles.segmentBtn, authMode === "signUp" && styles.segmentBtnOn]}>
              <Text style={[styles.segmentTx, authMode === "signUp" && styles.segmentTxOn]}>Create account</Text>
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorBanner} accessibilityLiveRegion="polite">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {info ? (
            <View style={styles.infoBanner}>
              <Text style={styles.infoText}>{info}</Text>
            </View>
          ) : null}

          <TextInput
            placeholder="Email"
            placeholderTextColor={TacticalPalette.boneMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
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
          <TextInput
            placeholder="Password"
            placeholderTextColor={TacticalPalette.boneMuted}
            secureTextEntry
            textContentType={authMode === "signUp" ? "newPassword" : "password"}
            autoComplete={authMode === "signUp" ? "password-new" : "password"}
            value={password}
            onChangeText={(t) => {
              setPassword(t);
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
          {authMode === "signUp" ? (
            <TextInput
              placeholder="Confirm password"
              placeholderTextColor={TacticalPalette.boneMuted}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="password-new"
              value={confirm}
              onChangeText={(t) => {
                setConfirm(t);
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
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void submitEmailAuth()}
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
              <Text style={styles.btnTx}>{authMode === "signUp" ? "Create account" : "Sign in"}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              setShowLegacy((v) => !v);
              setError(null);
            }}
            style={styles.linkBtn}>
            <Text style={styles.linkTx}>{showLegacy ? "Hide team access key login" : "Team access key (legacy)"}</Text>
          </Pressable>

          {showLegacy ? (
            <View style={styles.legacyBox}>
              <Text style={[styles.legacyHint, { color: TacticalPalette.boneMuted }]}>
                For pre-provisioned roster accounts only. Prefer email sign-in above.
              </Text>
              <TextInput
                placeholder="Username (e.g. charlie-sierra)"
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
                onPress={() => void submitLegacy()}
                style={({ pressed }) => [
                  styles.btnSecondary,
                  { borderColor: pressed ? TacticalPalette.bone : TacticalPalette.border },
                ]}>
                <Text style={styles.btnSecondaryTx}>Authorize with access key</Text>
              </Pressable>
            </View>
          ) : null}
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
    justifyContent: "center",
    gap: 12,
    alignItems: "stretch",
    paddingBottom: 40,
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
  note: { marginBottom: 4, fontSize: 14, textAlign: "center", lineHeight: 20 },
  segment: { flexDirection: "row", gap: 8, marginBottom: 4 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    alignItems: "center",
    backgroundColor: TacticalPalette.charcoal,
  },
  segmentBtnOn: { borderColor: TacticalPalette.coyote, backgroundColor: "rgba(139, 90, 60, 0.2)" },
  segmentTx: { color: TacticalPalette.boneMuted, fontWeight: "600", fontSize: 14 },
  segmentTxOn: { color: TacticalPalette.bone },
  errorBanner: {
    backgroundColor: "rgba(139, 90, 60, 0.25)",
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 10,
    padding: 12,
  },
  errorText: { color: TacticalPalette.bone, fontSize: 14, lineHeight: 20 },
  infoBanner: {
    backgroundColor: "rgba(80, 120, 90, 0.25)",
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 10,
    padding: 12,
  },
  infoText: { color: TacticalPalette.bone, fontSize: 14, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    minHeight: 52,
  },
  btn: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },
  btnTx: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 16 },
  linkBtn: { paddingVertical: 8, alignItems: "center" },
  linkTx: { color: TacticalPalette.coyote, fontSize: 13, fontWeight: "600" },
  legacyBox: { gap: 12, marginTop: 8, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: TacticalPalette.border },
  legacyHint: { fontSize: 13, lineHeight: 18 },
  btnSecondary: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
  },
  btnSecondaryTx: { color: TacticalPalette.bone, fontWeight: "600", fontSize: 15 },
});
