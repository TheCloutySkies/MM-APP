import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    FlatList,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { TacticalColors } from "@/constants/TacticalTheme";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { useLiveComms } from "@/hooks/useLiveComms";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import type { E2eeChatMessage } from "@/lib/e2ee/types";

function ModeChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const chrome = useTacticalChrome();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: active ? chrome.tint : TacticalPalette.border,
          backgroundColor: active ? "rgba(107,142,92,0.2)" : "transparent",
        },
      ]}>
      <Text style={[styles.chipTx, { color: active ? chrome.text : chrome.tabIconDefault }]}>{label}</Text>
    </Pressable>
  );
}

type Props = { variant: "trailing" | "sheet"; onCloseSheet?: () => void };

export function LiveCommsPanel({ variant, onCloseSheet }: Props) {
  const chrome = useTacticalChrome();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<E2eeChatMessage>>(null);
  const [draft, setDraft] = useState("");

  const {
    webOk,
    commsMode,
    setCommsMode,
    peerInput,
    setPeerInput,
    activePeerId,
    applyPeer,
    messages,
    panelPin,
    setPanelPin,
    unlocked,
    unlockComms,
    createIdentity,
    hasIdentityDevice,
    status,
    sendText,
    username,
    profileId,
    createGlobalChannel,
    invitePeerId,
    setInvitePeerId,
    inviteToGlobal,
    syncGroupKey,
    channelRoster,
  } = useLiveComms();

  useEffect(() => {
    if (messages.length) listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const onSend = useCallback(() => {
    void sendText(draft);
    setDraft("");
  }, [draft, sendText]);

  if (!webOk) {
    return (
      <View style={[styles.wrap, { borderColor: TacticalPalette.border, padding: 16 }]}>
        <Text style={[styles.title, { color: chrome.text }]}>Live comms</Text>
        <Text style={[styles.hint, { color: chrome.tabIconDefault }]}>
          E2EE live messaging uses Web Crypto + IndexedDB. Install or open the PWA in a desktop or mobile browser.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.wrap,
        variant === "sheet" ? styles.wrapFullBleed : null,
        {
          borderColor: TacticalPalette.border,
          paddingTop: variant === "trailing" ? Math.max(12, insets.top) : 12,
          paddingBottom: variant === "sheet" ? Math.max(16, insets.bottom) : 12,
        },
      ]}>
      <View style={styles.headRow}>
        <View>
          <Text style={[styles.kicker, { color: chrome.tabIconDefault }]}>SECURE CHAN</Text>
          <Text style={[styles.title, { color: chrome.text }]}>Live comms</Text>
        </View>
        {variant === "sheet" && onCloseSheet ? (
          <Pressable onPress={onCloseSheet} hitSlop={12} accessibilityRole="button">
            <FontAwesome name="times" size={22} color={chrome.tint} />
          </Pressable>
        ) : null}
      </View>

      {!hasIdentityDevice ? (
        <ScrollView style={styles.setupScroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: chrome.tabIconDefault }]}>
            Creates a P-384 identity on this device. Your public key uploads to Supabase; the private key stays in
            encrypted local storage (PBKDF2 + your vault PIN).
          </Text>
          <TextInput
            placeholder="Vault PIN"
            placeholderTextColor={TacticalPalette.boneMuted}
            secureTextEntry
            keyboardType="number-pad"
            value={panelPin}
            onChangeText={setPanelPin}
            style={[styles.input, { color: chrome.text, borderColor: TacticalPalette.border }]}
          />
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: chrome.tint }]}
            onPress={() => void createIdentity()}>
            <Text style={[styles.primaryTx, { color: TacticalPalette.matteBlack }]}>Enable E2EE identity</Text>
          </Pressable>
        </ScrollView>
      ) : !unlocked ? (
        <ScrollView style={styles.setupScroll} keyboardShouldPersistTaps="handled">
          <TextInput
            placeholder="PIN to unlock identity"
            placeholderTextColor={TacticalPalette.boneMuted}
            secureTextEntry
            keyboardType="number-pad"
            value={panelPin}
            onChangeText={setPanelPin}
            style={[styles.input, { color: chrome.text, borderColor: TacticalPalette.border }]}
          />
          <Pressable style={[styles.primaryBtn, { backgroundColor: chrome.tint }]} onPress={() => void unlockComms()}>
            <Text style={[styles.primaryTx, { color: TacticalPalette.matteBlack }]}>Unlock</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <>
          <View style={styles.modeRow}>
            <ModeChip label="Global" active={commsMode === "grp"} onPress={() => setCommsMode("grp")} />
            <ModeChip label="Direct" active={commsMode === "dm"} onPress={() => setCommsMode("dm")} />
          </View>

          {commsMode === "dm" ? (
            <View style={styles.dmSetup}>
              <TextInput
                placeholder="Peer profile UUID"
                placeholderTextColor={TacticalPalette.boneMuted}
                value={peerInput}
                onChangeText={setPeerInput}
                autoCapitalize="none"
                style={[styles.inputSm, { color: chrome.text, borderColor: TacticalPalette.border }]}
              />
              <Pressable style={[styles.secondaryBtn, { borderColor: chrome.tint }]} onPress={applyPeer}>
                <Text style={{ color: chrome.tint, fontWeight: "700" }}>Set peer</Text>
              </Pressable>
              {activePeerId ? (
                <Text style={[styles.peerTx, { color: chrome.tabIconDefault }]}>→ {activePeerId.slice(0, 8)}…</Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.grpAdmin}>
              <Pressable
                style={[styles.secondaryBtn, { borderColor: TacticalPalette.border }]}
                onPress={() => void createGlobalChannel()}>
                <Text style={{ color: chrome.text, fontWeight: "700", fontSize: 12 }}>Init / recover global key</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, { borderColor: TacticalPalette.border }]}
                onPress={() => void syncGroupKey()}>
                <Text style={{ color: chrome.text, fontWeight: "700", fontSize: 12 }}>Refresh group key</Text>
              </Pressable>
              <TextInput
                placeholder="Invitee UUID (admin)"
                placeholderTextColor={TacticalPalette.boneMuted}
                value={invitePeerId}
                onChangeText={setInvitePeerId}
                style={[styles.inputSm, { color: chrome.text, borderColor: TacticalPalette.border }]}
              />
              <Pressable style={[styles.secondaryBtn, { borderColor: chrome.tint }]} onPress={() => void inviteToGlobal()}>
                <Text style={{ color: chrome.tint, fontWeight: "700", fontSize: 12 }}>Distribute wrap</Text>
              </Pressable>
            </View>
          )}

          {status ? (
            <Text style={[styles.status, { color: TacticalPalette.coyote }]} numberOfLines={3}>
              {status}
            </Text>
          ) : null}

          {commsMode === "grp" && channelRoster.length ? (
            <View style={styles.rosterBlock}>
              <Text style={[styles.rosterLabel, { color: chrome.tabIconDefault }]}>
                Recent senders (metadata only — envelope IDs)
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rosterScroll}>
                {channelRoster.map((id) => (
                  <View key={id} style={[styles.rosterChip, { borderColor: TacticalPalette.border }]}>
                    <Text style={[styles.rosterChipTx, { color: chrome.tabIconDefault }]} selectable>
                      {id.slice(0, 8)}…
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.clientMsgId}
            style={styles.msgList}
            contentContainerStyle={styles.msgListInner}
            renderItem={({ item }) => (
              <MessageBubble item={item} selfName={username ?? "?"} chrome={chrome} />
            )}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: chrome.tabIconDefault }]}>No decrypted traffic yet.</Text>
            }
          />

          <View style={styles.composer}>
            <TextInput
              placeholder="Type ciphertext precursor…"
              placeholderTextColor={TacticalPalette.boneMuted}
              value={draft}
              onChangeText={setDraft}
              multiline
              style={[styles.composerInput, { color: chrome.text, borderColor: TacticalPalette.border }]}
            />
            <Pressable
              style={[styles.sendFab, { backgroundColor: chrome.tint }]}
              onPress={onSend}
              accessibilityRole="button">
              <FontAwesome name="send" size={16} color={TacticalPalette.matteBlack} />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function MessageBubble({
  item,
  selfName,
  chrome,
}: {
  item: E2eeChatMessage;
  selfName: string;
  chrome: TacticalColors;
}) {
  const mine = item.mine;
  const who = mine ? selfName : item.fromId.slice(0, 8);
  const t = new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: mine ? "rgba(107,142,92,0.25)" : TacticalPalette.panel,
            borderColor: mine ? chrome.tint : TacticalPalette.border,
          },
        ]}>
        <Text style={[styles.bubbleMeta, { color: chrome.tabIconDefault }]}>
          {who} · {t}
        </Text>
        <Text style={[styles.bubbleBody, { color: chrome.text }]} selectable>
          {item.plaintext}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minWidth: 280,
    maxWidth: 400,
    borderLeftWidth: StyleSheet.hairlineWidth,
    backgroundColor: TacticalPalette.matteBlack,
  },
  wrapFullBleed: {
    alignSelf: "stretch",
    maxWidth: 9999,
    width: "100%",
  },
  headRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  kicker: { fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  title: { fontSize: 18, fontWeight: "800" },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  setupScroll: { flex: 1, paddingHorizontal: 14 },
  modeRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, marginBottom: 10 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipTx: { fontSize: 13, fontWeight: "800" },
  dmSetup: { paddingHorizontal: 14, gap: 8, marginBottom: 8 },
  grpAdmin: { paddingHorizontal: 14, gap: 8, marginBottom: 8 },
  rosterBlock: { paddingHorizontal: 14, marginBottom: 8, gap: 6 },
  rosterLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  rosterScroll: { flexDirection: "row", gap: 6, paddingVertical: 2 },
  rosterChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  rosterChipTx: { fontSize: 11, fontVariant: ["tabular-nums"] },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    marginBottom: 10,
  },
  inputSm: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
  },
  primaryBtn: { paddingVertical: 14, borderRadius: 12, alignItems: "center", marginBottom: 12 },
  primaryTx: { fontSize: 15, fontWeight: "800" },
  secondaryBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  peerTx: { fontSize: 11, marginTop: 4 },
  status: { fontSize: 11, paddingHorizontal: 14, marginBottom: 6 },
  msgList: { flex: 1 },
  msgListInner: { paddingHorizontal: 10, paddingBottom: 8 },
  empty: { textAlign: "center", marginTop: 24, fontSize: 13 },
  bubbleRow: { marginBottom: 10, flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowTheirs: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "92%",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bubbleMeta: { fontSize: 11, marginBottom: 4, fontWeight: "600" },
  bubbleBody: { fontSize: 15, lineHeight: 21 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TacticalPalette.border,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
