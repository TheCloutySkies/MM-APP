import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { TacticalColors } from "@/constants/TacticalTheme";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { useLiveComms } from "@/hooks/useLiveComms";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import {
    CHAT_IMAGE_B64_MAX,
    encodeChatImagePayload,
    tryParseChatImagePayload,
} from "@/lib/comms/chatImagePayload";
import {
    encodeVaultAttachPayload,
    tryParseVaultAttachPayload,
    type VaultAttachPayloadV1,
} from "@/lib/comms/vaultAttachPayload";
import { aes256GcmDecrypt, type AeadBundle } from "@/lib/crypto/aesGcm";
import { utf8, utf8decode } from "@/lib/crypto/bytes";
import type { E2eeChatMessage } from "@/lib/e2ee/types";
import { vaultItemDisplayName } from "@/lib/vaultNaming";
import { useMMStore } from "@/store/mmStore";

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

type Props = {
  variant: "trailing" | "sheet";
  onCloseSheet?: () => void;
  /** Desktop rail only: collapse this panel back to the floating “Comms” bubble. */
  onCollapseTrailing?: () => void;
};

type VaultObjectRow = { id: string; storage_path: string; created_at: string };

export function LiveCommsPanel({ variant, onCloseSheet, onCollapseTrailing }: Props) {
  const chrome = useTacticalChrome();
  const supabase = useMMStore((s) => s.supabase);
  const vaultMode = useMMStore((s) => s.vaultMode);
  const mainVaultKey = useMMStore((s) => s.mainVaultKey);
  const decoyVaultKey = useMMStore((s) => s.decoyVaultKey);
  const vaultKey = vaultMode === "main" ? mainVaultKey : vaultMode === "decoy" ? decoyVaultKey : null;
  const vaultPrefix = vaultMode ?? "main";
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<E2eeChatMessage>>(null);
  const [draft, setDraft] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showManualDmId, setShowManualDmId] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [invitePickOpen, setInvitePickOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [vaultRows, setVaultRows] = useState<VaultObjectRow[]>([]);
  const [vaultListLoading, setVaultListLoading] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyPhrase, setVerifyPhrase] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

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
    commsPinBusy,
    unlockComms,
    createIdentity,
    hasIdentityDevice,
    status,
    setStatus,
    sendText,
    sendMessageBody,
    username,
    profileId,
    createGlobalChannel,
    invitePeerId,
    setInvitePeerId,
    inviteToGlobal,
    syncGroupKey,
    channelRoster,
    groupChannelReady,
    commsAdmin,
    retryTeamChannel,
    openDmWith,
    backFromDm,
    reloadChatHistory,
    sendPriorityEmail,
    directoryPeers,
    directoryError,
    refreshChatDirectory,
    usernameForPeerId,
    dmTrustVisual,
    buildVerifyPhraseForPeer,
    applyVerifiedForActiveDm,
    outboxSyncHalted,
    outboxSyncHaltKind,
    retryOutboxSync,
  } = useLiveComms();

  const chatPeersOthers = directoryPeers.filter((p) => p.id !== profileId);
  const inviteCandidates = directoryPeers.filter((p) => p.id !== profileId);
  const dmFocused = unlocked && commsMode === "dm" && activePeerId != null;

  const mentionTail = (() => {
    const m = draft.match(/@([a-zA-Z0-9._-]*)$/);
    return m ? m[1].toLowerCase() : null;
  })();
  const mentionCandidates =
    mentionTail != null
      ? chatPeersOthers.filter((p) => p.username.toLowerCase().includes(mentionTail))
      : [];

  const insertMention = useCallback((handle: string) => {
    const i = draft.lastIndexOf("@");
    if (i < 0) return;
    setDraft(`${draft.slice(0, i)}@${handle} `);
  }, [draft]);

  const pickAndSendChatImage = useCallback(async () => {
    if (!webOk) {
      Alert.alert("Photos", "Image uploads are available in the web team chat.");
      return;
    }
    if (commsMode === "dm" && !activePeerId) {
      Alert.alert("Chat", "Pick someone to message first.");
      return;
    }
    if (commsMode === "grp" && !groupChannelReady) {
      Alert.alert("Team chat", "Connect to the team channel before sending photos.");
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Photos", "Allow photo access in your browser or OS settings.");
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.45,
        base64: true,
        allowsEditing: false,
      });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      const b64 = a.base64;
      if (!b64) {
        Alert.alert("Image", "Could not read that image. Try another file.");
        return;
      }
      if (b64.length > CHAT_IMAGE_B64_MAX) {
        Alert.alert("Image too large", "Pick a smaller photo (roughly under ~300KB).");
        return;
      }
      const mime = a.mimeType && a.mimeType.startsWith("image/") ? a.mimeType : "image/jpeg";
      await sendMessageBody(encodeChatImagePayload({ v: 1, mime, b64 }));
    } catch {
      Alert.alert("Image", "Could not attach that photo.");
    }
  }, [webOk, commsMode, activePeerId, groupChannelReady, sendMessageBody]);

  useEffect(() => {
    if (!attachOpen || !supabase) return;
    setVaultListLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("vault_objects")
        .select("id, storage_path, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        setVaultRows([]);
        setVaultListLoading(false);
        return;
      }
      setVaultRows((data ?? []) as VaultObjectRow[]);
      setVaultListLoading(false);
    })();
  }, [attachOpen, supabase]);

  const openVaultAttachment = useCallback(
    async (p: VaultAttachPayloadV1, senderId: string) => {
      if (!supabase) return;
      if (senderId !== profileId) {
        Alert.alert(
          "Vault attachment",
          "This file is stored in your teammate’s private vault. Team chat can’t open someone else’s vault objects on Supabase. Ask them to share through a team report or export.",
        );
        return;
      }
      if (!vaultKey || vaultKey.length !== 32) {
        Alert.alert("Vault", "Unlock your vault to decrypt this file.");
        return;
      }
      try {
        const { data: file, error } = await supabase.storage.from("vault").download(p.storagePath);
        if (error || !file) {
          Alert.alert("Download", error?.message ?? "Failed");
          return;
        }
        const txt = await file.text();
        const bundle = JSON.parse(txt) as AeadBundle;
        const plain = aes256GcmDecrypt(vaultKey, bundle, utf8(`mm-vault/${vaultPrefix}`));
        const preview = utf8decode(plain.slice(0, Math.min(120, plain.length)));
        Alert.alert(
          p.label,
          `Decrypted ${plain.length} bytes.\n\nPreview:\n${preview}${plain.length > 120 ? "…" : ""}`,
          [{ text: "OK", style: "default" }],
        );
      } catch {
        Alert.alert("Vault", "Could not decrypt. Wrong vault or damaged file.");
      }
    },
    [supabase, profileId, vaultKey, vaultPrefix],
  );

  useEffect(() => {
    if (messages.length) listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  useEffect(() => {
    if (!verifyOpen || !activePeerId) {
      setVerifyPhrase(null);
      setVerifyLoading(false);
      return;
    }
    let cancelled = false;
    setVerifyLoading(true);
    setVerifyPhrase(null);
    void (async () => {
      const phrase = await buildVerifyPhraseForPeer(activePeerId);
      if (cancelled) return;
      setVerifyPhrase(phrase);
      setVerifyLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [verifyOpen, activePeerId, buildVerifyPhraseForPeer]);

  const onSend = useCallback(() => {
    void sendText(draft);
    setDraft("");
  }, [draft, sendText]);

  if (!webOk) {
    return (
      <View style={[styles.wrap, { borderColor: TacticalPalette.border, padding: 16 }]}>
        <Text style={[styles.title, { color: chrome.text }]}>Team chat</Text>
        <Text style={[styles.hint, { color: chrome.tabIconDefault }]}>
          Encrypted chat runs in the browser. Open MM in Chrome or Safari (or install the PWA) to message your team like
          a normal chat app — keys are handled for you.
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
      {unlocked && dmFocused ? (
        <View style={[styles.headRow, { alignItems: "center" }]}>
          <Pressable onPress={backFromDm} hitSlop={14} accessibilityRole="button" accessibilityLabel="Back to team chat">
            <FontAwesome name="chevron-left" size={20} color={chrome.tint} />
          </Pressable>
          <View style={{ flex: 1, paddingHorizontal: 10 }}>
            <Text style={[styles.kicker, { color: chrome.tabIconDefault }]}>DIRECT</Text>
            <Text style={[styles.title, { color: chrome.text }]} numberOfLines={1}>
              {activePeerId ? usernameForPeerId(activePeerId) : ""}
            </Text>
            <Text style={[styles.subHead, { color: chrome.tabIconDefault }]}>
              Private thread — history reloads from the server on open.
            </Text>
          </View>
          <Pressable
            onPress={() => void reloadChatHistory()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Reload messages from server">
            <FontAwesome name="history" size={18} color={chrome.tabIconDefault} />
          </Pressable>
          <Pressable
            onPress={() => setVerifyOpen(true)}
            hitSlop={10}
            style={{ marginLeft: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Verify security words">
            <FontAwesome name="shield" size={18} color={chrome.tint} />
          </Pressable>
          {variant === "sheet" && onCloseSheet ? (
            <Pressable onPress={onCloseSheet} hitSlop={12} style={{ marginLeft: 8 }} accessibilityRole="button">
              <FontAwesome name="times" size={22} color={chrome.tint} />
            </Pressable>
          ) : null}
          {variant === "trailing" && onCollapseTrailing ? (
            <Pressable
              onPress={onCollapseTrailing}
              hitSlop={12}
              style={{ marginLeft: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Collapse team chat">
              <FontAwesome name="chevron-right" size={20} color={chrome.tabIconDefault} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.headRow}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={[styles.kicker, { color: chrome.tabIconDefault }]}>SECURE CHAN</Text>
            <Text style={[styles.title, { color: chrome.text }]}>Team chat</Text>
            <Text style={[styles.subHead, { color: chrome.tabIconDefault }]}>
              Works like regular texting. Your vault PIN protects this browser’s copy of your keys.
            </Text>
          </View>
          {variant === "sheet" && onCloseSheet ? (
            <Pressable onPress={onCloseSheet} hitSlop={12} accessibilityRole="button">
              <FontAwesome name="times" size={22} color={chrome.tint} />
            </Pressable>
          ) : null}
          {variant === "trailing" && onCollapseTrailing ? (
            <Pressable
              onPress={onCollapseTrailing}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Collapse team chat">
              <FontAwesome name="chevron-right" size={22} color={chrome.tabIconDefault} />
            </Pressable>
          ) : null}
        </View>
      )}

      {!hasIdentityDevice ? (
        <ScrollView style={styles.setupScroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: chrome.tabIconDefault }]}>
            This browser needs a one-time key setup (usually automatic when you sign in). If you cleared site data or
            use a new browser, enter your vault PIN and continue — you won’t see codes or keys, only this step.
          </Text>
          <TextInput
            placeholder="Vault PIN"
            placeholderTextColor={TacticalPalette.boneMuted}
            secureTextEntry
            keyboardType="number-pad"
            editable={!commsPinBusy}
            value={panelPin}
            onChangeText={setPanelPin}
            style={[styles.input, { color: chrome.text, borderColor: TacticalPalette.border }]}
          />
          <Pressable
            disabled={commsPinBusy}
            style={[
              styles.primaryBtn,
              { backgroundColor: chrome.tint, opacity: commsPinBusy ? 0.7 : 1 },
            ]}
            onPress={() => void createIdentity()}>
            {commsPinBusy ? (
              <ActivityIndicator color={TacticalPalette.matteBlack} />
            ) : (
              <Text style={[styles.primaryTx, { color: TacticalPalette.matteBlack }]}>Continue</Text>
            )}
          </Pressable>
        </ScrollView>
      ) : !unlocked ? (
        <ScrollView style={styles.setupScroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: chrome.tabIconDefault }]}>
            Enter your vault PIN to open team chat on this browser.
          </Text>
          <TextInput
            placeholder="Vault PIN"
            placeholderTextColor={TacticalPalette.boneMuted}
            secureTextEntry
            keyboardType="number-pad"
            editable={!commsPinBusy}
            value={panelPin}
            onChangeText={setPanelPin}
            style={[styles.input, { color: chrome.text, borderColor: TacticalPalette.border }]}
          />
          <Pressable
            disabled={commsPinBusy}
            style={[
              styles.primaryBtn,
              { backgroundColor: chrome.tint, opacity: commsPinBusy ? 0.7 : 1 },
            ]}
            onPress={() => void unlockComms()}>
            {commsPinBusy ? (
              <ActivityIndicator color={TacticalPalette.matteBlack} />
            ) : (
              <Text style={[styles.primaryTx, { color: TacticalPalette.matteBlack }]}>Unlock chat</Text>
            )}
          </Pressable>
        </ScrollView>
      ) : (
        <View style={styles.unlockedColumn}>
          {outboxSyncHalted ? (
            <View
              style={[
                styles.syncHaltedBanner,
                { borderColor: "rgba(220, 160, 160, 0.35)", backgroundColor: "rgba(92, 40, 50, 0.92)" },
              ]}>
              <Text style={styles.syncHaltedBannerTx}>
                {outboxSyncHaltKind === "server"
                  ? "SYNC HALTED: Secure connection rejected. Check admin logs."
                  : "SYNC HALTED: No connection. Messages stay queued locally."}
              </Text>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.syncHaltedRetry,
                  { borderColor: TacticalPalette.boneMuted, opacity: pressed ? 0.85 : 1 },
                ]}
                onPress={() => void retryOutboxSync()}>
                <Text style={styles.syncHaltedRetryTx}>Retry Sync</Text>
              </Pressable>
            </View>
          ) : null}

          {!dmFocused ? (
            <View style={styles.actionRow}>
              <Pressable
                style={[styles.newMsgBtn, { backgroundColor: chrome.tint }]}
                onPress={() => {
                  void refreshChatDirectory();
                  setNewChatOpen(true);
                }}
                accessibilityRole="button">
                <FontAwesome name="plus" size={14} color={TacticalPalette.matteBlack} />
                <Text style={[styles.newMsgBtnTx, { color: TacticalPalette.matteBlack }]}>New message</Text>
              </Pressable>
            </View>
          ) : null}

          {!dmFocused && commsMode === "grp" && !groupChannelReady ? (
            <View style={[styles.banner, { borderColor: chrome.tint, backgroundColor: "rgba(107,142,92,0.12)" }]}>
              <Text style={[styles.bannerTx, { color: chrome.text }]}>
                Connecting to the team channel… If this stays a while, your organizer may still be adding you.
              </Text>
              <Pressable
                style={[styles.primaryBtnSm, { backgroundColor: chrome.tint }]}
                onPress={() => void retryTeamChannel()}>
                <Text style={[styles.primaryTxSm, { color: TacticalPalette.matteBlack }]}>Refresh team access</Text>
              </Pressable>
            </View>
          ) : null}

          {!dmFocused ? (
            <View style={styles.modeRow}>
              <ModeChip label="Team" active={commsMode === "grp"} onPress={() => setCommsMode("grp")} />
              <ModeChip label="Direct" active={commsMode === "dm"} onPress={() => setCommsMode("dm")} />
            </View>
          ) : null}

          {!dmFocused && commsMode === "dm" ? (
            <View style={styles.dmSetup}>
              {activePeerId ? (
                <View style={styles.dmHead}>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Text style={[styles.dmPeerTitle, { color: chrome.text }]}>{usernameForPeerId(activePeerId)}</Text>
                    {dmTrustVisual === "ok" ? (
                      <FontAwesome name="check-circle" size={16} color={TacticalPalette.success} />
                    ) : dmTrustVisual === "broken" ? (
                      <FontAwesome name="exclamation-circle" size={16} color={TacticalPalette.coyote} />
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => setVerifyOpen(true)}
                    style={[styles.verifyPill, { borderColor: chrome.tint }]}
                    accessibilityRole="button">
                    <Text style={{ color: chrome.tint, fontSize: 12, fontWeight: "800" }}>Verify</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={[styles.hintSm, { color: chrome.tabIconDefault }]}>
                  Tap <Text style={{ fontWeight: "800" }}>New message</Text> and choose a teammate, the same as any chat app.
                </Text>
              )}
              {showManualDmId ? (
                <>
                  <Text style={[styles.hintSm, { color: chrome.tabIconDefault }]}>Advanced — raw member ID:</Text>
                  <TextInput
                    placeholder="Paste only if support asked you to"
                    placeholderTextColor={TacticalPalette.boneMuted}
                    value={peerInput}
                    onChangeText={setPeerInput}
                    autoCapitalize="none"
                    style={[styles.inputSm, { color: chrome.text, borderColor: TacticalPalette.border }]}
                  />
                  <Pressable style={[styles.secondaryBtn, { borderColor: chrome.tint }]} onPress={applyPeer}>
                    <Text style={{ color: chrome.tint, fontWeight: "700" }}>Start chat</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable onPress={() => setShowManualDmId(true)} hitSlop={8}>
                  <Text style={{ color: chrome.tabIconDefault, fontWeight: "600", fontSize: 12 }}>
                    Advanced: enter raw ID…
                  </Text>
                </Pressable>
              )}
            </View>
          ) : !dmFocused ? (
            <View style={styles.grpHint}>
              <Text style={[styles.hintSm, { color: chrome.tabIconDefault }]}>
                Group thread for everyone on the team channel. Messages are encrypted on your device before they go out.
              </Text>
            </View>
          ) : null}

          {!dmFocused ? (
            <>
              <Pressable
                onPress={() => setShowAdvanced((x) => !x)}
                style={styles.advancedToggle}
                accessibilityRole="button">
                <Text style={{ color: chrome.tabIconDefault, fontSize: 12, fontWeight: "700" }}>
                  {showAdvanced ? "▼" : "▶"} Admin & troubleshooting
                </Text>
              </Pressable>

              {showAdvanced ? (
            <View style={styles.advancedBox}>
              <Text style={[styles.hintSm, { color: chrome.tabIconDefault, marginBottom: 8 }]}>
                {commsAdmin
                  ? "Organizer tools — most people never need this menu."
                  : "Reload your team key if an organizer just added you."}
              </Text>
              <Pressable
                style={[styles.secondaryBtn, { borderColor: TacticalPalette.border }]}
                onPress={() => void syncGroupKey()}>
                <Text style={{ color: chrome.text, fontWeight: "700", fontSize: 12 }}>Reload team key</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, { borderColor: TacticalPalette.border }]}
                onPress={() => void retryTeamChannel()}>
                <Text style={{ color: chrome.text, fontWeight: "700", fontSize: 12 }}>Full refresh</Text>
              </Pressable>
              {commsAdmin ? (
                <>
                  <Pressable
                    style={[styles.secondaryBtn, { borderColor: TacticalPalette.border }]}
                    onPress={() => void createGlobalChannel()}>
                    <Text style={{ color: chrome.text, fontWeight: "700", fontSize: 12 }}>Create team channel (first run)</Text>
                  </Pressable>
                  <Text style={[styles.hintSm, { color: chrome.tabIconDefault }]}>Give a teammate access to team chat:</Text>
                  <Pressable
                    style={[styles.secondaryBtn, { borderColor: TacticalPalette.border }]}
                    onPress={() => {
                      void refreshChatDirectory();
                      setInvitePickOpen(true);
                    }}>
                    <Text style={{ color: chrome.text, fontWeight: "700", fontSize: 12 }}>
                      {invitePeerId ? `Selected: ${usernameForPeerId(invitePeerId)}` : "Choose teammate…"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.secondaryBtn,
                      { borderColor: chrome.tint, opacity: invitePeerId ? 1 : 0.45 },
                    ]}
                    disabled={!invitePeerId}
                    onPress={() => void inviteToGlobal()}>
                    <Text style={{ color: chrome.tint, fontWeight: "700", fontSize: 12 }}>Send team invite</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
              ) : null}
            </>
          ) : null}

          {status ? (
            <Text style={[styles.status, { color: TacticalPalette.coyote }]} numberOfLines={4}>
              {status}
            </Text>
          ) : null}

          {!dmFocused && channelRoster.length ? (
            <View style={styles.rosterBlock}>
              <Text style={[styles.rosterLabel, { color: chrome.tabIconDefault }]}>
                Active on team chat — tap to message privately
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rosterScroll}>
                {channelRoster.map((id) => {
                  const mine = id === profileId;
                  const label = usernameForPeerId(id);
                  return (
                    <Pressable
                      key={id}
                      onPress={() =>
                        mine ? setStatus("That’s you — pick someone else for a direct message.") : openDmWith(id)
                      }
                      style={[styles.rosterChip, { borderColor: mine ? chrome.tint : TacticalPalette.border }]}>
                      <Text style={[styles.rosterChipTx, { color: mine ? chrome.tint : chrome.text }]}>
                        {mine ? "You" : label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {mentionCandidates.length > 0 && mentionTail != null ? (
            <View style={styles.mentionBar}>
              <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
                {mentionCandidates.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => insertMention(p.username)}
                    style={[styles.mentionChip, { borderColor: TacticalPalette.border }]}>
                    <Text style={{ color: chrome.text, fontWeight: "700", fontSize: 12 }}>@{p.username}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.msgComposeColumn}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => `${m.clientMsgId || m.id}|${m.ts}`}
            style={styles.msgList}
            contentContainerStyle={styles.msgListInner}
            renderItem={({ item }) => (
              <MessageBubble
                item={item}
                selfName={username ?? "You"}
                resolveName={usernameForPeerId}
                profileId={profileId ?? ""}
                onOpenVaultAttachment={openVaultAttachment}
                chrome={chrome}
              />
            )}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: chrome.tabIconDefault }]}>
                {commsMode === "grp"
                  ? groupChannelReady
                    ? "No messages yet. Say something below."
                    : "When you’re connected to the team channel, messages show up here."
                  : activePeerId
                    ? "No messages yet with this person."
                    : "Start a new message above."}
              </Text>
            }
          />

          <View style={styles.composer}>
            <Pressable
              style={[styles.attachBtn, { borderColor: TacticalPalette.border }]}
              onPress={() => {
                if (!vaultKey || vaultKey.length !== 32) {
                  Alert.alert("Vault", "Unlock your vault to attach encrypted drive files.");
                  return;
                }
                setAttachOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Attach vault file">
              <FontAwesome name="paperclip" size={18} color={chrome.tint} />
            </Pressable>
            <Pressable
              style={[styles.attachBtn, { borderColor: TacticalPalette.border }]}
              onPress={() => void pickAndSendChatImage()}
              accessibilityRole="button"
              accessibilityLabel="Attach photo from device">
              <FontAwesome name="picture-o" size={18} color={chrome.tint} />
            </Pressable>
            <TextInput
              placeholder={
                commsMode === "grp" ? "Message the team…" : activePeerId ? "Message…" : "Pick someone to message…"
              }
              placeholderTextColor={TacticalPalette.boneMuted}
              value={draft}
              onChangeText={setDraft}
              multiline
              style={[styles.composerInput, { color: chrome.text, borderColor: TacticalPalette.border }]}
            />
            {dmFocused && activePeerId ? (
              <Pressable
                style={[styles.attachBtn, { borderColor: TacticalPalette.coyote }]}
                onPress={() => {
                  const excerpt =
                    draft.trim() ||
                    `Priority note from ${username ?? "MM user"} — please open encrypted team chat when you can.`;
                  Alert.alert(
                    "Priority email",
                    `Send a high-visibility email to ${usernameForPeerId(activePeerId)}? They must use the email on their MM account. Requires Resend on the server.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Send email",
                        style: "default",
                        onPress: () =>
                          void (async () => {
                            const r = await sendPriorityEmail(activePeerId, excerpt);
                            if (r.ok) Alert.alert("Queued", "Priority email sent.");
                            else Alert.alert("Not sent", r.message);
                          })(),
                      },
                    ],
                  );
                }}
                accessibilityRole="button"
                accessibilityLabel="Send priority email">
                <FontAwesome name="envelope" size={17} color={TacticalPalette.coyote} />
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.sendFab, { backgroundColor: chrome.tint }]}
              onPress={onSend}
              accessibilityRole="button">
              <FontAwesome name="send" size={16} color={TacticalPalette.matteBlack} />
            </Pressable>
          </View>
          </View>

          <Modal visible={newChatOpen} animationType="slide" transparent onRequestClose={() => setNewChatOpen(false)}>
            <Pressable style={styles.modalBackdrop} onPress={() => setNewChatOpen(false)}>
              <Pressable style={[styles.modalCard, { borderColor: TacticalPalette.border }]} onPress={(e) => e.stopPropagation()}>
                <Text style={[styles.modalTitle, { color: chrome.text }]}>New message</Text>
                <Text style={[styles.hintSm, { color: chrome.tabIconDefault, marginBottom: 12 }]}>
                  Only teammates who finished web Team chat setup appear here (encrypted identity). Tap a name to open a
                  private thread.
                </Text>
                <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
                  {directoryError ? (
                    <Text style={{ color: TacticalPalette.coyote, padding: 16 }}>
                      Couldn’t load roster ({directoryError}). Ask your admin to run the latest database migration for team
                      chat.
                    </Text>
                  ) : chatPeersOthers.length === 0 ? (
                    <Text style={{ color: chrome.tabIconDefault, padding: 16 }}>
                      No other members in the directory yet.
                    </Text>
                  ) : (
                    chatPeersOthers.map((p) => (
                      <Pressable
                        key={p.id}
                        style={styles.peerRow}
                        onPress={() => {
                          openDmWith(p.id);
                          setNewChatOpen(false);
                        }}>
                        <Text style={[styles.peerRowTx, { color: chrome.text }]}>{p.username}</Text>
                        <FontAwesome name="chevron-right" size={12} color={chrome.tabIconDefault} />
                      </Pressable>
                    ))
                  )}
                </ScrollView>
                <Pressable style={[styles.modalClose, { borderColor: TacticalPalette.border }]} onPress={() => setNewChatOpen(false)}>
                  <Text style={{ color: chrome.text, fontWeight: "700" }}>Cancel</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>

          <Modal visible={invitePickOpen} animationType="slide" transparent onRequestClose={() => setInvitePickOpen(false)}>
            <Pressable style={styles.modalBackdrop} onPress={() => setInvitePickOpen(false)}>
              <Pressable style={[styles.modalCard, { borderColor: TacticalPalette.border }]} onPress={(e) => e.stopPropagation()}>
                <Text style={[styles.modalTitle, { color: chrome.text }]}>Invite to team channel</Text>
                <Text style={[styles.hintSm, { color: chrome.tabIconDefault, marginBottom: 12 }]}>
                  Select a teammate. Their app receives the encrypted team key automatically.
                </Text>
                <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
                  {inviteCandidates.length === 0 ? (
                    <Text style={{ color: chrome.tabIconDefault, padding: 16 }}>No teammates in directory.</Text>
                  ) : (
                    inviteCandidates.map((p) => (
                      <Pressable
                        key={p.id}
                        style={styles.peerRow}
                        onPress={() => {
                          setInvitePeerId(p.id);
                          setInvitePickOpen(false);
                        }}>
                        <Text style={[styles.peerRowTx, { color: chrome.text }]}>{p.username}</Text>
                        <FontAwesome name="chevron-right" size={12} color={chrome.tabIconDefault} />
                      </Pressable>
                    ))
                  )}
                </ScrollView>
                <Pressable style={[styles.modalClose, { borderColor: TacticalPalette.border }]} onPress={() => setInvitePickOpen(false)}>
                  <Text style={{ color: chrome.text, fontWeight: "700" }}>Cancel</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>

          <Modal visible={attachOpen} animationType="slide" transparent onRequestClose={() => setAttachOpen(false)}>
            <Pressable style={styles.modalBackdrop} onPress={() => setAttachOpen(false)}>
              <Pressable style={[styles.modalCard, { borderColor: TacticalPalette.border }]} onPress={(e) => e.stopPropagation()}>
                <Text style={[styles.modalTitle, { color: chrome.text }]}>Attach from vault</Text>
                <Text style={[styles.hintSm, { color: chrome.tabIconDefault, marginBottom: 12 }]}>
                  Sends a secure pointer to your encrypted file. Only you can decrypt it from storage; other chat members see
                  a heads-up card.
                </Text>
                {vaultListLoading ? (
                  <ActivityIndicator color={chrome.tint} style={{ marginVertical: 20 }} />
                ) : (
                  <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
                    {vaultRows.length === 0 ? (
                      <Text style={{ color: chrome.tabIconDefault, padding: 16 }}>No files in your vault drive.</Text>
                    ) : (
                      vaultRows.map((row) => {
                        const disp = vaultItemDisplayName(row.storage_path);
                        return (
                          <Pressable
                            key={row.id}
                            style={styles.peerRow}
                            onPress={() => {
                              const label = disp.title + (disp.subtitle ? ` (${disp.subtitle})` : "");
                              const body = encodeVaultAttachPayload({
                                v: 1,
                                objectId: row.id,
                                storagePath: row.storage_path,
                                label,
                              });
                              void sendMessageBody(body);
                              setAttachOpen(false);
                            }}>
                            <Text style={[styles.peerRowTx, { color: chrome.text }]}>{disp.title}</Text>
                            <FontAwesome name="chevron-right" size={12} color={chrome.tabIconDefault} />
                          </Pressable>
                        );
                      })
                    )}
                  </ScrollView>
                )}
                <Pressable style={[styles.modalClose, { borderColor: TacticalPalette.border }]} onPress={() => setAttachOpen(false)}>
                  <Text style={{ color: chrome.text, fontWeight: "700" }}>Cancel</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>

          <Modal visible={verifyOpen} animationType="fade" transparent onRequestClose={() => setVerifyOpen(false)}>
            <Pressable style={styles.modalBackdrop} onPress={() => setVerifyOpen(false)}>
              <Pressable style={[styles.modalCard, { borderColor: TacticalPalette.border }]} onPress={(e) => e.stopPropagation()}>
                <Text style={[styles.modalTitle, { color: chrome.text }]}>Verify connection</Text>
                <Text style={[styles.hintSm, { color: chrome.tabIconDefault, marginBottom: 16 }]}>
                  Call or text your contact outside this app and read these four words. If they see the exact same words,
                  you’re talking to the right person. If anything differs, stop and ask an organizer for help.
                </Text>
                {verifyLoading ? (
                  <ActivityIndicator color={chrome.tint} style={{ marginVertical: 24 }} />
                ) : verifyPhrase ? (
                  <Text
                    style={[
                      styles.verifyWords,
                      { color: chrome.text, borderColor: chrome.tint, backgroundColor: "rgba(107,142,92,0.08)" },
                    ]}
                    selectable>
                    {verifyPhrase}
                  </Text>
                ) : (
                  <Text style={{ color: TacticalPalette.coyote }}>Couldn’t load words. Check your connection.</Text>
                )}
                {activePeerId && verifyPhrase ? (
                  <View style={styles.verifySwitchRow}>
                    <Text style={[styles.hintSm, { color: chrome.text, flex: 1 }]}>
                      We matched the words — mark as verified
                    </Text>
                    <Switch
                      value={dmTrustVisual === "ok"}
                      onValueChange={(v) => void applyVerifiedForActiveDm(activePeerId, v)}
                      trackColor={{ false: "#444", true: "rgba(107,142,92,0.5)" }}
                      thumbColor={dmTrustVisual === "ok" ? TacticalPalette.success : "#ccc"}
                    />
                  </View>
                ) : null}
                <Pressable style={[styles.modalClose, { borderColor: TacticalPalette.border }]} onPress={() => setVerifyOpen(false)}>
                  <Text style={{ color: chrome.text, fontWeight: "700" }}>Done</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      )}
    </View>
  );
}

function MessageBubble({
  item,
  selfName,
  resolveName,
  profileId,
  onOpenVaultAttachment,
  chrome,
}: {
  item: E2eeChatMessage;
  selfName: string;
  resolveName: (id: string) => string;
  profileId: string;
  onOpenVaultAttachment: (p: VaultAttachPayloadV1, senderId: string) => void;
  chrome: TacticalColors;
}) {
  const mine = item.mine;
  const who = mine ? selfName : resolveName(item.fromId);
  const t = new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const chatImg = tryParseChatImagePayload(item.plaintext);
  const attach = tryParseVaultAttachPayload(item.plaintext);
  const delivery = item.deliveryStatus;
  const showDelivery = mine && (delivery === "queued" || delivery === "pending" || delivery === "sent" || delivery === undefined);
  const deliveryIcon =
    delivery === "sent" || delivery === undefined ? "check" : "clock-o";

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
        <View style={styles.bubbleMetaRow}>
          <Text style={[styles.bubbleMeta, { color: chrome.tabIconDefault }]}>
            {who} · {t}
          </Text>
          {showDelivery ? (
            <FontAwesome
              name={deliveryIcon}
              size={12}
              color={
                delivery === "sent" || delivery === undefined ? chrome.tabIconDefault : TacticalPalette.boneMuted
              }
              style={{ marginLeft: 6 }}
            />
          ) : null}
        </View>
        {chatImg ? (
          <Image
            source={{ uri: `data:${chatImg.mime};base64,${chatImg.b64}` }}
            style={styles.chatImage}
            resizeMode="cover"
            accessibilityLabel="Chat photo"
          />
        ) : attach ? (
          <Pressable
            onPress={() => onOpenVaultAttachment(attach, item.fromId)}
            style={[styles.attachCard, { borderColor: TacticalPalette.border }]}>
            <FontAwesome name="lock" size={14} color={chrome.tint} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.attachTitle, { color: chrome.text }]}>Vault file</Text>
              <Text style={[styles.attachSub, { color: chrome.tabIconDefault }]} numberOfLines={2}>
                {attach.label}
              </Text>
              <Text style={[styles.attachHint, { color: chrome.tabIconDefault }]}>
                {item.fromId === profileId
                  ? "Tap to decrypt (your vault)"
                  : "From teammate’s vault — tap for details"}
              </Text>
            </View>
            <FontAwesome name="chevron-right" size={12} color={chrome.tabIconDefault} />
          </Pressable>
        ) : (
          <Text style={[styles.bubbleBody, { color: chrome.text }]} selectable>
            {item.plaintext}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  unlockedColumn: { flex: 1, minHeight: 0, minWidth: 0 },
  msgComposeColumn: { flex: 1, minHeight: 0, minWidth: 0 },
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
  subHead: { fontSize: 11, lineHeight: 15, marginTop: 4, maxWidth: 280 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  hintSm: { fontSize: 12, lineHeight: 16 },
  banner: {
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  bannerTx: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  syncHaltedBanner: {
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  syncHaltedBannerTx: {
    color: TacticalPalette.bone,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  syncHaltedRetry: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  syncHaltedRetryTx: { color: TacticalPalette.bone, fontSize: 14, fontWeight: "800" },
  primaryBtnSm: { paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  primaryTxSm: { fontSize: 14, fontWeight: "800" },
  grpHint: { paddingHorizontal: 14, marginBottom: 8 },
  dmPeerBanner: { fontSize: 13, marginBottom: 6 },
  dmHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  dmPeerTitle: { fontSize: 16, fontWeight: "800" },
  verifyPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  advancedToggle: { paddingHorizontal: 14, paddingVertical: 6, marginBottom: 4 },
  advancedBox: { paddingHorizontal: 14, gap: 8, marginBottom: 10 },
  setupScroll: { flex: 1, paddingHorizontal: 14 },
  actionRow: { paddingHorizontal: 14, marginBottom: 10 },
  newMsgBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  newMsgBtnTx: { fontSize: 14, fontWeight: "800" },
  modeRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, marginBottom: 10 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipTx: { fontSize: 13, fontWeight: "800" },
  dmSetup: { paddingHorizontal: 14, gap: 8, marginBottom: 8 },
  mentionBar: { paddingHorizontal: 12, paddingBottom: 6, maxHeight: 48 },
  mentionChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    backgroundColor: "rgba(40,48,38,0.55)",
  },
  rosterBlock: { paddingHorizontal: 14, marginBottom: 8, gap: 6 },
  rosterLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  rosterScroll: { flexDirection: "row", gap: 6, paddingVertical: 2 },
  rosterChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rosterChipTx: { fontSize: 12, fontWeight: "600" },
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
  bubbleMetaRow: { flexDirection: "row", alignItems: "center", marginBottom: 4, flexWrap: "wrap" },
  bubbleMeta: { fontSize: 11, fontWeight: "600" },
  bubbleBody: { fontSize: 15, lineHeight: 21 },
  attachCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  attachTitle: { fontSize: 13, fontWeight: "800" },
  attachSub: { fontSize: 13, marginTop: 2 },
  attachHint: { fontSize: 11, marginTop: 6, fontStyle: "italic" },
  chatImage: {
    width: "100%",
    maxWidth: 280,
    height: 200,
    borderRadius: 10,
    marginTop: 4,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TacticalPalette.border,
  },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  composerInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    maxHeight: 160,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 20,
  },
  sendFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    backgroundColor: TacticalPalette.matteBlack,
    maxWidth: 420,
    alignSelf: "center",
    width: "100%",
  },
  modalTitle: { fontSize: 18, fontWeight: "800", marginBottom: 6 },
  peerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TacticalPalette.border,
  },
  peerRowTx: { fontSize: 16, fontWeight: "700" },
  modalClose: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  verifyWords: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.5,
    textAlign: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  verifySwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
});
