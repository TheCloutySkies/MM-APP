import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InfoHint } from "@/components/chrome/InfoHint";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { decryptActivityPayloadJson } from "@/lib/activityLog/crypto";
import type { ActivityLogPlainPayloadV1, ActivityLogRow } from "@/lib/activityLog/types";
import { loadGlobalGroupKeyForMember } from "@/lib/e2ee/groupKeys";
import { hasLocalIdentity, unlockIdentityPrivateKey } from "@/lib/e2ee/identity";
import { isWebSubtleAvailable } from "@/lib/e2ee/subtleWeb";
import { getTeamGroupKeyBridge } from "@/lib/e2ee/teamGroupKeyBridge";
import { classifyVaultCredential } from "@/lib/vault/classifyVaultCredential";
import { formatVaultListDate } from "@/lib/vaultNaming";
import { useMMStore } from "@/store/mmStore";

type FeedItem = { kind: "real"; row: ActivityLogRow; plain: ActivityLogPlainPayloadV1 };

type DecoyItem = { label: string; sub: string; ts: number };

const DECRYPT_CONCURRENCY = 6;
const FEED_PAGE_SIZE = 300;

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

async function decryptFeedRows(
  rows: ActivityLogRow[],
  key: Uint8Array,
  onProgress: (done: number, total: number) => void,
): Promise<FeedItem[]> {
  const next: FeedItem[] = [];
  const total = rows.length;
  let done = 0;
  for (let i = 0; i < rows.length; i += DECRYPT_CONCURRENCY) {
    const slice = rows.slice(i, i + DECRYPT_CONCURRENCY);
    const part = await Promise.all(
      slice.map(async (row) => {
        const plain = await decryptActivityPayloadJson(key, row.encrypted_payload);
        return plain ? ({ kind: "real" as const, row, plain } satisfies FeedItem) : null;
      }),
    );
    for (const p of part) {
      if (p) next.push(p);
    }
    done = Math.min(i + slice.length, total);
    onProgress(done, total);
  }
  next.sort((a, b) => new Date(b.row.created_at).getTime() - new Date(a.row.created_at).getTime());
  return next;
}

