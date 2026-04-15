import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
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
import { formatVaultListDate } from "@/lib/vaultNaming";
import { useMMStore } from "@/store/mmStore";

type FeedItem = { kind: "real"; row: ActivityLogRow; plain: ActivityLogPlainPayloadV1 };

type DecoyItem = { label: string; sub: string; ts: number };

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
  onProgress: (done: number, total: number) => void,
): Promise<FeedItem[]> {
  const next: FeedItem[] = [];
  const total = rows.length;
  let done = 0;
  for (const row of rows) {
    const plain = await decryptActivityPayloadJson(row.encrypted_payload);
    if (plain) next.push({ kind: "real", row, plain });
    done += 1;
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
  const setMapFocusMarkerId = useMMStore((s) => s.setMapFocusMarkerId);
  const setVaultFocusObjectId = useMMStore((s) => s.setVaultFocusObjectId);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedProgress, setFeedProgress] = useState<{ done: number; total: number } | null>(null);
  const [feedFetchError, setFeedFetchError] = useState<string | null>(null);
  const decoyFeed = useMemo(() => buildDecoyFeed(), []);

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
    if (!supabase || !profileId) return;
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
      const next = await decryptFeedRows(rows, (done, total) => {
        setFeedProgress({ done, total });
      });
      setItems(next);
    } finally {
      setFeedLoading(false);
      setFeedProgress(null);
    }
  }, [supabase, profileId]);

  const displayNameForActor = (actorId: string) => {
    if (actorId === profileId) return username?.trim() || "You";
    return `${actorId.slice(0, 6)}…`;
  };

  void decoyFeed;

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
              setItems([]);
              setFeedFetchError(null);
            }}
            hitSlop={10}>
            <Text style={{ color: chrome.tint, fontWeight: "800" }}>Clear</Text>
          </Pressable>
        </View>
      </View>
      {feedLoading && feedProgress && feedProgress.total > 0 ? (
        <Text style={[styles.progress, { color: chrome.tabIconDefault }]}>
          Loading… {feedProgress.done} / {feedProgress.total}
        </Text>
      ) : null}
      {feedFetchError ? (
        <Text style={[styles.err, { color: TacticalPalette.danger, marginBottom: 8 }]}>{feedFetchError}</Text>
      ) : null}
      <Text style={[styles.sub, { color: chrome.tabIconDefault, marginBottom: 10 }]}>
        Tap an entry to jump to Map or Vault.
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
