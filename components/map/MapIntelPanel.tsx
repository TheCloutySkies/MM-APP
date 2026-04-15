import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { MapPin } from "@/components/map/mapTypes";
import type { TacticalColors } from "@/constants/TacticalTheme";
import type { TacticalMapPayload } from "@/lib/mapMarkers";
import { tacCategoryLabel } from "@/lib/mapMarkers";

export type MapIntelLinkPick =
  | { source: "ops_report"; id: string; subtitle: string }
  | { source: "operation_hub"; id: string; subtitle: string }
  | { source: "legacy_mission"; id: string; subtitle: string };

type Props = {
  pin: MapPin;
  /** Decrypted tactical payload for this `map_markers` row; null if unavailable. */
  payload: TacticalMapPayload | null;
  chrome: TacticalColors;
  variant: "trailing" | "bottom";
  onDismiss: () => void;
  onCenterMap: () => void;
  /** Contrast on filled brand button (matches map `onTintLabel`). */
  onAccentLabel: string;
  /** Web: allow vertical scroll inside anchored panel without chaining to map pan. */
  scrollPanY?: boolean;
  /** Mobile anchored panel height cap (px). */
  maxBottomPx?: number;
  /** Remove this tactical marker row (map_markers.id === pin.id). Caller may no-op if not owner. */
  onDeleteMyMarker?: () => void;
  /** Owner can edit title, notes, and mission/report link. */
  canEdit: boolean;
  onSaveIntel?: (next: { title: string; notes: string; link: MapIntelLinkPick | null }) => Promise<void>;
  /** Missions / reports / hubs to attach (metadata only — no server decrypt). */
  linkOptions: MapIntelLinkPick[];
};

function payloadToLinkPick(p: TacticalMapPayload): MapIntelLinkPick | null {
  if (p.linkedOperationHubId?.trim()) {
    return {
      source: "operation_hub",
      id: p.linkedOperationHubId,
      subtitle: p.linkLabel?.trim() || `Hub ${p.linkedOperationHubId.slice(0, 8)}…`,
    };
  }
  if (p.linkedOpsReportId?.trim()) {
    return {
      source: "ops_report",
      id: p.linkedOpsReportId,
      subtitle: p.linkLabel?.trim() || `Report ${p.linkedOpsReportId.slice(0, 8)}…`,
    };
  }
  if (p.linkedLegacyMissionId?.trim()) {
    return {
      source: "legacy_mission",
      id: p.linkedLegacyMissionId,
      subtitle: p.linkLabel?.trim() || `Mission ${p.linkedLegacyMissionId.slice(0, 8)}…`,
    };
  }
  return null;
}

