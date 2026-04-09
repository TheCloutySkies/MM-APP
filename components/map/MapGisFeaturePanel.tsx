import FontAwesome from "@expo/vector-icons/FontAwesome";
import type { Feature, LineString } from "geojson";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type { TacticalColors } from "@/constants/TacticalTheme";
import { lineLengthMiles } from "@/lib/gis/turfOps";

function propsOf(f: Feature): Record<string, unknown> {
  return (f.properties as Record<string, unknown>) ?? {};
}

function toMgrs(lat: number, lng: number): string {
  try {
    const mgrs = require("mgrs") as { forward: (ll: [number, number], accuracy?: number) => string };
    return mgrs.forward([lng, lat], 5);
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

type Props = {
  feature: Feature;
  chrome: TacticalColors;
  variant: "trailing" | "bottom";
  onDismiss: () => void;
  onCenterMap: (lat: number, lng: number) => void;
  onAccentLabel: string;
  scrollPanY?: boolean;
  maxBottomPx?: number;
  /** mph → hours for ETA line */
  movementMph: string;
  onMovementMphChange: (s: string) => void;
};

export function MapGisFeaturePanel({
  feature,
  chrome,
  variant,
  onDismiss,
  onCenterMap,
  onAccentLabel,
  scrollPanY,
  maxBottomPx,
  movementMph,
  onMovementMphChange,
}: Props) {
  const p = propsOf(feature);
  const kind = String(p.kind ?? feature.geometry?.type ?? "feature");
  const mmId = String(p.mmId ?? "—");
  const creator = String(p.createdBy ?? "—");
  const ts = typeof p.createdAt === "number" ? new Date(p.createdAt).toISOString() : "—";
  const sidc = p.sidc != null ? String(p.sidc) : null;

  let lat: number | null = null;
  let lng: number | null = null;
  const g = feature.geometry;
  if (g?.type === "Point") {
    const c = g.coordinates;
    lng = c[0] ?? null;
    lat = c[1] ?? null;
  }

  let routeMiles: number | null = null;
  if (g?.type === "LineString" && g.coordinates.length >= 2) {
    try {
      routeMiles = lineLengthMiles(feature as Feature<LineString>);
    } catch {
      routeMiles = null;
    }
  }

  const mph = Number.parseFloat(movementMph);
  const etaHours =
    routeMiles != null && Number.isFinite(mph) && mph > 0 ? routeMiles / mph : null;

  const isTrailing = variant === "trailing";

  return (
    <View
      style={[
        isTrailing ? styles.trailing : styles.bottom,
        !isTrailing && maxBottomPx ? { maxHeight: maxBottomPx } : null,
        { backgroundColor: chrome.background, borderColor: chrome.border },
      ]}>
      <View style={[styles.head, { borderBottomColor: chrome.border }]}>
        <Text style={[styles.kicker, { color: chrome.tabIconDefault }]}>GIS feature</Text>
        <View style={styles.headRow}>
          <Text style={[styles.title, { color: chrome.text }]} numberOfLines={2}>
            {kind.toUpperCase()}
            {sidc ? ` · ${sidc.slice(0, 12)}…` : ""}
          </Text>
          <Pressable onPress={onDismiss} accessibilityRole="button" hitSlop={10} style={styles.iconBtn}>
            <FontAwesome name="times" size={18} color={chrome.tabIconDefault} />
          </Pressable>
        </View>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={scrollPanY && Platform.OS === "web" ? { touchAction: "pan-y" } : undefined}
        contentContainerStyle={styles.body}>
        <Text style={[styles.meta, { color: chrome.textMuted }]}>UUID</Text>
        <Text style={[styles.val, { color: chrome.text }]} selectable>
          {mmId}
        </Text>
        {lat != null && lng != null ? (
          <>
            <Text style={[styles.meta, { color: chrome.textMuted }]}>MGRS</Text>
            <Text style={[styles.val, { color: chrome.text }]} selectable>
              {toMgrs(lat, lng)}
            </Text>
          </>
        ) : null}
        <Text style={[styles.meta, { color: chrome.textMuted }]}>Creator</Text>
        <Text style={[styles.val, { color: chrome.text }]}>{creator}</Text>
        <Text style={[styles.meta, { color: chrome.textMuted }]}>Timestamp</Text>
        <Text style={[styles.val, { color: chrome.text }]}>{ts}</Text>
        {routeMiles != null ? (
          <>
            <Text style={[styles.meta, { color: chrome.textMuted }]}>Route length</Text>
            <Text style={[styles.val, { color: chrome.text }]}>{routeMiles.toFixed(2)} mi</Text>
            <Text style={[styles.meta, { color: chrome.textMuted }]}>Movement speed (mph)</Text>
            <TextInput
              value={movementMph}
              onChangeText={onMovementMphChange}
              keyboardType="decimal-pad"
              placeholder="30"
              placeholderTextColor={chrome.tabIconDefault}
              accessibilityLabel="Speed in miles per hour"
              style={[
                styles.mphInput,
                { color: chrome.text, borderColor: chrome.border, backgroundColor: chrome.panel },
              ]}
            />
            <Text style={[styles.hint, { color: chrome.tabIconDefault }]}>
              ETA:{" "}
              {etaHours != null
                ? `${(etaHours * 60).toFixed(0)} min @ ${mph.toFixed(1)} mph`
                : "Enter mph for ETA"}
            </Text>
          </>
        ) : null}
        <Text style={[styles.meta, { color: chrome.textMuted }]}>Related intel</Text>
        <Text style={[styles.placeholder, { color: chrome.tabIconDefault }]}>
          Encrypted SITREP / image links (IndexedDB) keyed by UUID — planned in ops sync module.
        </Text>
        {lat != null && lng != null ? (
          <Pressable
            onPress={() => onCenterMap(lat!, lng!)}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: chrome.tint, opacity: pressed ? 0.9 : 1 },
            ]}>
            <FontAwesome name="crosshairs" size={14} color={onAccentLabel} />
            <Text style={[styles.primaryTx, { color: onAccentLabel }]}>Center map</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  trailing: { width: 320, flexShrink: 0, borderLeftWidth: StyleSheet.hairlineWidth },
  bottom: { flexShrink: 0, width: "100%", borderTopWidth: StyleSheet.hairlineWidth },
  head: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  kicker: { fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginBottom: 4 },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: "800" },
  iconBtn: { padding: 4 },
  body: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  meta: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 4 },
  val: { fontSize: 13, lineHeight: 18 },
  mphInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  hint: { fontSize: 12, fontStyle: "italic" },
  placeholder: { fontSize: 12, lineHeight: 17 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  primaryTx: { fontSize: 14, fontWeight: "800" },
});
