import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { Banner, Button, Card, Text, TextInput } from "react-native-paper";

import { DocumentDetailModal } from "@/components/common/DocumentDetailModal";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { decryptUtf8, encryptUtf8 } from "@/lib/crypto/aesGcm";
import { hexToBytes } from "@/lib/crypto/bytes";
import { getMapSharedKeyHex } from "@/lib/env";
import { BULLETIN_AAD, type BulletinPostPayloadV1 } from "@/lib/opsReports";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";

type Row = {
  id: string;
  author_id: string;
  author_username: string;
  encrypted_payload: string;
  created_at: string;
};

export default function BulletinScreen() {
  const chrome = useTacticalChrome();
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const vaultMode = useMMStore((s) => s.vaultMode) as VaultMode | null;

  const mapKey = useMemo(() => {
    const hex = resolveMapEncryptKey() ?? getMapSharedKeyHex();
    if (!hex || hex.length !== 64) return null;
    try {
      return hexToBytes(hex);
    } catch {
      return null;
    }
  }, [vaultMode]);

  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [keyBannerVisible, setKeyBannerVisible] = useState(true);
  const [detail, setDetail] = useState<{
    title: string;
    body: string;
    meta: string;
    postId: string;
    authorId: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("bulletin_posts")
      .select("id, author_id, author_username, encrypted_payload, created_at")
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
        postId: row.id,
        authorId: row.author_id,
      });
    } catch {
      Alert.alert("Bulletin", "Cannot decrypt with current key.");
    }
  };

  const hasBundledTeamKey = !!getMapSharedKeyHex();
  const keyReady = mapKey && mapKey.length === 32;

  const inputTheme = {
    colors: {
      onSurfaceVariant: chrome.textMuted,
      background: chrome.surface,
    },
  };

  return (
    <KeyboardAvoidingView
      style={[styles.wrap, { backgroundColor: chrome.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text variant="bodySmall" style={[styles.lede, { color: chrome.textMuted }]}>
        Team bulletin — ciphertext only on the server. Everyone uses the same team key as map markers and mission plans
        (bundled in the app from wrangler). Unlock your vault only if you are not using the shared key.
      </Text>

      {!keyReady ? (
        <Banner
          visible={keyBannerVisible}
          icon="shield-key-outline"
          actions={[{ label: "Dismiss", onPress: () => setKeyBannerVisible(false) }]}
          style={styles.banner}>
          {hasBundledTeamKey
            ? "Cannot decrypt posts yet. Fully restart the app (force-quit) so the team key loads, or unlock your main vault."
            : "This build has no EXPO_PUBLIC_MM_MAP_SHARED_KEY. Rebuild from the latest repo or set the key in .env / wrangler.toml."}
        </Banner>
      ) : null}

      <Text variant="labelLarge" style={[styles.label, { color: chrome.textMuted }]}>
        New post
      </Text>
      <TextInput
        mode="outlined"
        label="Title"
        value={title}
        onChangeText={setTitle}
        dense
        style={styles.input}
        outlineColor={TacticalPalette.border}
        activeOutlineColor={chrome.accent}
        textColor={chrome.text}
        placeholderTextColor={chrome.textMuted}
        theme={inputTheme}
      />
      <TextInput
        mode="outlined"
        label="Body"
        value={body}
        onChangeText={setBody}
        multiline
        numberOfLines={4}
        dense
        style={[styles.input, styles.bodyBox]}
        outlineColor={TacticalPalette.border}
        activeOutlineColor={chrome.accent}
        textColor={chrome.text}
        placeholderTextColor={chrome.textMuted}
        theme={inputTheme}
      />
      <Button
        mode="contained"
        onPress={() => void post()}
        disabled={!keyReady}
        buttonColor={chrome.accent}
        textColor={TacticalPalette.matteBlack}
        style={styles.postBtn}>
        Post (encrypted)
      </Button>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        style={{ marginTop: 16 }}
        ListHeaderComponent={
          <Text variant="labelLarge" style={[styles.listHead, { color: chrome.textMuted }]}>
            Feed
          </Text>
        }
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
            <Card
              mode="outlined"
              style={[styles.card, { borderColor: TacticalPalette.border }]}
              onPress={() => openRow(item)}>
              <Card.Title
                title={headline}
                titleNumberOfLines={2}
                titleStyle={{ color: chrome.text, fontSize: 16 }}
                subtitle={
                  preview
                    ? `${preview}${preview.length >= 120 ? "…" : ""}\n${item.author_username} · ${item.created_at}`
                    : `${item.author_username} · ${item.created_at}`
                }
                subtitleNumberOfLines={4}
                subtitleStyle={{ color: chrome.textMuted, fontSize: 13 }}
                right={() => <Text style={{ color: chrome.accent, fontSize: 22, marginRight: 8 }}>›</Text>}
              />
            </Card>
          );
        }}
      />

      <DocumentDetailModal
        visible={detail != null}
        title={detail?.title ?? ""}
        subtitle={detail?.meta}
        body={detail?.body ?? ""}
        onClose={() => setDetail(null)}
        onDelete={
          detail && profileId && detail.authorId === profileId
            ? () => {
                Alert.alert("Delete post", "Remove this bulletin post for everyone?", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      if (!supabase) return;
                      const { error: delErr } = await supabase.from("bulletin_posts").delete().eq("id", detail.postId);
                      if (delErr) {
                        Alert.alert("Bulletin", delErr.message);
                        return;
                      }
                      setDetail(null);
                      void refresh();
                    },
                  },
                ]);
              }
            : undefined
        }
        deleteLabel="Delete my post"
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  lede: { lineHeight: 17, marginBottom: 14 },
  banner: { marginBottom: 12 },
  label: { marginBottom: 8 },
  input: { marginBottom: 8, backgroundColor: "transparent" },
  bodyBox: { minHeight: 120 },
  postBtn: { marginTop: 4, borderRadius: 10 },
  listHead: { letterSpacing: 0.6, marginBottom: 8 },
  card: { marginBottom: 8, borderRadius: 10 },
});
