import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TacticalPalette } from "@/constants/TacticalTheme";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { decryptActivityPayloadJson } from "@/lib/activityLog/crypto";
import type { ActivityLogPlainPayloadV1, ActivityLogRow } from "@/lib/activityLog/types";
import { hasLocalIdentity, unlockIdentityPrivateKey } from "@/lib/e2ee/identity";
import { loadGlobalGroupKeyForMember } from "@/lib/e2ee/groupKeys";
import { classifyVaultCredential } from "@/lib/vault/classifyVaultCredential";
import { formatVaultListDate } from "@/lib/vaultNaming";
import { useMMStore } from "@/store/mmStore";

type FeedItem = { kind: "real"; row: ActivityLogRow; plain: ActivityLogPlainPayloadV1 };

type DecoyItem = { label: string; sub: string; ts: number };

function buildDecoyFeed(): DecoyItem[] {
  const users = ["shadow-actual", "nomad-seven", "ghost-mike", "delta-echo", "romeo-nine"];
  const verbs = [
    "Adjusted workspace layout",
    "Synced notification preferences",
    "Exported weekly summary",
    "Archived inactive channels",
    "Updated privacy settings",
  ];
  const out: DecoyItem[] = [];
  for (let i = 0; i < 14; i += 1) {
    const u = users[Math.floor(Math.random() * users.length)]!;
    const v = verbs[Math.floor(Math.random() * verbs.length)]!;
    out.push({
      label: `${u} · routine account event`,
      sub: v,
      ts: Date.now() - i * 3600_000 - Math.floor(Math.random() * 1800_000),
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export default function ActivityLogScreen() {
  const chrome = useTacticalChrome();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const setupComplete = useMMStore((s) => s.setupComplete);
  const setMapFocusMarkerId = useMMStore((s) => s.setMapFocusMarkerId);
  const setVaultFocusObjectId = useMMStore((s) => s.setVaultFocusObjectId);

  const [masterPw, setMasterPw] = useState("");
  const [pin, setPin] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decoyMode, setDecoyMode] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [sessionTeamKey, setSessionTeamKey] = useState<Uint8Array | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);

  const decoyFeed = useMemo(() => buildDecoyFeed(), [decoyMode]);

  useEffect(() => {
    return () => {
      sessionTeamKey?.fill(0);
    };
  }, [sessionTeamKey]);

  const openRow = useCallback(
    (plain: ActivityLogPlainPayloadV1) => {
      if (plain.type === "MAP_PIN") {
        setMapFocusMarkerId(plain.ref);
        router.push("/map");
        return;
      }
      if (plain.type === "VAULT_FILE") {
        setVaultFocusObjectId(plain.ref);
        router.push("/vault");
      }
    },
    [router, setMapFocusMarkerId, setVaultFocusObjectId],
  );

  const loadFeed = useCallback(async () => {
    if (!supabase || !profileId || !sessionTeamKey) return;
    const { data, error } = await supabase
      .from("activity_logs")
      .select("id, actor_id, encrypted_payload, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) {
      setGateError(error.message);
      return;
    }
    const rows = (data ?? []) as ActivityLogRow[];
    const next: FeedItem[] = [];
    for (const row of rows) {
      const plain = await decryptActivityPayloadJson(sessionTeamKey, row.encrypted_payload);
      if (plain) next.push({ kind: "real", row, plain });
    }
    setItems(next);
  }, [supabase, profileId, sessionTeamKey]);

  useEffect(() => {
    if (unlocked && !decoyMode && sessionTeamKey) void loadFeed();
  }, [unlocked, decoyMode, sessionTeamKey, loadFeed]);

  const runGate = async () => {
    setGateError(null);
    if (Platform.OS !== "web") {
      setGateError("Activity audit decrypt runs in the browser (Web Crypto).");
      return;
    }
    if (!setupComplete) {
      setGateError("Finish vault setup first.");
      return;
    }
    if (!masterPw.trim() || !pin.trim()) {
      setGateError("Enter master password and PIN.");
      return;
    }
    if (!supabase || !profileId) {
      setGateError("Sign in first.");
      return;
    }
    setBusy(true);
    try {
      const bucket = await classifyVaultCredential(masterPw.trim(), pin.trim());
      if (bucket === "fail") {
        setGateError("Credentials do not match this device.");
        return;
      }
      if (bucket === "duress") {
        setDecoyMode(true);
        setUnlocked(true);
        setMasterPw("");
        setPin("");
        return;
      }

      const hasId = await hasLocalIdentity(profileId);
      if (!hasId) {
        setGateError("Open Team chat once on this browser to create encryption keys, then return here.");
        return;
      }
      const { privateKey, error: pkErr } = await unlockIdentityPrivateKey(profileId, pin.trim());
      if (pkErr || !privateKey) {
        setGateError(pkErr?.message ?? "Could not unlock identity key.");
        return;
      }
      const { groupKey, error: gErr } = await loadGlobalGroupKeyForMember(supabase, profileId, privateKey);
      if (gErr || !groupKey) {
        setGateError(
          gErr?.message ??
            "No team channel key on this account yet. Open Team chat and tap Refresh, or ask an organizer to add you.",
        );
        return;
      }
      setSessionTeamKey(groupKey);
      setDecoyMode(false);
      setUnlocked(true);
      setMasterPw("");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const displayNameForActor = (actorId: string) => {
    if (actorId === profileId) return username?.trim() || "You";
    return `${actorId.slice(0, 6)}…`;
  };

  if (!unlocked) {
    return (
      <View style={[styles.shell, { paddingTop: Math.max(12, insets.top), backgroundColor: chrome.background }]}>
        <Text style={[styles.hero, { color: chrome.text }]}>Activity log</Text>
        <Text style={[styles.sub, { color: chrome.tabIconDefault }]}>
          End-to-end encrypted audit trail. The server only stores ciphertext — your team key decrypts entries on this
          device after you verify your vault credentials.
        </Text>
        <TextInput
          placeholder="Master password"
          placeholderTextColor={TacticalPalette.boneMuted}
          secureTextEntry
          value={masterPw}
          onChangeText={setMasterPw}
          style={[styles.input, { color: chrome.text, borderColor: chrome.tabIconDefault, backgroundColor: chrome.panel }]}
        />
        <TextInput
          placeholder="Vault PIN"
          placeholderTextColor={TacticalPalette.boneMuted}
          secureTextEntry
          keyboardType="number-pad"
          value={pin}
          onChangeText={setPin}
          style={[styles.input, { color: chrome.text, borderColor: chrome.tabIconDefault, backgroundColor: chrome.panel }]}
        />
        {gateError ? (
          <Text style={[styles.err, { color: TacticalPalette.danger }]}>{gateError}</Text>
        ) : null}
        <Pressable
          disabled={busy}
          onPress={() => void runGate()}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: chrome.tint, opacity: busy ? 0.6 : pressed ? 0.9 : 1 },
          ]}>
          {busy ? (
            <ActivityIndicator color={TacticalPalette.matteBlack} />
          ) : (
            <Text style={styles.primaryTx}>Verify & decrypt</Text>
          )}
        </Pressable>
      </View>
    );
  }

  if (decoyMode) {
    return (
      <View style={[styles.shell, { paddingTop: Math.max(12, insets.top), backgroundColor: chrome.background }]}>
        <View style={styles.headRow}>
          <Text style={[styles.hero, { color: chrome.text }]}>Activity</Text>
          <Pressable
            onPress={() => {
              setUnlocked(false);
              setDecoyMode(false);
            }}
            hitSlop={10}>
            <Text style={{ color: chrome.tint, fontWeight: "800" }}>Lock</Text>
          </Pressable>
        </View>
        <Text style={[styles.sub, { color: chrome.tabIconDefault, marginBottom: 12 }]}>
          Read-only account timeline (generic notifications).
        </Text>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {decoyFeed.map((it, i) => (
            <View
              key={`${it.ts}-${i}`}
              style={[
                styles.row,
                { borderColor: chrome.tabIconDefault, backgroundColor: chrome.panel },
              ]}>
              <FontAwesome name="bell" size={16} color={chrome.tint} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, paddingLeft: 12 }}>
                <Text style={[styles.rowTitle, { color: chrome.text }]}>{it.label}</Text>
                <Text style={[styles.rowSub, { color: chrome.tabIconDefault }]}>{it.sub}</Text>
                <Text style={[styles.rowMeta, { color: chrome.tabIconDefault }]}>
                  {formatVaultListDate(new Date(it.ts).toISOString())}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.shell, { paddingTop: Math.max(12, insets.top), backgroundColor: chrome.background }]}>
      <View style={styles.headRow}>
        <Text style={[styles.hero, { color: chrome.text }]}>Activity log</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Pressable onPress={() => void loadFeed()} hitSlop={10}>
            <FontAwesome name="refresh" size={18} color={chrome.tint} />
          </Pressable>
          <Pressable
            onPress={() => {
              sessionTeamKey?.fill(0);
              setSessionTeamKey(null);
              setUnlocked(false);
              setItems([]);
            }}
            hitSlop={10}>
            <Text style={{ color: chrome.tint, fontWeight: "800" }}>Lock</Text>
          </Pressable>
        </View>
      </View>
      <Text style={[styles.sub, { color: chrome.tabIconDefault, marginBottom: 10 }]}>
        Tap an entry to jump to Map or Vault. Entries you cannot decrypt are hidden.
      </Text>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 ? (
          <Text style={{ color: chrome.tabIconDefault, marginTop: 16 }}>No decryptable events yet.</Text>
        ) : null}
        {items.map((it) => {
          if (it.kind !== "real") return null;
          return (
            <Pressable
              key={it.row.id}
              onPress={() => openRow(it.plain)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderColor: chrome.tabIconDefault,
                  backgroundColor: chrome.panel,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}>
              <FontAwesome
                name={it.plain.type === "MAP_PIN" ? "map-marker" : "file-o"}
                size={16}
                color={chrome.tint}
                style={{ marginTop: 2 }}
              />
              <View style={{ flex: 1, paddingLeft: 12 }}>
                <Text style={[styles.rowTitle, { color: chrome.text }]}>{it.plain.text}</Text>
                <Text style={[styles.rowSub, { color: chrome.tabIconDefault }]}>
                  {displayNameForActor(it.row.actor_id)} · {it.plain.type.replace("_", " ")} · {it.plain.ref.slice(0, 8)}…
                </Text>
                <Text style={[styles.rowMeta, { color: chrome.tabIconDefault }]}>
                  {formatVaultListDate(it.row.created_at)}
                </Text>
              </View>
              <FontAwesome name="chevron-right" size={12} color={chrome.tabIconDefault} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, paddingHorizontal: 18 },
  hero: { fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  sub: { fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  err: { fontSize: 13, marginBottom: 10 },
  primary: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryTx: { fontSize: 16, fontWeight: "800", color: TacticalPalette.matteBlack },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  rowTitle: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  rowSub: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  rowMeta: { fontSize: 11, marginTop: 6 },
});
