import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useColorScheme,
    useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TacticalCategoryModal } from "@/components/map/TacticalCategoryModal";
import {
    TacticalMap,
    type MapFlyToRequest,
    type MapPin,
    type MapPolygonOverlay,
    type MapPolylineOverlay,
} from "@/components/map/TacticalMap";
import type { MapBaseLayerId, MapPointerMode, MapUserLocation } from "@/components/map/mapTypes";
import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { decryptUtf8, encryptUtf8 } from "@/lib/crypto/aesGcm";
import { geocodeSearch, type GeocodeHit } from "@/lib/geocode";
import {
    buildTacticalPayload,
    normalizeTacticalPayload,
    tacticPayloadToLayers,
    type TacCategoryId,
} from "@/lib/mapMarkers";
import {
    bboxAroundPoint,
    fetchNasaFirmsHotspots,
    fetchPowerInfrastructure,
    fetchUsgsEarthquakes,
} from "@/lib/osint/supermapLayers";
import {
    OVERPASS_C4ISR_PRESETS,
    OVERPASS_PRESETS,
    buildOverpassFormBody,
    fetchOverpass,
} from "@/lib/overpass";
import { fetchOpenMeteoCurrent } from "@/lib/weather";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";

const MIN_SHEET_H = 56;
const SHEET_X_CLAMP = 110;

