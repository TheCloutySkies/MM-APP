import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";

import type { TacticalColors } from "@/constants/TacticalTheme";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { useLiveSocket, type SocketChatMessage } from "@/hooks/useLiveSocket";
import { useMMStore } from "@/store/mmStore";

const AnyFlashList: any = FlashList;

type Props = {
  variant: "trailing" | "sheet";
  onCloseSheet?: () => void;
  /** Desktop rail only: collapse this panel back to the floating “Comms” bubble. */
  onCollapseTrailing?: () => void;
};

export function LiveCommsPanel({ variant, onCloseSheet, onCollapseTrailing }: Props) {
  const insets = useSafeAreaInsets();
  const profileId = useMMStore((s) => s.profileId) ?? "";
  const username = useMMStore((s) => s.username) ?? "You";

  const { status, error, messages, sendMessage } = useLiveSocket();

  const listRef = useRef<any>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (messages.length) listRef.current?.scrollToEnd?.({ animated: true });
  }, [messages.length]);

  const onSend = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    void sendMessage(t);
    setDraft("");
  }, [draft, sendMessage]);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Comms</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={styles.status}>
            {status === "connected"
              ? "LIVE"
              : status === "connecting"
                ? "CONNECTING…"
                : status === "error"
                  ? "ERROR"
                  : "OFFLINE"}
          </Text>
          {variant === "sheet" && onCloseSheet ? (
            <Pressable onPress={onCloseSheet} hitSlop={10}>
              <Text style={styles.headerBtn}>Close</Text>
            </Pressable>
          ) : null}
          {variant === "trailing" && onCollapseTrailing ? (
            <Pressable onPress={onCollapseTrailing} hitSlop={10}>
              <Text style={styles.headerBtn}>Collapse</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {error ? <Text style={styles.err}>{error}</Text> : null}

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        keyboardVerticalOffset={Platform.OS === "android" ? Math.max(0, insets.top + 12) : 0}>
        <AnyFlashList
          ref={listRef}
          data={messages}
          keyExtractor={(m: SocketChatMessage) => m.id}
          renderItem={({ item }: { item: SocketChatMessage }) => (
            <MessageBubble item={item} profileId={profileId} selfName={username} />
          )}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 10 }}
          estimatedItemSize={84}
        />

        <View style={styles.composer}>
          <TextInput
            placeholder={status === "connected" ? "Message the team…" : "Connecting…"}
            placeholderTextColor={TacticalPalette.boneMuted}
            value={draft}
            onChangeText={setDraft}
            editable={status === "connected"}
            multiline
            style={styles.input}
          />
          <Pressable
            onPress={onSend}
            disabled={status !== "connected" || !draft.trim()}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                opacity: status !== "connected" || !draft.trim() ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button">
            <FontAwesome name="send" size={16} color={TacticalPalette.matteBlack} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function MessageBubble({
  item,
  profileId,
  selfName,
}: {
  item: SocketChatMessage;
  profileId: string;
  selfName: string;
}) {
  const mine = item.user_id === profileId;
  const who = mine ? selfName : item.display_name || item.user_id.slice(0, 8);
  const t = new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={styles.meta}>
          {who} · {t}
        </Text>
        <Text style={styles.msg}>{item.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0, backgroundColor: TacticalPalette.matteBlack },
  header: {
    paddingTop: 10,
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: TacticalPalette.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: TacticalPalette.bone, fontWeight: "900", fontSize: 16 },
  status: { color: TacticalPalette.boneMuted, fontWeight: "800", fontSize: 12 },
  headerBtn: { color: TacticalPalette.coyote, fontWeight: "900" },
  err: { color: TacticalPalette.danger, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 2, fontWeight: "700" },
  body: { flex: 1, minHeight: 0 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: TacticalPalette.border,
    backgroundColor: TacticalPalette.matteBlack,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: TacticalPalette.bone,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: TacticalPalette.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { paddingHorizontal: 12, paddingVertical: 6 },
  rowMine: { alignItems: "flex-end" },
  rowTheirs: { alignItems: "flex-start" },
  bubble: {
    maxWidth: 540,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bubbleMine: { backgroundColor: "rgba(107,142,92,0.22)", borderColor: TacticalPalette.coyote },
  bubbleTheirs: { backgroundColor: TacticalPalette.panel, borderColor: TacticalPalette.border },
  meta: { color: TacticalPalette.boneMuted, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  msg: { color: TacticalPalette.bone, fontSize: 14, lineHeight: 18 },
});

