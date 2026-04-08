import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";
import { decryptUtf8, encryptUtf8 } from "@/lib/crypto/aesGcm";
import { OPS_COMMENT_AAD, type OpsCommentPayloadV1 } from "@/lib/opsReports";

type CommentRow = {
  id: string;
  author_username: string;
  encrypted_payload: string;
  created_at: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  headerTitle: string;
  bodyText: string;
  opsReportId: string | null;
  supabase: SupabaseClient | null;
  profileId: string | null;
  username: string | null;
  mapKey: Uint8Array | null;
};

export function MissionPlanTeamModal({
  visible,
  onClose,
  headerTitle,
  bodyText,
  opsReportId,
  supabase,
  profileId,
  username,
  mapKey,
}: Props) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const canComment =
    !!opsReportId && !!supabase && !!profileId && !!mapKey && mapKey.length === 32;

  const loadComments = useCallback(async () => {
    if (!supabase || !opsReportId || !mapKey || mapKey.length !== 32) {
      setComments([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("ops_comments")
        .select("id, author_username, encrypted_payload, created_at")
        .eq("ops_report_id", opsReportId)
        .order("created_at", { ascending: true });
      if (error) {
        console.warn(error.message);
        setComments([]);
        return;
      }
      setComments((data ?? []) as CommentRow[]);
    } finally {
      setLoading(false);
    }
  }, [supabase, opsReportId, mapKey]);

  useEffect(() => {
    if (visible) void loadComments();
  }, [visible, loadComments]);

  const postComment = async () => {
    if (!canComment || !draft.trim()) return;
    setPosting(true);
    try {
      const payload: OpsCommentPayloadV1 = { v: 1, body: draft.trim(), createdAt: Date.now() };
      const encrypted = encryptUtf8(mapKey!, JSON.stringify(payload), OPS_COMMENT_AAD);
      const { error } = await supabase!.from("ops_comments").insert({
        ops_report_id: opsReportId,
        author_id: profileId,
        author_username: username?.trim() || "operator",
        encrypted_payload: encrypted,
      });
      if (error) {
        console.warn(error.message);
        return;
      }
      setDraft("");
      await loadComments();
    } finally {
      setPosting(false);
    }
  };

  const metaColor = TacticalPalette.boneMuted;
  const bodyColor = TacticalPalette.bone;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: bodyColor }]} numberOfLines={2}>
              {headerTitle}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Text style={{ color: TacticalPalette.accent, fontWeight: "800" }}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollInner}>
            <Text style={[styles.body, { color: bodyColor }]} selectable>
              {bodyText}
            </Text>
            {opsReportId ? (
              <>
                <Text style={[styles.sectionLabel, { color: metaColor }]}>Team comments</Text>
                {loading ? <ActivityIndicator color={TacticalPalette.accent} style={{ marginVertical: 12 }} /> : null}
                {comments.map((c) => {
                  let line = "…";
                  try {
                    if (mapKey?.length === 32) {
                      const json = decryptUtf8(mapKey, c.encrypted_payload, OPS_COMMENT_AAD);
                      line = (JSON.parse(json) as OpsCommentPayloadV1).body;
                    }
                  } catch {
                    line = "(cannot decrypt)";
                  }
                  return (
                    <View key={c.id} style={[styles.commentCard, { borderColor: TacticalPalette.border }]}>
                      <Text style={[styles.commentMeta, { color: metaColor }]}>
                        {c.author_username} · {c.created_at}
                      </Text>
                      <Text style={[styles.commentBody, { color: bodyColor }]} selectable>
                        {line}
                      </Text>
                    </View>
                  );
                })}
                {canComment ? (
                  <>
                    <TextInput
                      placeholder="Add a comment (team can read)"
                      placeholderTextColor={metaColor}
                      value={draft}
                      onChangeText={setDraft}
                      multiline
                      style={[
                        styles.commentInput,
                        {
                          borderColor: TacticalPalette.border,
                          color: bodyColor,
                          backgroundColor: TacticalPalette.charcoal,
                        },
                      ]}
                      textAlignVertical="top"
                    />
                    <Pressable
                      disabled={posting}
                      onPress={() => void postComment()}
                      style={[
                        styles.postBtn,
                        { backgroundColor: TacticalPalette.accent, opacity: posting ? 0.7 : 1 },
                      ]}>
                      <Text style={{ color: TacticalPalette.bone, fontWeight: "800" }}>Post comment</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={{ color: metaColor, fontSize: 13, marginTop: 8 }}>
                    Unlock with team key to add comments.
                  </Text>
                )}
              </>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    maxHeight: "92%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: TacticalPalette.matteBlack,
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TacticalPalette.border,
  },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: "800", paddingRight: 12 },
  closeBtn: { paddingVertical: 4 },
  scroll: { maxHeight: 560 },
  scrollInner: { padding: 16, paddingBottom: 32 },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  commentCard: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10 },
  commentMeta: { fontSize: 11, marginBottom: 6 },
  commentBody: { fontSize: 14, lineHeight: 20 },
  commentInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 72,
    padding: 12,
    fontSize: 15,
    marginBottom: 10,
  },
  postBtn: { paddingVertical: 14, borderRadius: 12, alignItems: "center" },
});