export default function MapScreen() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const { height: windowH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const vaultMode = useMMStore((s) => s.vaultMode) as VaultMode | null;
  const mainKey = useMMStore((s) => s.mainVaultKey);
  const decoyKey = useMMStore((s) => s.decoyVaultKey);

  /** Dark theme uses white tint — label on solid tint must be dark for contrast. */
  const onTintLabel = scheme === "dark" ? "#0f172a" : "#ffffff";

  const mapKey = useMemo(() => {
    try {
      return resolveMapEncryptKey(mainKey, decoyKey, vaultMode);
    } catch {
      return null;
    }
  }, [mainKey, decoyKey, vaultMode]);

  const [tacticalPins, setTacticalPins] = useState<MapPin[]>([]);
  const [tacticalPolylines, setTacticalPolylines] = useState<MapPolylineOverlay[]>([]);
  const [tacticalPolygons, setTacticalPolygons] = useState<MapPolygonOverlay[]>([]);
  const [intelPins, setIntelPins] = useState<MapPin[]>([]);
  const [drawTool, setDrawTool] = useState<"idle" | "route" | "zone">("idle");
  const [pathDraft, setPathDraft] = useState<{ lat: number; lng: number }[]>([]);
  const [categoryPick, setCategoryPick] = useState<{
    geom: "point" | "route" | "zone";
    coordinates: { lat: number; lng: number }[];
  } | null>(null);
  const [showIntel, setShowIntel] = useState(true);
  const [customQl, setCustomQl] = useState(`node["amenity"="fuel"](__BBOX__);`);
  const [loading, setLoading] = useState(false);
  const [osintPower, setOsintPower] = useState(false);
  const [osintUsgs, setOsintUsgs] = useState(false);
  const [osintFirms, setOsintFirms] = useState(false);
  const [supermapPins, setSupermapPins] = useState<MapPin[]>([]);
  const [supermapPolylines, setSupermapPolylines] = useState<MapPolylineOverlay[]>([]);
  const [baseLayer, setBaseLayer] = useState<MapBaseLayerId>("osm");
  const [userLoc, setUserLoc] = useState<MapUserLocation | null>(null);
  const [pointDropMode, setPointDropMode] = useState(false);

  const flySeq = useRef(0);
  const [flyTo, setFlyTo] = useState<MapFlyToRequest | null>(null);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeHits, setPlaceHits] = useState<GeocodeHit[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);

  const maxSheetH = Math.min(480, windowH * 0.58);
  const expandedHeightRef = useRef(Math.min(336, maxSheetH * 0.88));
  const [sheetH, setSheetH] = useState(MIN_SHEET_H);
  const [sheetOffsetX, setSheetOffsetX] = useState(0);
  const sheetHRef = useRef(MIN_SHEET_H);
  const sheetXRef = useRef(0);
  const dragStartH = useRef(MIN_SHEET_H);
  const dragStartX = useRef(0);
  const dragAxisRef = useRef<"none" | "h" | "v">("none");

  sheetHRef.current = sheetH;
  sheetXRef.current = sheetOffsetX;

  useEffect(() => {
    expandedHeightRef.current = Math.min(expandedHeightRef.current, maxSheetH);
  }, [maxSheetH]);

  useEffect(() => {
    let nativeSub: { remove: () => void } | null = null;
    let webWatch: number | undefined;
    const run = async () => {
      if (Platform.OS === "web") {
        if (typeof navigator === "undefined" || !navigator.geolocation) return;
        webWatch = navigator.geolocation.watchPosition(
          (pos) => setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => {},
          { enableHighAccuracy: true, maximumAge: 8000 },
        );
        return;
      }
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return;
      nativeSub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced },
        (loc) => setUserLoc({ lat: loc.coords.latitude, lng: loc.coords.longitude }),
      );
    };
    void run();
    return () => {
      if (Platform.OS === "web" && webWatch != null) navigator.geolocation.clearWatch(webWatch);
      nativeSub?.remove();
    };
  }, []);

  const flyToCoords = (lat: number, lng: number, zoom = 10) => {
    flySeq.current += 1;
    setFlyTo({ lat, lng, zoom, seq: flySeq.current });
  };

  const loadMarkers = useCallback(async () => {
    if (!supabase || !mapKey) return;
    const { data, error } = await supabase
      .from("map_markers")
      .select("id, encrypted_payload")
      .order("created_at", { ascending: false });
    if (error) {
      console.warn(error.message);
      return;
    }
    const nextPins: MapPin[] = [];
    const nextLines: MapPolylineOverlay[] = [];
    const nextPolys: MapPolygonOverlay[] = [];
    for (const row of data ?? []) {
      try {
        const json = decryptUtf8(mapKey, row.encrypted_payload, "mm-map-marker");
        const payload = normalizeTacticalPayload(JSON.parse(json) as unknown);
        if (!payload) continue;
        const stale = payload.staleHours
          ? Date.now() - payload.droppedAt > payload.staleHours * 3600 * 1000
          : false;
        const layers = tacticPayloadToLayers(row.id, payload, stale);
        nextPins.push(...layers.pins);
        nextLines.push(...layers.polylines);
        nextPolys.push(...layers.polygons);
      } catch {
        /* wrong key partition */
      }
    }
    setTacticalPins(nextPins);
    setTacticalPolylines(nextLines);
    setTacticalPolygons(nextPolys);
  }, [mapKey, supabase]);

  useEffect(() => {
    void loadMarkers();
  }, [loadMarkers]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("mm-map-markers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "map_markers" },
        () => void loadMarkers(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, loadMarkers]);

  const saveTacticalFeature = async (cat: TacCategoryId, pick: NonNullable<typeof categoryPick>) => {
    if (!supabase || !profileId || !mapKey) return;
    const creator = username?.trim() || "Operator";
    const payload = buildTacticalPayload(pick.geom, cat, pick.coordinates, creator, { staleHours: 48 });
    const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), "mm-map-marker");
    const { error } = await supabase.from("map_markers").insert({
      profile_id: profileId,
      encrypted_payload: encrypted,
    });
    if (error) {
      Alert.alert("Map", error.message);
      return;
    }
    setCategoryPick(null);
    void loadMarkers();
  };

  const onMapLongPress = (lat: number, lng: number) => {
    if (drawTool === "route" || drawTool === "zone") return;
    Alert.alert("Map location", `${lat.toFixed(5)}, ${lng.toFixed(5)}`, [
      {
        text: "Tactical pin",
        onPress: () => setCategoryPick({ geom: "point", coordinates: [{ lat, lng }] }),
      },
      {
        text: "Weather here",
        onPress: () => void showWeatherHere(lat, lng),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const onMapTap = (lat: number, lng: number) => {
    if (pointDropMode) {
      setCategoryPick({ geom: "point", coordinates: [{ lat, lng }] });
      setPointDropMode(false);
      return;
    }
    if (drawTool === "route" || drawTool === "zone") {
      setPathDraft((d) => [...d, { lat, lng }]);
    }
  };

  const setDrawMode = (mode: "idle" | "route" | "zone") => {
    setPathDraft([]);
    setDrawTool(mode);
    setPointDropMode(false);
  };

  const mapPointerMode: MapPointerMode =
    drawTool === "route" || drawTool === "zone" || pointDropMode ? "crosshair" : "default";

  const finishPathDrawing = () => {
    if (drawTool === "route" && pathDraft.length >= 2) {
      setCategoryPick({ geom: "route", coordinates: [...pathDraft] });
      setPathDraft([]);
      setDrawTool("idle");
      return;
    }
    if (drawTool === "zone" && pathDraft.length >= 3) {
      setCategoryPick({ geom: "zone", coordinates: [...pathDraft] });
      setPathDraft([]);
      setDrawTool("idle");
    }
  };

  const useGpsCenter = async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return;
    const pos = await Location.getCurrentPositionAsync({});
    setCategoryPick({
      geom: "point",
      coordinates: [{ lat: pos.coords.latitude, lng: pos.coords.longitude }],
    });
  };

  const runIntel = async (preset: keyof typeof OVERPASS_PRESETS) => {
    setLoading(true);
    try {
      const here = tacticalPins[0];
      const pad = 0.2;
      const south = (here?.lat ?? 39.5) - pad;
      const north = (here?.lat ?? 39.5) + pad;
      const west = (here?.lng ?? -120.2) - pad;
      const east = (here?.lng ?? -120.2) + pad;
      const body = buildOverpassFormBody(OVERPASS_PRESETS[preset], south, west, north, east);
      const res = await fetchOverpass(body);
      const json = (await res.json()) as {
        elements?: { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string> }[];
      };
      const next: MapPin[] = [];
      for (const el of json.elements ?? []) {
        const lat = el.lat;
        const lng = el.lon;
        if (lat == null || lng == null) continue;
        next.push({
          id: `osm-${el.type}-${el.id}`,
          lat,
          lng,
          title: el.tags?.name ?? preset,
          tint: "#6c757d",
        });
      }
      setIntelPins(next);
    } catch (e) {
      Alert.alert("Overpass", e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const runC4isrIntel = async (presetQl: string) => {
    setLoading(true);
    try {
      const here = tacticalPins[0] ?? userLoc;
      const pad = 0.18;
      const south = (here?.lat ?? 39.5) - pad;
      const north = (here?.lat ?? 39.5) + pad;
      const west = (here?.lng ?? -120.2) - pad;
      const east = (here?.lng ?? -120.2) + pad;
      const body = buildOverpassFormBody(presetQl, south, west, north, east);
      const res = await fetchOverpass(body);
      const json = (await res.json()) as {
        elements?: { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string> }[];
      };
      const next: MapPin[] = [];
      for (const el of json.elements ?? []) {
        if (el.lat == null || el.lon == null) continue;
        next.push({
          id: `c4-${el.type}-${el.id}`,
          lat: el.lat,
          lng: el.lon,
          title: el.tags?.name ?? el.tags?.amenity ?? el.tags?.power ?? "OSM",
          tint: "#94a3b8",
        });
      }
      setIntelPins(next);
    } catch (e) {
      Alert.alert("Overpass", e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const showWeatherHere = async (lat: number, lng: number) => {
    setLoading(true);
    try {
      const { current } = await fetchOpenMeteoCurrent(lat, lng);
      const lines = [
        `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        current.temperature_2m != null ? `Temp: ${current.temperature_2m} °C` : "",
        current.wind_speed_10m != null ? `Wind: ${current.wind_speed_10m} km/h (10m)` : "",
        current.weather_code != null ? `WX code: ${current.weather_code}` : "",
        "",
        "Privacy: coordinates are sent to Open-Meteo (or your EXPO_PUBLIC_MM_GEO_PROXY_URL) from this device.",
      ].filter((l) => l !== "");
      Alert.alert("Weather (Open-Meteo)", lines.join("\n"));
    } catch (e) {
      Alert.alert("Weather", e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const refreshSupermapLayers = useCallback(async () => {
    if (!osintPower && !osintUsgs && !osintFirms) {
      setSupermapPins([]);
      setSupermapPolylines([]);
      return;
    }
    const here = tacticalPins[0];
    const lat = here?.lat ?? 39.5;
    const lng = here?.lng ?? -120.2;
    const bbox = bboxAroundPoint(lat, lng, 0.4);
    setLoading(true);
    try {
      const pins: MapPin[] = [];
      const lines: MapPolylineOverlay[] = [];
      if (osintPower) {
        const p = await fetchPowerInfrastructure(bbox);
        pins.push(...p.pins);
        lines.push(...p.polylines);
      }
      if (osintUsgs) pins.push(...(await fetchUsgsEarthquakes(bbox)));
      if (osintFirms) pins.push(...(await fetchNasaFirmsHotspots(bbox)));
      setSupermapPins(pins);
      setSupermapPolylines(lines);
    } catch (e) {
      Alert.alert("OSINT layers", e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [osintPower, osintUsgs, osintFirms, tacticalPins]);

  const runCustomIntel = async () => {
    setLoading(true);
    try {
      const south = 39.3;
      const north = 39.7;
      const west = -120.4;
      const east = -120.0;
      const body = buildOverpassFormBody(customQl, south, west, north, east);
      const res = await fetchOverpass(body);
      const json = (await res.json()) as {
        elements?: { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string> }[];
      };
      const next: MapPin[] = [];
      for (const el of json.elements ?? []) {
        if (el.lat == null || el.lon == null) continue;
        next.push({
          id: `c-${el.type}-${el.id}`,
          lat: el.lat,
          lng: el.lon,
          title: el.tags?.name ?? "query",
          tint: "#457b9d",
        });
      }
      setIntelPins(next);
    } catch (e) {
      Alert.alert("Overpass", e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const mergedPins = showIntel
    ? [...tacticalPins, ...intelPins, ...supermapPins]
    : tacticalPins;

  const draftLinePreview = useMemo((): MapPolylineOverlay | null => {
    if (drawTool === "route" && pathDraft.length >= 2) {
      return {
        id: "__mm_draft_line__",
        coordinates: pathDraft.map((x) => ({ latitude: x.lat, longitude: x.lng })),
        color: TacticalPalette.boneMuted,
        title: "Route draft",
        lineDash: "7 5",
      };
    }
    if (drawTool === "zone" && pathDraft.length === 2) {
      return {
        id: "__mm_draft_line2__",
        coordinates: pathDraft.map((x) => ({ latitude: x.lat, longitude: x.lng })),
        color: TacticalPalette.boneMuted,
        title: "Zone draft",
        lineDash: "7 5",
      };
    }
    return null;
  }, [drawTool, pathDraft, scheme]);

  const draftPolyPreview = useMemo((): MapPolygonOverlay | null => {
    if (drawTool !== "zone" || pathDraft.length < 3) return null;
    const ring = pathDraft.map((x) => ({ latitude: x.lat, longitude: x.lng }));
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a.latitude !== b.latitude || a.longitude !== b.longitude) {
      ring.push({ latitude: a.latitude, longitude: a.longitude });
    }
    return {
      id: "__mm_draft_poly__",
      coordinates: ring,
      strokeColor: TacticalPalette.boneMuted,
      fillColor: "rgba(139,115,85,0.22)",
      title: "Zone draft",
    };
  }, [drawTool, pathDraft, scheme]);

  const mapPolylines = useMemo(() => {
    const list = [...tacticalPolylines, ...(showIntel ? supermapPolylines : [])];
    if (draftLinePreview) list.push(draftLinePreview);
    return list;
  }, [tacticalPolylines, supermapPolylines, showIntel, draftLinePreview]);

  const mapPolygons = useMemo(() => {
    const list = [...tacticalPolygons];
    if (draftPolyPreview) list.push(draftPolyPreview);
    return list;
  }, [tacticalPolygons, draftPolyPreview]);

  const runPlaceSearch = async () => {
    const q = placeQuery.trim();
    if (!q) return;
    setPlaceSearching(true);
    try {
      const hits = await geocodeSearch(q, 8);
      setPlaceHits(hits);
      if (hits[0]) flyToCoords(hits[0].lat, hits[0].lng, 10);
    } catch (e) {
      Alert.alert("Places", e instanceof Error ? e.message : "Search failed");
    } finally {
      setPlaceSearching(false);
    }
  };

  const sheetPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
        onPanResponderGrant: () => {
          dragAxisRef.current = "none";
          dragStartH.current = sheetHRef.current;
          dragStartX.current = sheetXRef.current;
        },
        onPanResponderMove: (_, g) => {
          if (dragAxisRef.current === "none") {
            const preferH = Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.25;
            const preferV = Math.abs(g.dy) > 10;
            dragAxisRef.current = preferH ? "h" : preferV ? "v" : "none";
          }
          if (dragAxisRef.current === "h") {
            const nx = Math.max(
              -SHEET_X_CLAMP,
              Math.min(SHEET_X_CLAMP, dragStartX.current + g.dx),
            );
            setSheetOffsetX(nx);
            return;
          }
          if (dragAxisRef.current === "v") {
            const next = Math.max(MIN_SHEET_H, Math.min(maxSheetH, dragStartH.current - g.dy));
            setSheetH(next);
          }
        },
        onPanResponderRelease: (_, g) => {
          if (dragAxisRef.current === "h") {
            dragAxisRef.current = "none";
            return;
          }
          const mid = (MIN_SHEET_H + maxSheetH) / 2;
          let nextH = sheetHRef.current;
          if (g.vy > 0.75) nextH = MIN_SHEET_H;
          else if (g.vy < -0.75) nextH = maxSheetH;
          else nextH = sheetHRef.current < mid ? MIN_SHEET_H : sheetHRef.current;
          if (nextH > MIN_SHEET_H + 12) {
            expandedHeightRef.current = Math.min(maxSheetH, Math.max(220, nextH));
            nextH = expandedHeightRef.current;
          }
          setSheetH(nextH);
          dragAxisRef.current = "none";
        },
      }),
    [maxSheetH],
  );

  const expandSheet = () => {
    const target = Math.min(maxSheetH, expandedHeightRef.current);
    setSheetH(target);
  };

  const sheetExpanded = sheetH > MIN_SHEET_H + 14;
  const sheetPadBottom = Math.max(insets.bottom > 0 ? 6 + insets.bottom * 0.25 : 10, 10);

  const categoryModalTitle =
    categoryPick?.geom === "route"
      ? "Save route"
      : categoryPick?.geom === "zone"
        ? "Save zone"
        : "New map point";

  return (
    <View style={[styles.screen, { backgroundColor: p.background }]}>
      <TacticalCategoryModal
        visible={!!categoryPick}
        title={categoryModalTitle}
        scheme={scheme === "dark" ? "dark" : "light"}
        onClose={() => setCategoryPick(null)}
        onSelect={(cat) => {
          if (categoryPick) void saveTacticalFeature(cat, categoryPick);
        }}
      />
      <View style={styles.mapFill}>
        <TacticalMap
          pins={mergedPins}
          polylines={mapPolylines}
          polygons={mapPolygons}
          onLongPress={onMapLongPress}
          onPress={drawTool === "route" || drawTool === "zone" || pointDropMode ? onMapTap : undefined}
          flyTo={flyTo}
          baseLayer={baseLayer}
          userLocation={userLoc}
          pointerMode={mapPointerMode}
        />
        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator color={p.tint} size="large" />
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.sheet,
          {
            height: sheetH,
            backgroundColor: p.background,
            borderTopColor: scheme === "dark" ? "#27272a" : "#e4e4e7",
            transform: [{ translateX: sheetOffsetX }],
          },
        ]}>
        <View
          {...sheetPan.panHandlers}
          style={[
            styles.sheetHandleRow,
            { borderBottomColor: scheme === "dark" ? "#27272a" : "#e4e4e7" },
          ]}>
          <Pressable
            style={styles.sheetHitExpand}
            onPress={() => {
              if (sheetExpanded) setSheetH(MIN_SHEET_H);
              else expandSheet();
            }}
            accessibilityRole="button"
            accessibilityLabel={sheetExpanded ? "Minimize map tools" : "Expand map tools"}>
            <View style={styles.grabber} />
          </Pressable>
          <Pressable style={styles.sheetTitleBtn} onPress={() => (sheetExpanded ? setSheetH(MIN_SHEET_H) : expandSheet())}>
            <Text style={[styles.panelTitle, { color: p.tabIconDefault }]}>Map tools</Text>
            <FontAwesome name={sheetExpanded ? "chevron-down" : "chevron-up"} size={12} color={p.tabIconDefault} />
          </Pressable>
          <Text style={[styles.sheetDragHint, { color: p.tabIconDefault }]}>
            Drag up · side
          </Text>
        </View>

        {sheetExpanded ? (
          <ScrollView
            style={styles.sheetBodyScroll}
            contentContainerStyle={[styles.sheetBodyContent, { paddingBottom: sheetPadBottom }]}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}>
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              contentContainerStyle={styles.chipRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void useGpsCenter()}>
                <Text style={[styles.chipLabel, { color: p.text }]}>GPS drop</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => setShowIntel((v) => !v)}>
                <Text style={[styles.chipLabel, { color: p.text }]}>
                  Intel {showIntel ? "on" : "off"}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runIntel("water")}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Water</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runIntel("power")}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Power</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runIntel("emergency")}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Emergency</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: baseLayer === "satellite" ? 2 : 1,
                    borderColor: baseLayer === "satellite" ? TacticalPalette.accent : p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => setBaseLayer((b) => (b === "osm" ? "satellite" : "osm"))}>
                <Text style={[styles.chipLabel, { color: p.text }]}>
                  {baseLayer === "satellite" ? "Satellite" : "OSM map"}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: pointDropMode ? 2 : 1,
                    borderColor: pointDropMode ? p.tint : p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => {
                  if (pointDropMode) {
                    setPointDropMode(false);
                  } else {
                    setPathDraft([]);
                    setDrawTool("idle");
                    setPointDropMode(true);
                  }
                }}>
                <Text style={[styles.chipLabel, { color: p.text }]}>
                  Pin drop {pointDropMode ? "ON" : "off"}
                </Text>
              </Pressable>
            </ScrollView>

            <Text style={[styles.fieldLabel, { color: p.tabIconDefault }]}>Overpass · infrastructure presets</Text>
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              contentContainerStyle={styles.chipRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runC4isrIntel(OVERPASS_C4ISR_PRESETS.power_substations)}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Substations</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runC4isrIntel(OVERPASS_C4ISR_PRESETS.medical)}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Medical</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runC4isrIntel(OVERPASS_C4ISR_PRESETS.fuel)}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Fuel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runC4isrIntel(OVERPASS_C4ISR_PRESETS.natural_water)}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Waterfalls</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runC4isrIntel(OVERPASS_C4ISR_PRESETS.comm_towers)}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Comm towers</Text>
              </Pressable>
            </ScrollView>

            <Text style={[styles.fieldLabel, { color: p.tabIconDefault }]}>OSINT layers (SuperMap)</Text>
            <Text style={[styles.drawHint, { color: p.tabIconDefault }]}>
              Toggle sources, then load. Uses map centroid (first tactical pin or default Nevada). Power draws lines +
              substations; USGS and FIRMS are points.
            </Text>
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              contentContainerStyle={styles.chipRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: osintPower ? 2 : 1,
                    borderColor: osintPower ? TacticalPalette.accent : p.tabIconDefault,
                    backgroundColor: pressed ? TacticalPalette.panel : "transparent",
                  },
                ]}
                onPress={() => setOsintPower((v) => !v)}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Grid · power</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: osintUsgs ? 2 : 1,
                    borderColor: osintUsgs ? TacticalPalette.danger : p.tabIconDefault,
                    backgroundColor: pressed ? TacticalPalette.panel : "transparent",
                  },
                ]}
                onPress={() => setOsintUsgs((v) => !v)}>
                <Text style={[styles.chipLabel, { color: p.text }]}>USGS EQ</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: osintFirms ? 2 : 1,
                    borderColor: osintFirms ? TacticalPalette.coyote : p.tabIconDefault,
                    backgroundColor: pressed ? TacticalPalette.panel : "transparent",
                  },
                ]}
                onPress={() => setOsintFirms((v) => !v)}>
                <Text style={[styles.chipLabel, { color: p.text }]}>NASA FIRMS</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: TacticalPalette.accent,
                    backgroundColor: pressed ? TacticalPalette.panel : TacticalPalette.elevated,
                  },
                ]}
                onPress={() => void refreshSupermapLayers()}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Load OSINT</Text>
              </Pressable>
            </ScrollView>

            <Text style={[styles.fieldLabel, { color: p.tabIconDefault }]}>Tactical map</Text>
            <Text style={[styles.drawHint, { color: p.tabIconDefault }]}>
              Long-press to drop a point. Pick a category — everyone sees who placed it. Route / zone: tap the map for
              corners, then Finish and categorize.
            </Text>
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              contentContainerStyle={styles.chipRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: drawTool === "idle" ? 2 : 1,
                    borderColor: drawTool === "idle" ? p.tint : p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => setDrawMode("idle")}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Point</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: drawTool === "route" ? 2 : 1,
                    borderColor: drawTool === "route" ? p.tint : p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => setDrawMode("route")}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Route</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: drawTool === "zone" ? 2 : 1,
                    borderColor: drawTool === "zone" ? p.tint : p.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => setDrawMode("zone")}>
                <Text style={[styles.chipLabel, { color: p.text }]}>Zone</Text>
              </Pressable>
            </ScrollView>
            {drawTool !== "idle" ? (
              <View style={styles.drawActions}>
                <Text style={[styles.vertexCount, { color: p.text }]}>
                  Vertices: {pathDraft.length}
                  {drawTool === "route" ? " · min 2" : " · min 3"}
                </Text>
                <View style={styles.drawBtnRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.drawSecondaryBtn,
                      {
                        borderColor: p.tabIconDefault,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                    onPress={() => setPathDraft((d) => d.slice(0, -1))}>
                    <Text style={[styles.drawSecondaryLabel, { color: p.text }]}>Undo</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.drawSecondaryBtn,
                      {
                        borderColor: p.tabIconDefault,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                    onPress={() => setPathDraft([])}>
                    <Text style={[styles.drawSecondaryLabel, { color: p.text }]}>Clear</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => {
                      const dis =
                        (drawTool === "route" && pathDraft.length < 2) ||
                        (drawTool === "zone" && pathDraft.length < 3);
                      return [
                        styles.drawFinishBtn,
                        {
                          backgroundColor: p.tint,
                          opacity: dis ? 0.45 : pressed ? 0.9 : 1,
                        },
                      ];
                    }}
                    disabled={
                      (drawTool === "route" && pathDraft.length < 2) ||
                      (drawTool === "zone" && pathDraft.length < 3)
                    }
                    onPress={finishPathDrawing}>
                    <Text style={[styles.drawFinishLabel, { color: onTintLabel }]}>Finish</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

        <Text style={[styles.fieldLabel, { color: p.tabIconDefault }]}>Place search</Text>
        <View style={styles.placeRow}>
          <TextInput
            placeholder="City, address, POI…"
            placeholderTextColor="#888"
            value={placeQuery}
            onChangeText={setPlaceQuery}
            onSubmitEditing={() => void runPlaceSearch()}
            returnKeyType="search"
            style={[
              styles.placeInput,
              {
                color: p.text,
                borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
                backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
              },
            ]}
          />
          <Pressable
            style={({ pressed }) => [
              styles.placeSearchBtn,
              { backgroundColor: p.tint, opacity: pressed ? 0.9 : 1 },
            ]}
            disabled={placeSearching}
            onPress={() => void runPlaceSearch()}>
            <Text style={[styles.placeSearchBtnLabel, { color: onTintLabel }]}>
              {placeSearching ? "…" : "Search"}
            </Text>
          </Pressable>
        </View>
        {placeHits.length ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.placeResults}
            nestedScrollEnabled>
            {placeHits.map((h, i) => (
              <Pressable
                key={`${h.source}-${h.lat}-${h.lng}-${i}`}
                style={({ pressed }) => [
                  styles.placeHitRow,
                  {
                    borderColor: scheme === "dark" ? "#3f3f46" : "#e4e4e7",
                    backgroundColor: pressed
                      ? scheme === "dark"
                        ? "#18181b"
                        : "#f4f4f5"
                      : "transparent",
                  },
                ]}
                onPress={() => flyToCoords(h.lat, h.lng, 10)}>
                <Text style={[styles.placeHitLabel, { color: p.text }]} numberOfLines={2}>
                  {h.label}
                </Text>
                <Text style={[styles.placeHitMeta, { color: p.tabIconDefault }]}>
                  {h.source}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <Text style={[styles.fieldLabel, { color: p.tabIconDefault }]}>Overpass query</Text>
        <TextInput
          placeholder="Overpass QL — use __BBOX__ for bbox"
          placeholderTextColor="#888"
          value={customQl}
          onChangeText={setCustomQl}
          style={[
            styles.input,
            {
              color: p.text,
              borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
              backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
            },
          ]}
        />
        <Pressable
          style={({ pressed }) => [
            styles.runBtn,
            { backgroundColor: p.tint, opacity: pressed ? 0.9 : 1 },
          ]}
          onPress={() => void runCustomIntel()}>
          <Text style={[styles.runBtnLabel, { color: onTintLabel }]}>Run query</Text>
        </Pressable>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  /** Full-bleed map; tools float above so minimizing the sheet frees the whole viewport. */
  mapFill: {
    ...StyleSheet.absoluteFillObject,
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    paddingHorizontal: 14,
    gap: 10,
    ...(Platform.OS === "ios"
      ? {
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.12,
          shadowRadius: 8,
        }
      : Platform.OS === "android"
        ? { elevation: 12 }
        : { boxShadow: "0 -4px 14px rgba(0,0,0,0.12)" }),
  },
  sheetHandleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 8,
    paddingBottom: 10,
    marginHorizontal: -14,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetHitExpand: {
    paddingVertical: 8,
    paddingRight: 4,
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(120,120,128,0.35)",
  },
  sheetTitleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sheetDragHint: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 0.2,
    opacity: 0.65,
    flexShrink: 0,
  },
  sheetBodyScroll: {
    flex: 1,
    minHeight: 0,
  },
  sheetBodyContent: {
    flexGrow: 1,
    gap: 10,
  },
  panelTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  chipScroll: {
    flexGrow: 0,
    marginHorizontal: -2,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
    paddingRight: 8,
  },
  chip: {
    flexShrink: 0,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
    letterSpacing: 0.3,
  },
  drawHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  drawActions: {
    gap: 8,
    marginTop: 2,
  },
  vertexCount: {
    fontSize: 13,
    fontWeight: "600",
  },
  drawBtnRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  drawSecondaryBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  drawSecondaryLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  drawFinishBtn: {
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  drawFinishLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  placeInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  placeSearchBtn: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  placeSearchBtnLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
  placeResults: {
    maxHeight: 140,
    marginTop: 2,
  },
  placeHitRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  placeHitLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  placeHitMeta: {
    fontSize: 11,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 13,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  runBtn: {
    alignSelf: "stretch",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  runBtnLabel: {
    fontSize: 16,
    fontWeight: "700",
  },
});
