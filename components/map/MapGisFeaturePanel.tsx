import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as ImagePicker from "expo-image-picker";
import type { Feature, LineString } from "geojson";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { TacticalColors } from "@/constants/TacticalTheme";
import { lineLengthMiles } from "@/lib/gis/turfOps";
import {
  OPERATION_HUB_AAD,
  type OperationHubPayloadV1,
  tryDecryptUtf8WithKeys,
} from "@/lib/opsReports";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";
import { hexToBytes } from "@/lib/crypto/bytes";
import { getMapSharedKeyHex } from "@/lib/env";

import { ensureFeatureId } from "@/lib/gis/gisTypes";

const MAX_GIS_IMAGES = 4;
const MAX_DATA_URL_CHARS = 480_000;

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

function pickImageDataUrlWeb(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

type HubPick = { id: string; title: string };

type Props = {
  feature: Feature;
  chrome: TacticalColors;
  variant: "trailing" | "bottom";
  onDismiss: () => void;
  onCenterMap: (lat: number, lng: number) => void;
  onAccentLabel: string;
  scrollPanY?: boolean;
  maxBottomPx?: number;
  movementMph: string;
  onMovementMphChange: (s: string) => void;
  /** Persist edited metadata + geometry unchanged into the map FeatureCollection + encrypted draft. */
  onCommitFeature: (next: Feature) => void;
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
  onCommitFeature,
}: Props) {
  const router = useRouter();
  const supabase = useMMStore((s) => s.supabase);
  const vaultMode = useMMStore((s) => s.vaultMode) as VaultMode | null;

  const decryptCandidates = useMemo(() => {
    const hex = resolveMapEncryptKey() ?? getMapSharedKeyHex();
    if (!hex || hex.length !== 64) return [];
    try {
      return [hexToBytes(hex)];
    } catch {
      return [];
    }
  }, [vaultMode]);

  const p = propsOf(feature);
  const mmId = String(p.mmId ?? "—");
  const kind = String(p.kind ?? feature.geometry?.type ?? "feature");

  const [label, setLabel] = useState("");
  const [details, setDetails] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [linkedOperationId, setLinkedOperationId] = useState<string>("");
  const [hubs, setHubs] = useState<HubPick[]>([]);

  useEffect(() => {
    const pr = propsOf(feature);
    setLabel(String(pr.gisLabel ?? pr.kind ?? "feature"));
    setDetails(typeof pr.gisDetails === "string" ? pr.gisDetails : "");
    const im = pr.gisImages;
    setImages(Array.isArray(im) ? im.filter((x) => typeof x === "string") : []);
    setLinkedOperationId(typeof pr.linkedOperationId === "string" ? pr.linkedOperationId : "");
  }, [feature]);

  const refreshHubs = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("operation_hubs")
      .select("id, encrypted_payload")
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) {
      console.warn(error.message);
      return;
    }
    const list: HubPick[] = [];
    for (const row of data ?? []) {
      const id = String(row.id);
      let title = `${id.slice(0, 8)}…`;
      if (decryptCandidates.length > 0) {
        const j = tryDecryptUtf8WithKeys(row.encrypted_payload as string, OPERATION_HUB_AAD, decryptCandidates);
        if (j) {
          try {
            title = (JSON.parse(j) as OperationHubPayloadV1).title || title;
          } catch {
            /* keep */
          }
        }
      }
      list.push({ id, title });
    }
    setHubs(list);
  }, [supabase, decryptCandidates]);

  useEffect(() => {
    void refreshHubs();
  }, [refreshHubs]);

  const creator = String(p.createdBy ?? "—");
  const ts = typeof p.createdAt === "number" ? new Date(p.createdAt).toISOString() : "—";
  const sidc = p.sidc != null ? String(p.sidc) : null;
  const updatedHint =
    typeof p.gisUpdatedAt === "number" ? new Date(p.gisUpdatedAt).toLocaleString() : null;

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
  const etaHours = routeMiles != null && Number.isFinite(mph) && mph > 0 ? routeMiles / mph : null;

  const isTrailing = variant === "trailing";

  const handleSave = () => {
    const merged = ensureFeatureId({
      ...feature,
      properties: {
        ...p,
        gisLabel: label.trim() || kind,
        gisDetails: details.trim(),
        gisImages: images,
        linkedOperationId: linkedOperationId.trim() || undefined,
        gisUpdatedAt: Date.now(),
      },
    });
    onCommitFeature(merged);
    Alert.alert("GIS", "Feature saved. Map layers updated; encrypted draft written when a map key is available.");
  };

  const addImage = async () => {
    if (images.length >= MAX_GIS_IMAGES) {
      Alert.alert("GIS", `You can attach up to ${MAX_GIS_IMAGES} images on this feature.`);
      return;
    }
    if (Platform.OS === "web") {
      const dataUrl = await pickImageDataUrlWeb();
      if (!dataUrl) return;
      if (dataUrl.length > MAX_DATA_URL_CHARS) {
        Alert.alert("GIS", "That image is too large after encoding. Try a smaller file.");
        return;
      }
      setImages((prev) => [...prev, dataUrl]);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.55,
      base64: true,
    });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    const dataUrl = a.base64
      ? `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}`
      : a.uri;
    if (dataUrl.length > MAX_DATA_URL_CHARS) {
      Alert.alert("GIS", "Image too large — pick a smaller photo.");
      return;
    }
    setImages((prev) => [...prev, dataUrl]);
  };

  const removeImageAt = (ix: number) => {
    setImages((prev) => prev.filter((_, i) => i !== ix));
  };

  const openLinkedMission = () => {
    const id = linkedOperationId.trim();
    if (!id) return;
    router.push({ pathname: "/(app)/operation-detail", params: { id } });
  };

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
            {(label.trim() || kind).toUpperCase()}
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
        style={scrollPanY && Platform.OS === "web" ? ({ touchAction: "pan-y" } as unknown as any) : undefined}
        contentContainerStyle={styles.body}>
        <Text style={[styles.meta, { color: chrome.textMuted }]}>Name</Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder="Label shown on map panel"
          placeholderTextColor={chrome.tabIconDefault}
          style={[
            styles.textInput,
            { color: chrome.text, borderColor: chrome.border, backgroundColor: chrome.panel },
          ]}
        />
        <Text style={[styles.meta, { color: chrome.textMuted }]}>Details</Text>
        <TextInput
          value={details}
          onChangeText={setDetails}
          placeholder="Intel, coordinates pasted, link notes…"
          placeholderTextColor={chrome.tabIconDefault}
          multiline
          textAlignVertical="top"
          style={[
            styles.detailsInput,
            { color: chrome.text, borderColor: chrome.border, backgroundColor: chrome.panel },
          ]}
        />

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
        {updatedHint ? (
          <>
            <Text style={[styles.meta, { color: chrome.textMuted }]}>Last saved</Text>
            <Text style={[styles.val, { color: chrome.text }]}>{updatedHint}</Text>
          </>
        ) : null}

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

        <Text style={[styles.meta, { color: chrome.textMuted }]}>Images</Text>
        <View style={styles.imgRow}>
          {images.map((uri, ix) => (
            <View key={`${ix}-${uri.slice(0, 24)}`} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
              <Pressable style={styles.thumbRemove} onPress={() => removeImageAt(ix)} hitSlop={8}>
                <FontAwesome name="times-circle" size={20} color="#fca5a5" />
              </Pressable>
            </View>
          ))}
        </View>
        <Pressable
          onPress={() => void addImage()}
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: chrome.tint, opacity: pressed ? 0.85 : 1 },
          ]}>
          <FontAwesome name="image" size={14} color={chrome.tint} />
          <Text style={[styles.secondaryTx, { color: chrome.tint }]}>Add image</Text>
        </Pressable>
        <Text style={[styles.hint, { color: chrome.tabIconDefault }]}>
          Stored in this feature as data URLs (local GeoJSON & encrypted draft). Keep attachments few and small for
          performance.
        </Text>

        <Text style={[styles.meta, { color: chrome.textMuted }]}>Mission (operation hub)</Text>
        <TextInput
          value={linkedOperationId}
          onChangeText={setLinkedOperationId}
          placeholder="Operation hub UUID"
          placeholderTextColor={chrome.tabIconDefault}
          autoCapitalize="none"
          style={[
            styles.textInput,
            { color: chrome.text, borderColor: chrome.border, backgroundColor: chrome.panel },
          ]}
        />
        <View style={styles.rowGap}>
          {linkedOperationId.trim() ? (
            <Pressable
              onPress={openLinkedMission}
              style={({ pressed }) => [
                styles.secondaryBtn,
                { borderColor: chrome.tint, opacity: pressed ? 0.88 : 1 },
              ]}>
              <FontAwesome name="folder-open" size={14} color={chrome.tint} />
              <Text style={[styles.secondaryTx, { color: chrome.tint }]}>Open mission</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setLinkedOperationId("")}
            style={({ pressed }) => [
              styles.secondaryBtn,
              { borderColor: chrome.border, opacity: pressed ? 0.88 : 1 },
            ]}>
            <Text style={[styles.secondaryTx, { color: chrome.text }]}>Clear link</Text>
          </Pressable>
        </View>
        <Text style={[styles.miniMeta, { color: chrome.tabIconDefault }]}>Your operation hubs</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hubStrip}>
          {hubs.map((h) => (
            <Pressable
              key={h.id}
              onPress={() => setLinkedOperationId(h.id)}
              style={({ pressed }) => [
                styles.hubChip,
                {
                  borderColor: linkedOperationId === h.id ? chrome.tint : chrome.border,
                  backgroundColor: pressed ? chrome.panel : "transparent",
                },
              ]}>
              <Text style={[styles.hubChipTx, { color: chrome.text }]} numberOfLines={2}>
                {h.title}
              </Text>
              <Text style={[styles.hubChipId, { color: chrome.tabIconDefault }]}>{h.id.slice(0, 8)}…</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: chrome.tint, opacity: pressed ? 0.9 : 1 },
          ]}>
          <FontAwesome name="save" size={16} color={onAccentLabel} />
          <Text style={[styles.saveTx, { color: onAccentLabel }]}>Save feature</Text>
        </Pressable>

        {lat != null && lng != null ? (
          <Pressable
            onPress={() => onCenterMap(lat!, lng!)}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: chrome.tint, opacity: pressed ? 0.9 : 1, marginTop: 8 },
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
  body: { paddingHorizontal: 14, paddingVertical: 12, gap: 8, paddingBottom: 28 },
  meta: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 4 },
  miniMeta: { fontSize: 11, fontWeight: "700", marginTop: 6 },
  val: { fontSize: 13, lineHeight: 18 },
  textInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
  },
  detailsInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 88,
  },
  mphInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  hint: { fontSize: 12, fontStyle: "italic", lineHeight: 17 },
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
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 12,
  },
  saveTx: { fontSize: 15, fontWeight: "900" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  secondaryTx: { fontWeight: "800", fontSize: 13 },
  rowGap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  imgRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  thumbWrap: { position: "relative" },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: "#1a1e18" },
  thumbRemove: { position: "absolute", top: -6, right: -6 },
  hubStrip: { marginTop: 6, maxHeight: 120 },
  hubChip: {
    width: 120,
    marginRight: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  hubChipTx: { fontSize: 12, fontWeight: "700" },
  hubChipId: { fontSize: 10, marginTop: 4 },
});