/** Rigid intel tray — Calcite “panel” pattern for marker details (desktop trailing / mobile anchored). */
export function MapIntelPanel({
  pin,
  payload,
  chrome,
  variant,
  onDismiss,
  onCenterMap,
  onAccentLabel,
  scrollPanY,
  maxBottomPx,
  onDeleteMyMarker,
  canEdit,
  onSaveIntel,
  linkOptions,
}: Props) {
  const isTrailing = variant === "trailing";
  const [titleDraft, setTitleDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [linkPick, setLinkPick] = useState<MapIntelLinkPick | null>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  useEffect(() => {
    if (!payload) {
      setTitleDraft(pin.title.replace(/\s*\(stale\)\s*$/i, ""));
      setNotesDraft("");
      setLinkPick(null);
      return;
    }
    const baseTitle = payload.title?.trim() || tacCategoryLabel(payload.category);
    setTitleDraft(baseTitle);
    setNotesDraft(payload.notes?.trim() ?? "");
    setLinkPick(payloadToLinkPick(payload));
  }, [pin.id, pin.title, payload]);

  const displayTitle = useMemo(() => pin.title, [pin.title]);

  const runSave = async () => {
    if (!onSaveIntel) return;
    setSaveBusy(true);
    try {
      await onSaveIntel({
        title: titleDraft,
        notes: notesDraft,
        link: linkPick,
      });
    } catch (e) {
      Alert.alert("Map marker", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <View
      style={[
        isTrailing ? styles.trailing : styles.bottom,
        !isTrailing && maxBottomPx ? { maxHeight: maxBottomPx } : null,
        {
          backgroundColor: chrome.background,
          borderColor: chrome.border,
        },
      ]}>
      <View style={[styles.head, { borderBottomColor: chrome.border }]}>
        <Text style={[styles.kicker, { color: chrome.tabIconDefault }]}>MARK intel</Text>
        <View style={styles.headRow}>
          {canEdit && payload ? (
            <TextInput
              value={titleDraft}
              onChangeText={setTitleDraft}
              placeholder="Marker name"
              placeholderTextColor={chrome.tabIconDefault}
              style={[
                styles.titleInput,
                { color: chrome.text, borderColor: chrome.border, backgroundColor: chrome.panel },
              ]}
              editable={!saveBusy}
              accessibilityLabel="Marker title"
            />
          ) : (
            <Text style={[styles.title, { color: chrome.text }]} numberOfLines={2}>
              {displayTitle}
            </Text>
          )}
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close intel panel"
            hitSlop={10}
            style={styles.iconBtn}>
            <FontAwesome name="times" size={18} color={chrome.tabIconDefault} />
          </Pressable>
        </View>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={scrollPanY && Platform.OS === "web" ? ({ touchAction: "pan-y" } as unknown as any) : undefined}
        contentContainerStyle={styles.body}>
        {canEdit && payload ? (
          <>
            <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>Description</Text>
            <TextInput
              value={notesDraft}
              onChangeText={setNotesDraft}
              placeholder="Notes / description (optional)"
              placeholderTextColor={chrome.tabIconDefault}
              multiline
              textAlignVertical="top"
              editable={!saveBusy}
              style={[
                styles.notesInput,
                { color: chrome.text, borderColor: chrome.border, backgroundColor: chrome.panel },
              ]}
              accessibilityLabel="Marker description"
            />

            <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>Mission / report</Text>
            <View style={[styles.linkRow, { borderColor: chrome.border }]}>
              <Text style={[styles.linkSummary, { color: chrome.text }]} numberOfLines={3}>
                {linkPick ? linkPick.subtitle : "Not linked"}
              </Text>
              <View style={styles.linkBtns}>
                <Pressable
                  onPress={() => setLinkModalOpen(true)}
                  disabled={saveBusy}
                  style={({ pressed }) => [
                    styles.linkMini,
                    { borderColor: chrome.tint, opacity: pressed ? 0.85 : 1 },
                  ]}>
                  <Text style={{ color: chrome.tint, fontWeight: "800", fontSize: 12 }}>Choose…</Text>
                </Pressable>
                {linkPick ? (
                  <Pressable
                    onPress={() => setLinkPick(null)}
                    disabled={saveBusy}
                    style={({ pressed }) => [
                      styles.linkMini,
                      { borderColor: chrome.tabIconDefault, opacity: pressed ? 0.85 : 1 },
                    ]}>
                    <Text style={{ color: chrome.tabIconDefault, fontWeight: "700", fontSize: 12 }}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <Pressable
              onPress={() => void runSave()}
              disabled={saveBusy}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: chrome.tint, opacity: saveBusy ? 0.7 : pressed ? 0.9 : 1 },
              ]}>
              {saveBusy ? (
                <ActivityIndicator color={onAccentLabel} />
              ) : (
                <Text style={[styles.saveTx, { color: onAccentLabel }]}>Save changes</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            {pin.subtitle ? (
              <Text style={[styles.sub, { color: chrome.textMuted }]} selectable>
                {pin.subtitle}
              </Text>
            ) : null}
          </>
        )}
        <Text style={[styles.coord, { color: chrome.tabIconDefault }]} selectable>
          {pin.lat.toFixed(5)} · {pin.lng.toFixed(5)}
        </Text>
        <Pressable
          onPress={onCenterMap}
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: chrome.tint, opacity: pressed ? 0.9 : 1 },
          ]}>
          <FontAwesome name="crosshairs" size={14} color={onAccentLabel} />
          <Text style={[styles.primaryTx, { color: onAccentLabel }]}>Center map</Text>
        </Pressable>
        {onDeleteMyMarker ? (
          <Pressable
            onPress={() =>
              Alert.alert(
                "Delete marker",
                "Remove this tactical marker for everyone on the map?",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: onDeleteMyMarker },
                ],
              )
            }
            style={({ pressed }) => [
              styles.deleteBtn,
              { borderColor: "#b91c1c", opacity: pressed ? 0.9 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Delete my tactical marker">
            <FontAwesome name="trash" size={14} color="#b91c1c" />
            <Text style={styles.deleteTx}>Delete my marker</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={linkModalOpen} animationType="slide" transparent onRequestClose={() => setLinkModalOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setLinkModalOpen(false)} />
          <View style={[styles.modalSheet, { backgroundColor: chrome.background, borderColor: chrome.border }]}>
            <View style={[styles.modalHead, { borderBottomColor: chrome.border }]}>
              <Text style={[styles.modalTitle, { color: chrome.text }]}>Link mission or report</Text>
              <Pressable onPress={() => setLinkModalOpen(false)} hitSlop={10}>
                <Text style={{ color: chrome.tint, fontWeight: "800" }}>Done</Text>
              </Pressable>
            </View>
            <Text style={[styles.modalHint, { color: chrome.tabIconDefault }]}>
              Pick an existing mission plan, ops report, operation hub, or legacy mission row. One link per marker.
            </Text>
            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {linkOptions.length === 0 ? (
                <Text style={{ color: chrome.tabIconDefault, padding: 16 }}>
                  No items loaded. Open Missions or file a report first.
                </Text>
              ) : null}
              {linkOptions.map((opt) => (
                <Pressable
                  key={`${opt.source}-${opt.id}`}
                  onPress={() => {
                    setLinkPick(opt);
                    setLinkModalOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.pickRow,
                    { borderBottomColor: chrome.border, backgroundColor: pressed ? chrome.panel : "transparent" },
                  ]}>
                  <Text style={[styles.pickTag, { color: chrome.tint }]}>
                    {opt.source === "ops_report"
                      ? "Report"
                      : opt.source === "operation_hub"
                        ? "Op hub"
                        : "Mission"}
                  </Text>
                  <Text style={[styles.pickSub, { color: chrome.text }]}>{opt.subtitle}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trailing: {
    width: 320,
    flexShrink: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  bottom: {
    flexShrink: 0,
    width: "100%",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  head: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kicker: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
  },
  titleInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 40,
  },
  iconBtn: {
    padding: 4,
  },
  body: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  sub: {
    fontSize: 14,
    lineHeight: 20,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
    marginBottom: -4,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 88,
    fontSize: 14,
    lineHeight: 20,
  },
  linkRow: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  linkSummary: {
    fontSize: 13,
    lineHeight: 18,
  },
  linkBtns: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  linkMini: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  saveBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  saveTx: {
    fontSize: 14,
    fontWeight: "900",
  },
  coord: {
    fontSize: 12,
    fontFamily: "Menlo, monospace",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 4,
  },
  primaryTx: {
    fontSize: 14,
    fontWeight: "800",
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 2,
    marginTop: 6,
  },
  deleteTx: { fontSize: 14, fontWeight: "800", color: "#b91c1c" },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalSheet: {
    maxHeight: 520,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    paddingBottom: 20,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 17, fontWeight: "900" },
  modalHint: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalScroll: { maxHeight: 420 },
  pickRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickTag: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  pickSub: { fontSize: 14, lineHeight: 20 },
});
