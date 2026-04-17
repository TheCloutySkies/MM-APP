import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useQuery } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useCallback, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import MapView, { Marker } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TacticalPalette } from "@/constants/TacticalTheme";
import { useLiveSocket, type LiveChatEnvelope } from "@/hooks/useLiveSocket";
import { getVaultPresignedGetUrl, isVaultS3StorageConfigured, putVaultObject } from "@/lib/storage";
import { useMMStore } from "@/store/mmStore";

const AnyFlashList: any = FlashList;

const EMOJI_QUICK = ["😀", "😂", "🫡", "🔥", "✅", "❤️", "👍", "👎", "🎯", "⚠️", "💀", "🎖️"];

type Props = {
  variant: "trailing" | "sheet";
  onCloseSheet?: () => void;
  onCollapseTrailing?: () => void;
};

type MmContact = { id: string; username: string };

function staticMapUri(lat: number, lng: number): string {
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=280x140&markers=${lat},${lng},red-pushpin`;
}

function msgIdNum(id: string): number {
  const n = Number(id);
  return Number.isFinite(n) ? n : 0;
}

function peerHasRead(peerLastRead: string | undefined, messageId: string): boolean {
  if (!peerLastRead) return false;
  return msgIdNum(peerLastRead) >= msgIdNum(messageId);
}

export function LiveCommsPanel({ variant, onCloseSheet, onCollapseTrailing }: Props) {
  const insets = useSafeAreaInsets();
  const profileId = useMMStore((s) => s.profileId) ?? "";
  const username = useMMStore((s) => s.username) ?? "You";
  const supabase = useMMStore((s) => s.supabase);

  const {
    status,
    error,
    setError,
    channelTab,
    setChannelTab,
    dmPeer,
    setDmPeer,
    messages,
    readReceipts,
    deliveryByMessageId,
    sendText,
    sendPayload,
  } = useLiveSocket();

  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);

  const { data: contacts = [] } = useQuery<MmContact[]>({
    queryKey: ["mmContacts", profileId],
    queryFn: async () => {
      if (!supabase || !profileId) return [];
      const { data, error: qErr } = await supabase
        .from("mm_profiles")
        .select("id, username")
        .neq("id", profileId)
        .order("username", { ascending: true });
      if (qErr) throw new Error(qErr.message);
      return (data ?? []) as MmContact[];
    },
    enabled: Boolean(supabase && profileId),
    staleTime: 5 * 60_000,
  });

  const onSend = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    void sendText(t);
    setDraft("");
  }, [draft, sendText]);

  const appendEmoji = useCallback((ch: string) => {
    setDraft((d) => d + ch);
    setEmojiOpen(false);
  }, []);

  const uploadAndSendFile = useCallback(
    async (uri: string, filename: string, mime: string, kind: "image" | "file") => {
      if (!profileId || !supabase) {
        setError("Not signed in.");
        return;
      }
      if (!isVaultS3StorageConfigured()) {
        setError("MinIO not configured for attachments.");
        return;
      }
      try {
        const res = await fetch(uri);
        const buf = new Uint8Array(await res.arrayBuffer());
        const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
        const key = `${profileId}/comms/${Date.now()}-${safe}`;
        const { error: upErr } = await putVaultObject(supabase, profileId, key, buf, {
          contentType: mime || "application/octet-stream",
          upsert: true,
        });
        if (upErr) {
          setError(upErr.message);
          return;
        }
        const { url } = await getVaultPresignedGetUrl(key, 86_400);
        await sendPayload({
          kind,
          text: filename,
          attachment: {
            s3_key: key,
            content_type: mime,
            size_bytes: buf.byteLength,
            filename,
            public_url: url ?? undefined,
          },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Attachment failed");
      }
    },
    [profileId, supabase, sendPayload, setError],
  );

  const onPickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Photo library permission denied.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAndSendFile(a.uri, a.fileName ?? `photo-${Date.now()}.jpg`, a.mimeType ?? "image/jpeg", "image");
  }, [uploadAndSendFile, setError]);

  const onPickDoc = useCallback(async () => {
    const doc = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (doc.canceled || !doc.assets?.[0]) return;
    const a = doc.assets[0];
    await uploadAndSendFile(a.uri, a.name ?? "file", a.mimeType ?? "application/octet-stream", "file");
  }, [uploadAndSendFile]);

  const onShareLocation = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      setError("Location permission denied.");
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    await sendPayload({
      kind: "location",
      text: "Shared location",
      location: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy ?? undefined,
      },
    });
  }, [sendPayload, setError]);

  const peerReadId = dmPeer ? readReceipts[dmPeer.id] : undefined;

  const headerTitle =
    channelTab === "group"
      ? "Group chat"
      : dmPeer
        ? `DM · ${dmPeer.displayName}`
        : "Private";

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{headerTitle}</Text>
          <View style={styles.segment}>
            <SegmentBtn label="Group" active={channelTab === "group"} onPress={() => setChannelTab("group")} />
            <SegmentBtn label="Private" active={channelTab === "private"} onPress={() => setChannelTab("private")} />
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={styles.status}>
            {status === "connected"
              ? "LIVE"
              : status === "connecting"
                ? "…"
                : status === "error"
                  ? "ERR"
                  : "OFF"}
          </Text>
          {channelTab === "private" && dmPeer ? (
            <Pressable onPress={() => setDmPeer(null)} hitSlop={10}>
              <Text style={styles.headerBtn}>Contacts</Text>
            </Pressable>
          ) : null}
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

      {channelTab === "private" && !dmPeer ? (
        <View style={styles.contactsWrap}>
          <Text style={styles.contactsHint}>Tap a teammate to start a direct message.</Text>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
            {contacts.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setDmPeer({ id: c.id, displayName: c.username })}
                style={({ pressed }) => [styles.contactRow, pressed && { opacity: 0.9 }]}>
                <FontAwesome name="user" size={18} color={TacticalPalette.coyote} style={{ marginRight: 12 }} />
                <Text style={styles.contactName}>{c.username}</Text>
                <FontAwesome name="chevron-right" size={14} color={TacticalPalette.boneMuted} />
              </Pressable>
            ))}
            {!contacts.length ? (
              <Text style={styles.emptyContacts}>No other profiles visible (check Supabase RLS).</Text>
            ) : null}
          </ScrollView>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
          keyboardVerticalOffset={Platform.OS === "android" ? Math.max(0, insets.top + 12) : 0}>
          <AnyFlashList
            data={messages}
            inverted
            keyExtractor={(m: LiveChatEnvelope) => m.message_id}
            renderItem={({ item }: { item: LiveChatEnvelope }) => (
              <MessageRow
                item={item}
                profileId={profileId}
                selfName={username}
                delivery={deliveryByMessageId[item.message_id]}
                readByPeer={channelTab === "private" && dmPeer ? peerHasRead(peerReadId, item.message_id) : false}
              />
            )}
            contentContainerStyle={{ paddingTop: 10, paddingBottom: 12 }}
            estimatedItemSize={96}
          />

          <View style={styles.composer}>
            <Pressable onPress={() => setEmojiOpen(true)} style={styles.roundBtn} accessibilityLabel="Emoji">
              <Text style={styles.emojiGlyph}>😊</Text>
            </Pressable>
            <Pressable onPress={() => void onPickDoc()} style={styles.roundBtn} accessibilityLabel="Attach file">
              <FontAwesome name="paperclip" size={18} color={TacticalPalette.bone} />
            </Pressable>
            <Pressable onPress={() => void onPickImage()} style={styles.roundBtn} accessibilityLabel="Attach image">
              <FontAwesome name="image" size={18} color={TacticalPalette.bone} />
            </Pressable>
            <Pressable onPress={() => void onShareLocation()} style={styles.roundBtn} accessibilityLabel="Share location">
              <FontAwesome name="map-marker" size={18} color={TacticalPalette.bone} />
            </Pressable>
            <TextInput
              placeholder={status === "connected" ? "Message…" : "Connecting…"}
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
      )}

      <Modal visible={emojiOpen} transparent animationType="fade" onRequestClose={() => setEmojiOpen(false)}>
        <Pressable style={styles.emojiScrim} onPress={() => setEmojiOpen(false)}>
          <View style={styles.emojiCard}>
            <Text style={styles.emojiTitle}>Emoji</Text>
            <View style={styles.emojiGrid}>
              {EMOJI_QUICK.map((e) => (
                <Pressable key={e} onPress={() => appendEmoji(e)} style={styles.emojiCell}>
                  <Text style={styles.emojiBig}>{e}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function SegmentBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.segBtn, active && styles.segBtnOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}>
      <Text style={[styles.segTx, active && styles.segTxOn]}>{label}</Text>
    </Pressable>
  );
}

function MessageRow({
  item,
  profileId,
  selfName,
  delivery,
  readByPeer,
}: {
  item: LiveChatEnvelope;
  profileId: string;
  selfName: string;
  delivery?: "sent" | "delivered";
  readByPeer: boolean;
}) {
  const mine = item.sender_user_id === profileId;
  const who = mine ? selfName : item.sender_display_name || item.sender_user_id.slice(0, 8) || "Member";
  const t = new Date(item.created_at_ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  let receiptTxt = "";
  if (mine) {
    if (item.message_id.startsWith("local-")) receiptTxt = "…";
    else if (readByPeer) receiptTxt = "✓✓";
    else if (delivery === "delivered") receiptTxt = "✓✓";
    else receiptTxt = "✓";
  }
  const receipt =
    mine && receiptTxt ? (
      <Text style={[styles.receipt, readByPeer && receiptTxt === "✓✓" && styles.receiptRead]}>{receiptTxt}</Text>
    ) : null;

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <View style={styles.bubbleHead}>
          <Text style={styles.meta} numberOfLines={1}>
            {who} · {t}
          </Text>
          {receipt}
        </View>
        {item.kind === "image" && item.attachment?.public_url ? (
          <Image source={{ uri: item.attachment.public_url }} style={styles.attImage} resizeMode="cover" />
        ) : null}
        {item.kind === "file" && item.attachment ? (
          <View style={styles.filePill}>
            <FontAwesome name="file-o" size={16} color={TacticalPalette.bone} />
            <Text style={styles.fileTx} numberOfLines={2}>
              {item.attachment.filename || item.text || "File"}
            </Text>
          </View>
        ) : null}
        {item.kind === "location" && item.location ? (
          <Pressable
            onPress={() =>
              void Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${item.location!.lat},${item.location!.lng}`,
              )
            }>
            {Platform.OS === "web" ? (
              <Image source={{ uri: staticMapUri(item.location.lat, item.location.lng) }} style={styles.mapPrev} />
            ) : (
              <MapView
                style={styles.mapPrev}
                scrollEnabled={false}
                zoomTapEnabled={false}
                zoomEnabled={false}
                pitchEnabled={false}
                rotateEnabled={false}
                region={{
                  latitude: item.location.lat,
                  longitude: item.location.lng,
                  latitudeDelta: 0.02,
                  longitudeDelta: 0.02,
                }}>
                <Marker coordinate={{ latitude: item.location.lat, longitude: item.location.lng }} />
              </MapView>
            )}
            <Text style={styles.mapLink}>Open in maps</Text>
          </Pressable>
        ) : null}
        {item.kind === "text" && item.text ? <Text style={styles.msg}>{item.text}</Text> : null}
        {item.kind === "image" && item.text && item.text !== item.attachment?.filename ? (
          <Text style={styles.msg}>{item.text}</Text>
        ) : null}
        {item.kind === "file" && item.text && item.text !== item.attachment?.filename ? (
          <Text style={styles.msg}>{item.text}</Text>
        ) : null}
        {item.kind === "location" && item.text ? <Text style={styles.msg}>{item.text}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0, backgroundColor: TacticalPalette.matteBlack },
  header: {
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: TacticalPalette.border,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  title: { color: TacticalPalette.bone, fontWeight: "900", fontSize: 15, marginBottom: 8 },
  segment: { flexDirection: "row", gap: 8 },
  segBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    backgroundColor: TacticalPalette.charcoal,
  },
  segBtnOn: { borderColor: TacticalPalette.coyote, backgroundColor: "rgba(107,142,92,0.2)" },
  segTx: { color: TacticalPalette.boneMuted, fontWeight: "800", fontSize: 13 },
  segTxOn: { color: TacticalPalette.bone },
  status: { color: TacticalPalette.boneMuted, fontWeight: "800", fontSize: 11 },
  headerBtn: { color: TacticalPalette.coyote, fontWeight: "900", fontSize: 13 },
  err: { color: TacticalPalette.danger, paddingHorizontal: 12, paddingTop: 6, fontWeight: "700", fontSize: 13 },
  body: { flex: 1, minHeight: 0 },
  contactsWrap: { flex: 1, paddingHorizontal: 12, paddingTop: 12 },
  contactsHint: { color: TacticalPalette.boneMuted, fontSize: 13, marginBottom: 12 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: TacticalPalette.panel,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    marginBottom: 10,
  },
  contactName: { flex: 1, color: TacticalPalette.bone, fontWeight: "800", fontSize: 16 },
  emptyContacts: { color: TacticalPalette.boneMuted, marginTop: 20, textAlign: "center" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: TacticalPalette.border,
    backgroundColor: TacticalPalette.matteBlack,
  },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: TacticalPalette.charcoal,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiGlyph: { fontSize: 20 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: TacticalPalette.bone,
    fontSize: 15,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: TacticalPalette.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { paddingHorizontal: 10, paddingVertical: 5 },
  rowMine: { alignItems: "flex-end" },
  rowTheirs: { alignItems: "flex-start" },
  bubble: {
    maxWidth: 520,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bubbleMine: { backgroundColor: "rgba(107,142,92,0.28)", borderColor: TacticalPalette.coyote },
  bubbleTheirs: { backgroundColor: TacticalPalette.panel, borderColor: TacticalPalette.border },
  bubbleHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 },
  meta: { color: TacticalPalette.boneMuted, fontSize: 11, fontWeight: "700", flex: 1 },
  receipt: { color: TacticalPalette.boneMuted, fontSize: 12, fontWeight: "800" },
  receiptRead: { color: TacticalPalette.coyote },
  msg: { color: TacticalPalette.bone, fontSize: 15, lineHeight: 20 },
  attImage: { width: 220, height: 160, borderRadius: 12, marginTop: 4, backgroundColor: TacticalPalette.charcoal },
  filePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.2)",
    marginTop: 4,
  },
  fileTx: { color: TacticalPalette.bone, fontSize: 14, fontWeight: "600", flex: 1 },
  mapPrev: { width: 260, height: 120, borderRadius: 12, marginTop: 4, backgroundColor: TacticalPalette.charcoal },
  mapLink: { color: TacticalPalette.coyote, fontWeight: "800", fontSize: 13, marginTop: 6 },
  emojiScrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
    paddingBottom: 40,
  },
  emojiCard: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: TacticalPalette.elevated,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
  },
  emojiTitle: { color: TacticalPalette.bone, fontWeight: "900", marginBottom: 12 },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  emojiCell: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: TacticalPalette.charcoal,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiBig: { fontSize: 26 },
});
