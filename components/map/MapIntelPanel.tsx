import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { MapPin } from "@/components/map/mapTypes";
import type { TacticalColors } from "@/constants/TacticalTheme";

type Props = {
  pin: MapPin;
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
};

/** Rigid intel tray — Calcite “panel” pattern for marker details (desktop trailing / mobile anchored). */
export function MapIntelPanel({
  pin,
  chrome,
  variant,
  onDismiss,
  onCenterMap,
  onAccentLabel,
  scrollPanY,
  maxBottomPx,
  onDeleteMyMarker,
}: Props) {
  const isTrailing = variant === "trailing";

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
          <Text style={[styles.title, { color: chrome.text }]} numberOfLines={2}>
            {pin.title}
          </Text>
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
        style={scrollPanY && Platform.OS === "web" ? { touchAction: "pan-y" } : undefined}
        contentContainerStyle={styles.body}>
        {pin.subtitle ? (
          <Text style={[styles.sub, { color: chrome.textMuted }]} selectable>
            {pin.subtitle}
          </Text>
        ) : null}
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
});
