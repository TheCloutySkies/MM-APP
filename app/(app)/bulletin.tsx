import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
    Alert,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
    useColorScheme,
} from "react-native";

import { DocumentDetailModal } from "@/components/common/DocumentDetailModal";
import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { decryptUtf8, encryptUtf8 } from "@/lib/crypto/aesGcm";
import { getMapSharedKeyHex } from "@/lib/env";
import { BULLETIN_AAD, type BulletinPostPayloadV1 } from "@/lib/opsReports";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";

type Row = {
  id: string;
  author_username: string;
  encrypted_payload: string;
  created_at: string;
};

export default function BulletinScreen() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const vaultMode = useMMStore((s) => s.vaultMode) as VaultMode | null;
  const mainKey = useMMStore((s) => s.mainVaultKey);
  const decoyKey = useMMStore((s) => s.decoyVaultKey);

  const mapKey = useMemo(() => {
    try {
      return resolveMapEncryptKey(mainKey, decoyKey, vaultMode);
    } catch {
      return null;
    }
  }, [mainKey, decoyKey, vaultMode]);

  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [detail, setDetail] = useState<{ title: string; body: string; meta: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("bulletin_posts")
      .select("id, author_username, encrypted_payload, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      Alert.alert("Bulletin", error.message);
      return;
    }
    setRows((data ?? []) as Row[]);
  }, [supabase]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const post = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("Bulletin", "Unlock vault or set shared map key for team crypto.");
      return;
    }
    if (!title.trim() || !body.trim()) {
      Alert.alert("Bulletin", "Title and body required.");
      return;
    }
    const payload: BulletinPostPayloadV1 = {
      v: 1,
      title: title.trim(),
      body: body.trim(),
      createdAt: Date.now(),
    };
    const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), BULLETIN_AAD);
    const { error } = await supabase.from("bulletin_posts").insert({
      author_id: profileId,
      author_username: username?.trim() || "unknown",
      encrypted_payload: encrypted,
    });
    if (error) {
      Alert.alert("Bulletin", error.message);
      return;
    }
    setTitle("");
    setBody("");
    void refresh();
  };

  const openRow = (row: Row) => {
    if (!mapKey || mapKey.length !== 32) return;
    try {
      const json = decryptUtf8(mapKey, row.encrypted_payload, BULLETIN_AAD);
      const o = JSON.parse(json) as BulletinPostPayloadV1;
      setDetail({
        title: o.title,
        body: o.body,
        meta: `${row.author_username} · ${row.created_at}`,
      });
    } catch {
      Alert.alert("Bulletin", "Cannot decrypt with current key.");
    }
  };

  const inputStyle = [
    styles.input,
    {
      color: p.text,
      borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
      backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
    },
  ];

  const hasBundledTeamKey = !!getMapSharedKeyHex();

  return (
    <KeyboardAvoidingView
      style={[styles.wrap, { backgroundColor: p.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={[styles.lede, { color: p.tabIconDefault }]}>
        Team bulletin — ciphertext only on the server. Everyone uses the same team key as map markers and mission plans
        (bundled in the app from wrangler). Unlock your vault only if you are not using the shared key.
      </Text>
      {!mapKey || mapKey.length !== 32 ? (
        <View
          style={[
            styles.warnBanner,
            { borderColor: TacticalPalette.accent, backgroundColor: "rgba(139, 90, 60, 0.2)" },
          ]}>
          <Text style={[styles.warnText, { color: p.text }]}>
            {hasBundledTeamKey
              ? "Cannot decrypt posts yet. Fully restart the app (force-quit) so the team key loads, or unlock your main vault."
              : "This build has no EXPO_PUBLIC_MM_MAP_SHARED_KEY. Rebuild from the latest repo or set the key in .env / wrangler.toml."}
          </Text>
        </View>
      ) : null}
      <Text style={[styles.label, { color: p.tabIconDefault }]}>New post</Text>
      <TextInput placeholder="Title" placeholderTextColor="#888" value={title} onChangeText={setTitle} style={inputStyle} />
      <TextInput
        placeholder="Body"
        placeholderTextColor="#888"
        value={body}
        onChangeText={setBody}
        style={[inputStyle, styles.bodyBox]}
        multiline
      />
      <Pressable
        style={[styles.postBtn, { backgroundColor: p.tint }]}
        onPress={() => {
          void post();
        }}>
        <Text style={[styles.postBtnTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>Post (encrypted)</Text>
      </Pressable>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        style={{ marginTop: 16 }}
        ListHeaderComponent={<Text style={[styles.listHead, { color: p.tabIconDefault }]}>Feed</Text>}
        renderItem={({ item }) => {
          let headline = "…";
          let preview = "";
          if (mapKey?.length === 32) {
            try {
              const json = decryptUtf8(mapKey, item.encrypted_payload, BULLETIN_AAD);
              const o = JSON.parse(json) as BulletinPostPayloadV1;
              headline = o.title;
              preview = o.body.replace(/\s+/g, " ").trim().slice(0, 120);
            } catch {
              headline = "(locked)";
            }
          }
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open bulletin: ${headline}`}
              style={[styles.card, { borderColor: TacticalPalette.border }]}
              onPress={() => openRow(item)}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: p.text }]} numberOfLines={2}>
                    {headline}
                  </Text>
                  {preview ? (
                    <Text style={[styles.cardPreview, { color: p.tabIconDefault }]} numberOfLines={2}>
                      {preview}
                      {preview.length >= 120 ? "…" : ""}
                    </Text>
                  ) : null}
                  <Text style={[styles.cardMeta, { color: p.tabIconDefault }]}>
                    {item.author_username} · {item.created_at}
                  </Text>
                </View>
                <Text style={[styles.chevron, { color: p.tint }]}>›</Text>
              </View>
            </Pressable>
          );
        }}
      />
      <DocumentDetailModal
        visible={detail != null}
        title={detail?.title ?? ""}
        subtitle={detail?.meta}
        body={detail?.body ?? ""}
        onClose={() => setDetail(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  lede: { fontSize: 12, lineHeight: 17, marginBottom: 14 },
  label: { fontSize: 11, fontWeight: "700", marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 8 },
  bodyBox: { minHeight: 96, textAlignVertical: "top" },
  postBtn: { paddingVertical: 14, borderRadius: 12, alignItems: "center", marginTop: 4 },
  postBtnTx: { fontSize: 16, fontWeight: "800" },
  listHead: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardPreview: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  cardMeta: { fontSize: 12, marginTop: 6 },
  chevron: { fontSize: 28, fontWeight: "300", marginTop: -4 },
  warnBanner: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 14 },
  warnText: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
});