export default function ActivityLogScreen() {
  const chrome = useTacticalChrome();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const setupComplete = useMMStore((s) => s.setupComplete);
  const vaultMode = useMMStore((s) => s.vaultMode);
  const setMapFocusMarkerId = useMMStore((s) => s.setMapFocusMarkerId);
  const setVaultFocusObjectId = useMMStore((s) => s.setVaultFocusObjectId);

  const [masterPw, setMasterPw] = useState("");
  const [pin, setPin] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decoyMode, setDecoyMode] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  /** User explicitly locked this screen — don’t immediately re-open from team key bridge. */
  const [userDismissedSession, setUserDismissedSession] = useState(false);
  const [sessionTeamKey, setSessionTeamKey] = useState<Uint8Array | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedProgress, setFeedProgress] = useState<{ done: number; total: number } | null>(null);
  const [feedFetchError, setFeedFetchError] = useState<string | null>(null);
  const [showAdvancedGate, setShowAdvancedGate] = useState(false);

  const decoyFeed = useMemo(() => buildDecoyFeed(), [decoyMode]);

  useEffect(() => {
    return () => {
      sessionTeamKey?.fill(0);
    };
  }, [sessionTeamKey]);

  const vaultLocked = vaultMode == null;

  useEffect(() => {
    if (vaultLocked) {
      sessionTeamKey?.fill(0);
      setSessionTeamKey(null);
      setUnlocked(false);
      setItems([]);
      setDecoyMode(false);
      setUserDismissedSession(false);
      setFeedProgress(null);
      setFeedFetchError(null);
    }
  }, [vaultLocked]);

  /** Reuse team AES key from Live Comms (same session) when main vault is unlocked. */
  useEffect(() => {
    if (vaultLocked || vaultMode !== "main" || userDismissedSession || unlocked || decoyMode) return;
    if (!isWebSubtleAvailable()) return;
    const bridged = getTeamGroupKeyBridge();
    if (bridged?.length === 32) {
      setSessionTeamKey(new Uint8Array(bridged));
      setUnlocked(true);
      setDecoyMode(false);
    }
  }, [vaultLocked, vaultMode, userDismissedSession, unlocked, decoyMode]);

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
    setFeedLoading(true);
    setFeedFetchError(null);
    setFeedProgress({ done: 0, total: 0 });
    try {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, actor_id, encrypted_payload, created_at")
        .order("created_at", { ascending: false })
        .limit(FEED_PAGE_SIZE);
      if (error) {
        setFeedFetchError(error.message);
        setItems([]);
        return;
      }
      const rows = (data ?? []) as ActivityLogRow[];
      if (!rows.length) {
        setItems([]);
        setFeedProgress(null);
        return;
      }
      const next = await decryptFeedRows(rows, sessionTeamKey, (done, total) => {
        setFeedProgress({ done, total });
      });
      setItems(next);
    } finally {
      setFeedLoading(false);
      setFeedProgress(null);
    }
  }, [supabase, profileId, sessionTeamKey]);

  useEffect(() => {
    if (unlocked && !decoyMode && sessionTeamKey) void loadFeed();
  }, [unlocked, decoyMode, sessionTeamKey, loadFeed]);

  const runGate = async () => {
    setGateError(null);
    if (!isWebSubtleAvailable()) {
      setGateError(
        "This device needs Web Crypto (P-384 + AES-GCM). Update the app or open on a supported browser / build.",
      );
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
        setUserDismissedSession(false);
        setMasterPw("");
        setPin("");
        return;
      }

      const hasId = await hasLocalIdentity(profileId);
      if (!hasId) {
        setGateError("Open Team chat once on this device to create encryption keys, then return here.");
        return;
      }
      const { privateKey, error: pkErr } = await unlockIdentityPrivateKey(profileId, pin.trim());
      if (pkErr || !privateKey) {
        setGateError(pkErr?.message ?? "Could not unlock identity key.");
        return;
      }
      const { groupKey, error: gErr } = await loadGlobalGroupKeyForMember(supabase, profileId, privateKey);
      if (gErr || !groupKey) {
        const raw = gErr?.message ?? "";
        const friendly =
          /operation.specific|OperationError|unwrap failed/i.test(raw)
            ? "Team key unwrap failed (wrong PIN, missing wrap, or OS crypto limit). Open Team chat, unlock with the same PIN, tap Refresh, then try again."
            : raw ||
              "No team channel key on this account yet. Open Team chat and tap Refresh, or ask an organizer to add you.";
        setGateError(friendly);
        return;
      }
      setSessionTeamKey(groupKey);
      setDecoyMode(false);
      setUnlocked(true);
      setUserDismissedSession(false);
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

  const bridge = getTeamGroupKeyBridge();
  const canTryBridgeUi = vaultMode === "main" && !vaultLocked && bridge?.length === 32 && isWebSubtleAvailable();

  if (!unlocked) {
    return (
      <View style={[styles.shell, { paddingTop: Math.max(12, insets.top), backgroundColor: chrome.background }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={[styles.hero, { color: chrome.text, flexShrink: 1 }]}>Activity log</Text>
          <InfoHint
            title="Activity log"
            webTitle="Encrypted audit entries; decrypt with your team session key."
            message="Events are stored as ciphertext. After the vault is open, you can often load using the same team key as chat, or verify with master password + PIN."
            tint={chrome.tabIconDefault}
          />
        </View>
        <Text style={[styles.sub, { color: chrome.tabIconDefault }]}>
          Encrypted audit trail — ciphertext only on the server.
        </Text>
        {canTryBridgeUi && !showAdvancedGate ? (
          <>
            <Text style={[styles.sub, { color: chrome.tabIconDefault, marginTop: 0 }]}>
              Team chat is unlocked — load the log with your current session key.
            </Text>
            <Pressable
              onPress={() => {
                setSessionTeamKey(new Uint8Array(bridge));
                setUnlocked(true);
                setUserDismissedSession(false);
              }}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: chrome.tint, opacity: pressed ? 0.9 : 1 },
              ]}>
              <Text style={styles.primaryTx}>Load activity log</Text>
            </Pressable>
            <Pressable onPress={() => setShowAdvancedGate(true)} style={{ marginTop: 14 }}>
              <Text style={{ color: chrome.tint, fontWeight: "700" }}>Verify with master password instead</Text>
            </Pressable>
          </>
        ) : null}
        {(showAdvancedGate || !canTryBridgeUi) && (
          <>
            <TextInput
              placeholder="Master password"
              placeholderTextColor={TacticalPalette.boneMuted}
              secureTextEntry
              value={masterPw}
              onChangeText={setMasterPw}
              style={[
                styles.input,
                { color: chrome.text, borderColor: chrome.tabIconDefault, backgroundColor: chrome.panel },
              ]}
            />
            <TextInput
              placeholder="Vault PIN"
              placeholderTextColor={TacticalPalette.boneMuted}
              secureTextEntry
              keyboardType="number-pad"
              value={pin}
              onChangeText={setPin}
              style={[
                styles.input,
                { color: chrome.text, borderColor: chrome.tabIconDefault, backgroundColor: chrome.panel },
              ]}
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
            {canTryBridgeUi && showAdvancedGate ? (
              <Pressable onPress={() => setShowAdvancedGate(false)} style={{ marginTop: 12 }}>
                <Text style={{ color: chrome.tint, fontWeight: "700" }}>Back to quick unlock</Text>
              </Pressable>
            ) : null}
          </>
        )}
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
              setUserDismissedSession(true);
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <Text style={[styles.hero, { color: chrome.text, flexShrink: 1 }]}>Activity log</Text>
          <InfoHint
            title="Activity log"
            webTitle="Decrypts with your current session key; Lock clears it from this screen."
            message="Entries are end-to-end encrypted. Refresh pulls the latest ciphertext; Lock clears the decryption session on this screen."
            tint={chrome.tabIconDefault}
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Pressable onPress={() => void loadFeed()} disabled={feedLoading} hitSlop={10}>
            {feedLoading ? (
              <ActivityIndicator size="small" color={chrome.tint} />
            ) : (
              <FontAwesome name="refresh" size={18} color={chrome.tint} />
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              sessionTeamKey?.fill(0);
              setSessionTeamKey(null);
              setUnlocked(false);
              setItems([]);
              setUserDismissedSession(true);
              setFeedFetchError(null);
            }}
            hitSlop={10}>
            <Text style={{ color: chrome.tint, fontWeight: "800" }}>Lock</Text>
          </Pressable>
        </View>
      </View>
      {feedLoading && feedProgress && feedProgress.total > 0 ? (
        <Text style={[styles.progress, { color: chrome.tabIconDefault }]}>
          Decrypting… {feedProgress.done} / {feedProgress.total}
        </Text>
      ) : null}
      {feedFetchError ? (
        <Text style={[styles.err, { color: TacticalPalette.danger, marginBottom: 8 }]}>{feedFetchError}</Text>
      ) : null}
      <Text style={[styles.sub, { color: chrome.tabIconDefault, marginBottom: 10 }]}>
        Tap an entry to jump to Map or Vault. Entries you cannot decrypt are hidden.
      </Text>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {feedLoading && items.length === 0 ? (
          <View style={{ alignItems: "center", marginTop: 32, gap: 12 }}>
            <ActivityIndicator size="large" color={chrome.tint} />
            <Text style={{ color: chrome.tabIconDefault }}>Loading activity…</Text>
          </View>
        ) : null}
        {!feedLoading && items.length === 0 ? (
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
                  {displayNameForActor(it.row.actor_id)} · {it.plain.type.replace("_", " ")} ·{" "}
                  {it.plain.ref.slice(0, 8)}…
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
  progress: { fontSize: 12, fontWeight: "600", marginBottom: 6 },
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
