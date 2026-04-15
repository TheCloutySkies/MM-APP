import FontAwesome from "@expo/vector-icons/FontAwesome";
import Slider from "@react-native-community/slider";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import type { Feature, LineString } from "geojson";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    ActivityIndicator,
    Alert,
    Modal,
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

import { MapGisFeaturePanel } from "@/components/map/MapGisFeaturePanel";
import { MapIntelPanel, type MapIntelLinkPick } from "@/components/map/MapIntelPanel";
import { TacticalCategoryModal } from "@/components/map/TacticalCategoryModal";
import {
    TacticalMap,
    type MapFlyToRequest,
    type MapPin,
    type MapPolygonOverlay,
    type MapPolylineOverlay,
} from "@/components/map/TacticalMap";
import type { GisDrawPalette, MeasurePreview } from "@/components/map/gisMapTypes";
import type { MapBaseLayerId, MapPointerMode, MapUserLocation } from "@/components/map/mapTypes";
import { useActivityLogger } from "@/hooks/useActivityLogger";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { decryptUtf8, encryptUtf8 } from "@/lib/crypto/aesGcm";
import { hexToBytes } from "@/lib/crypto/bytes";
import { getMapSharedKeyHex } from "@/lib/env";
import { lngLatToMgrs } from "@/lib/geo/mgrsFormat";
import { geocodeSearch } from "@/lib/geocode";
import { encryptFeatureCollectionJson } from "@/lib/gis/geoJsonCrypto";
import { saveEncryptedGisDraft } from "@/lib/gis/gisLocalStore";
import {
    appendFeature,
    ensureFeatureId,
    upsertFeatureInCollection,
    type ActiveMapTool,
} from "@/lib/gis/gisTypes";
import {
    BUFFER_RANGE,
    bufferAmountToKm,
    convertAmountBetweenUnits,
    formatDistanceFromKm,
    type GisDistanceUnit,
} from "@/lib/gis/gisUnits";
import {
    tacticalChoicesToSIDC,
    type TacticalAffiliation,
    type TacticalUnitType,
} from "@/lib/gis/milSym";
import {
    bufferPointKm,
    distanceKm,
    emptyFeatureCollection,
    lineLengthMiles,
} from "@/lib/gis/turfOps";
import {
    buildTacticalPayload,
    normalizeTacticalPayload,
    tacticPayloadToLayers,
    type TacCategoryId,
    type TacticalMapPayload,
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
import { TEAM_POSITION_AAD, tintForUsername, type TeamPositionPayloadV1 } from "@/lib/teamPosition";
import { fetchOpenMeteoCurrent } from "@/lib/weather";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";

const MIN_SHEET_H = 56;
const SHEET_X_CLAMP = 110;
/** Web desktop dock: remember fullscreen (collapsed) tools sidebar. */
const MAP_TOOLS_DOCK_COLLAPSED_KEY = "mm_map_tools_dock_collapsed_v1";
/**
 * Default expanded height for the map-center coord chip (`CoordWidget`).
 * The collapsed “Map tools” FAB is placed beneath this so it does not cover the readout.
 */
const COORD_WIDGET_DEFAULT_EXPANDED_H = 78;

/** Muted tactical palette — readable on night basemaps without a full-spectrum strip. */
const GIS_COLOR_SWATCHES = [
  "#6b8e5c",
  "#9a5c5f",
  "#b89a5c",
  "#5f7d8c",
  "#64748b",
  "#a8a29e",
  "#3f4240",
] as const;
/** Web + Settings → desktop layout: dock map tools as a right sidebar instead of a bottom sheet. */
const DESKTOP_MAP_TOOLS_DOCK_MIN_W = 920;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function formatBufferRadiusInput(amount: number, unit: GisDistanceUnit) {
  return amount.toFixed(unit === "mi" || unit === "km" ? 3 : 0);
}

function snapBufferRadius(amount: number, unit: GisDistanceUnit) {
  const { min, max, step } = BUFFER_RANGE[unit];
  const snapped = Math.round(amount / step) * step;
  if (!Number.isFinite(snapped)) return min;
  return clamp(snapped, min, max);
}

const COORD_WIDGET_W = 260;
const COORD_WIDGET_H_EXPANDED = COORD_WIDGET_DEFAULT_EXPANDED_H;
const COORD_WIDGET_H_MIN = 40;

function CoordWidget(props: {
  tint: string;
  border: string;
  text: string;
  textMuted: string;
  surface: string;
  label: string;
  fmt: "latlng" | "mgrs";
  onToggleFmt: () => void;
  /**
   * `rail` — full-width strip above the map (saves canvas space). `overlay` — draggable floating chip
   * (legacy).
   */
  variant?: "rail" | "overlay";
  /** Overlay only: Y from screen top for first placement (below search HUD). */
  stackBelowHudY?: number;
}) {
  const variant = props.variant ?? "rail";
  const { width: winW, height: winH } = useWindowDimensions();
  const posRef = useRef({ x: 12, y: 120 });
  const dragOrigin = useRef({ x: 0, y: 0 });
  const [pos, setPos] = useState(() => ({ ...posRef.current }));
  const [min, setMin] = useState(false);
  const positionedRef = useRef(false);

  const boxH = min ? COORD_WIDGET_H_MIN : COORD_WIDGET_H_EXPANDED;
  const boxW = min ? 220 : COORD_WIDGET_W;

  /** One-time placement under the HUD, right-aligned — overlay only. */
  useEffect(() => {
    if (variant !== "overlay") return;
    const belowY = props.stackBelowHudY ?? 120;
    if (positionedRef.current || winW < 48) return;
    positionedRef.current = true;
    const w = COORD_WIDGET_W;
    const h = COORD_WIDGET_H_EXPANDED;
    const top = Math.max(belowY, 12);
    const x = clamp(winW - w - 12, 8, Math.max(8, winW - w - 8));
    const y = clamp(top, 8, Math.max(8, winH - h - 8));
    posRef.current = { x, y };
    setPos({ ...posRef.current });
  }, [variant, winW, winH, props.stackBelowHudY]);

  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  const drag = useMemo(
    () =>
      variant === "overlay"
        ? PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
            onPanResponderGrant: () => {
              dragOrigin.current = { x: posRef.current.x, y: posRef.current.y };
            },
            onPanResponderMove: (_, g) => {
              const nx = clamp(dragOrigin.current.x + g.dx, 6, Math.max(6, winW - boxW - 6));
              const ny = clamp(dragOrigin.current.y + g.dy, 6, Math.max(6, winH - boxH - 6));
              setPos((prev) => ({ ...prev, x: nx, y: ny }));
            },
          })
        : null,
    [variant, winW, winH, boxW, boxH],
  );

  const outerStyle =
    variant === "rail"
      ? [
          styles.coordRail,
          {
            borderColor: props.border,
            backgroundColor: props.surface,
            zIndex: 4,
          },
        ]
      : [
          styles.coordBox,
          {
            left: pos.x,
            top: pos.y,
            width: boxW,
            height: boxH,
            borderColor: props.border,
            backgroundColor: props.surface,
            zIndex: 1200,
            elevation: 8,
          },
        ];

  return (
    <View style={outerStyle}>
      <View
        {...(drag ? drag.panHandlers : {})}
        style={[styles.coordInner, min ? styles.coordInnerMin : styles.coordInnerExpanded]}>
        {min ? (
          <>
            <Text style={[styles.coordValMin, { color: props.text }]} numberOfLines={1} selectable>
              {props.label}
            </Text>
            <View style={styles.coordActionsRow}>
              <Pressable
                onPress={props.onToggleFmt}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={props.fmt === "mgrs" ? "Show latitude and longitude" : "Show MGRS"}>
                <Text style={[styles.coordActionLink, { color: props.tint }]}>
                  {props.fmt === "mgrs" ? "Lat / long" : "MGRS"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMin(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Expand map center readout">
                <FontAwesome name="chevron-up" size={13} color={props.textMuted} />
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View style={styles.coordTextCol}>
              <Text style={[styles.coordEyebrow, { color: props.textMuted }]}>
                Map center · {props.fmt === "mgrs" ? "MGRS" : "Lat / long"}
              </Text>
              <Text style={[styles.coordVal, { color: props.text }]} numberOfLines={2} selectable>
                {props.label}
              </Text>
            </View>
            <View style={styles.coordActionsCol}>
              <Pressable
                onPress={props.onToggleFmt}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={props.fmt === "mgrs" ? "Show latitude and longitude" : "Show MGRS"}>
                <Text style={[styles.coordActionLink, { color: props.tint }]}>
                  {props.fmt === "mgrs" ? "Lat / long" : "MGRS"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMin(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Minimize map center readout">
                <FontAwesome name="chevron-down" size={13} color={props.textMuted} />
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

export default function MapScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const chrome = useTacticalChrome();
  const visualTheme = useMMStore((s) => s.visualTheme);
  const mapNightDimPercent = useMMStore((s) => s.mapNightDimPercent);
  const { height: windowH, width: windowW } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const desktopMode = useMMStore((s) => s.desktopMode);
  const vaultMode = useMMStore((s) => s.vaultMode) as VaultMode | null;

  /** Label on solid tint buttons — crimson (Night Ops) needs light text; woodland dark uses dark on green. */
  const onTintLabel = visualTheme === "nightops" ? "#ffffff" : scheme === "dark" ? "#0f172a" : "#ffffff";

  const mapKey = useMemo(() => {
    const hex = resolveMapEncryptKey() ?? getMapSharedKeyHex();
    if (!hex || hex.length !== 64) return null;
    try {
      return hexToBytes(hex);
    } catch {
      return null;
    }
  }, [vaultMode]);

  const { logAction } = useActivityLogger();
  const mapFocusMarkerId = useMMStore((s) => s.mapFocusMarkerId);
  const setMapFocusMarkerId = useMMStore((s) => s.setMapFocusMarkerId);
  const mgrsPickHandler = useMMStore((s) => s.mgrsPickHandler);
  const setMgrsPickHandler = useMMStore((s) => s.setMgrsPickHandler);

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
  const [showIntel, setShowIntel] = useState(false);
  const [teamLivePins, setTeamLivePins] = useState<MapPin[]>([]);
  const [shareTeamLocation, setShareTeamLocation] = useState(false);
  const [intelToolsOpen, setIntelToolsOpen] = useState(false);
  const [customQl, setCustomQl] = useState(`node["amenity"="fuel"](__BBOX__);`);
  const [loading, setLoading] = useState(false);
  const [osintPower, setOsintPower] = useState(false);
  const [osintUsgs, setOsintUsgs] = useState(false);
  const [osintFirms, setOsintFirms] = useState(false);
  const [supermapPins, setSupermapPins] = useState<MapPin[]>([]);
  const [supermapPolylines, setSupermapPolylines] = useState<MapPolylineOverlay[]>([]);
  const [baseLayer, setBaseLayer] = useState<MapBaseLayerId>("osm_dark");
  const [userLoc, setUserLoc] = useState<MapUserLocation | null>(null);
  const [pointDropMode, setPointDropMode] = useState(false);
  const [center, setCenter] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [centerFmt, setCenterFmt] = useState<"latlng" | "mgrs">("latlng");
  const [hudSearchOpen, setHudSearchOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [hudQuery, setHudQuery] = useState("");
  const [hudSearching, setHudSearching] = useState(false);
  /** Calcite-style intel tray — marker details in trailing / bottom panel instead of only a popup. */
  const [selectedPin, setSelectedPin] = useState<MapPin | null>(null);
  /** Decrypted tactical payloads keyed by `map_markers.id` (for edit / link UI). */
  const [tacticalPayloadById, setTacticalPayloadById] = useState<Record<string, TacticalMapPayload>>({});
  const [intelLinkOptions, setIntelLinkOptions] = useState<MapIntelLinkPick[]>([]);
  /** Web Leaflet: Turf + Geoman + MIL symbols — encrypted before any server write. */
  const [gisFc, setGisFc] = useState(() => emptyFeatureCollection());
  const [activeMapTool, setActiveMapTool] = useState<ActiveMapTool>("navigate");
  const [selectedGisFeature, setSelectedGisFeature] = useState<Feature | null>(null);
  const [cursorMgrs, setCursorMgrs] = useState("—");
  const [bufferModal, setBufferModal] = useState<{ lat: number; lng: number } | null>(null);
  const [bufferRadiusAmount, setBufferRadiusAmount] = useState(1);
  const [bufferUnit, setBufferUnit] = useState<GisDistanceUnit>("km");
  const [gisMeasureReadoutMode, setGisMeasureReadoutMode] = useState<"metric" | "imperial">("metric");
  const [measureA, setMeasureA] = useState<{ lat: number; lng: number } | null>(null);
  const [measureHover, setMeasureHover] = useState<{ lat: number; lng: number } | null>(null);
  const [gisBufferStroke, setGisBufferStroke] = useState("#9a5c5f");
  const [gisBufferFill, setGisBufferFill] = useState("#9a5c5f");
  const [gisGeomanLineColor, setGisGeomanLineColor] = useState("#5f7d8c");
  const [gisGeomanZoneStroke, setGisGeomanZoneStroke] = useState("#6b8e5c");
  const [gisGeomanZoneFill, setGisGeomanZoneFill] = useState("#6b8e5c");
  const [gisMeasureColor, setGisMeasureColor] = useState("#b89a5c");
  const [bufferRadiusTyping, setBufferRadiusTyping] = useState(false);
  const [bufferRadiusText, setBufferRadiusText] = useState("");
  const [milAffiliation, setMilAffiliation] = useState<TacticalAffiliation>("friendly");
  const [milUnit, setMilUnit] = useState<TacticalUnitType>("infantry");
  const [routeEtaMph, setRouteEtaMph] = useState("30");
  /** Desktop web: hide right Map tools column for a wider map (persisted locally). */
  const [mapToolsDockCollapsed, setMapToolsDockCollapsed] = useState(() => {
    if (Platform.OS !== "web" || typeof localStorage === "undefined") return false;
    try {
      return localStorage.getItem(MAP_TOOLS_DOCK_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const flySeq = useRef(0);
  const [flyTo, setFlyTo] = useState<MapFlyToRequest | null>(null);
  // (place search moved to HUD)

  const dockToolsRight = Platform.OS === "web" && desktopMode && windowW >= DESKTOP_MAP_TOOLS_DOCK_MIN_W;
  const compactToolChips = !dockToolsRight && windowW < 600;

  const persistMapToolsDockCollapsed = useCallback((collapsed: boolean) => {
    setMapToolsDockCollapsed(collapsed);
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(MAP_TOOLS_DOCK_COLLAPSED_KEY, collapsed ? "1" : "0");
      } catch {
        /* ignore */
      }
    }
  }, []);

  /** Anchored tools panel: max ~50% viewport on phone / PWA (Calcite-style); desktop dock uses ~58%. */
  const maxSheetH = Math.min(
    520,
    windowH * (dockToolsRight ? 0.58 : 0.5),
  );
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
    if (activeMapTool !== "measure") {
      setMeasureA(null);
      setMeasureHover(null);
    }
  }, [activeMapTool]);

  useEffect(() => {
    if (!bufferModal) return;
    const { min, max } = BUFFER_RANGE[bufferUnit];
    setBufferRadiusAmount((a) => Math.max(min, Math.min(max, a)));
  }, [bufferModal, bufferUnit]);

  useEffect(() => {
    if (!bufferModal) {
      setBufferRadiusTyping(false);
      return;
    }
    if (!bufferRadiusTyping) {
      setBufferRadiusText(formatBufferRadiusInput(bufferRadiusAmount, bufferUnit));
    }
  }, [bufferModal, bufferUnit, bufferRadiusAmount, bufferRadiusTyping]);

  const requestWebLocation = useCallback(() => {
    if (Platform.OS !== "web" || typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 35_000 },
    );
  }, []);

  useEffect(() => {
    let nativeSub: { remove: () => void } | null = null;
    let webWatch: number | undefined;
    const run = async () => {
      if (Platform.OS === "web") {
        if (typeof navigator === "undefined" || !navigator.geolocation) return;
        const geo = navigator.geolocation;
        const applyFix = (pos: GeolocationPosition) =>
          setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        const opts: PositionOptions = {
          enableHighAccuracy: true,
          maximumAge: 15_000,
          timeout: 35_000,
        };
        geo.getCurrentPosition(applyFix, () => {}, { ...opts, maximumAge: 0 });
        webWatch = geo.watchPosition(applyFix, () => {}, opts);
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

  useEffect(() => {
    if (!mapFocusMarkerId) return;
    const id = mapFocusMarkerId;
    const pin = tacticalPins.find((p) => p.id === id);
    if (pin) {
      flyToCoords(pin.lat, pin.lng, 14);
      setSelectedPin(pin);
      setMapFocusMarkerId(null);
      return;
    }
    const line = tacticalPolylines.find((p) => p.id === id);
    const lc = line?.coordinates[0];
    if (lc) {
      flyToCoords(lc.latitude, lc.longitude, 13);
      setMapFocusMarkerId(null);
      return;
    }
    const poly = tacticalPolygons.find((p) => p.id === id);
    const pc = poly?.coordinates[0];
    if (pc) {
      flyToCoords(pc.latitude, pc.longitude, 12);
      setMapFocusMarkerId(null);
    }
  }, [mapFocusMarkerId, tacticalPins, tacticalPolylines, tacticalPolygons, setMapFocusMarkerId]);

  const runHudSearch = async () => {
    const q = hudQuery.trim();
    if (!q) return;
    setHudSearching(true);
    try {
      const hits = await geocodeSearch(q, 6);
      if (hits[0]) {
        flyToCoords(hits[0].lat, hits[0].lng, 11);
        setLayersOpen(false);
      } else {
        Alert.alert("Search", "No results.");
      }
    } catch (e) {
      Alert.alert("Search", e instanceof Error ? e.message : "Search failed");
    } finally {
      setHudSearching(false);
    }
  };

  const loadMarkers = useCallback(async () => {
    if (!supabase || !mapKey) return;
    const { data, error } = await supabase
      .from("map_markers")
      .select("id, profile_id, encrypted_payload")
      .order("created_at", { ascending: false });
    if (error) {
      console.warn(error.message);
      return;
    }
    const nextPins: MapPin[] = [];
    const nextLines: MapPolylineOverlay[] = [];
    const nextPolys: MapPolygonOverlay[] = [];
    const nextPayloads: Record<string, TacticalMapPayload> = {};
    for (const row of data ?? []) {
      try {
        const json = decryptUtf8(mapKey, row.encrypted_payload, "mm-map-marker");
        const payload = normalizeTacticalPayload(JSON.parse(json) as unknown);
        if (!payload) continue;
        nextPayloads[row.id as string] = payload;
        const stale = payload.staleHours
          ? Date.now() - payload.droppedAt > payload.staleHours * 3600 * 1000
          : false;
        const layers = tacticPayloadToLayers(row.id, payload, stale, row.profile_id as string | null);
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
    setTacticalPayloadById(nextPayloads);
  }, [mapKey, supabase]);

  useEffect(() => {
    if (!supabase || !selectedPin?.markerOwnerProfileId) {
      setIntelLinkOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [opsRes, hubsRes, legRes] = await Promise.all([
        supabase
          .from("ops_reports")
          .select("id, doc_kind, created_at, author_username")
          .order("created_at", { ascending: false })
          .limit(80),
        supabase
          .from("operation_hubs")
          .select("id, created_at, author_username")
          .order("created_at", { ascending: false })
          .limit(80),
        supabase.from("missions").select("id, created_at").order("created_at", { ascending: false }).limit(80),
      ]);
      if (cancelled) return;
      const out: MapIntelLinkPick[] = [];
      for (const r of opsRes.data ?? []) {
        const id = r.id as string;
        const dk = String(r.doc_kind ?? "report");
        const au = String(r.author_username ?? "—");
        const dt = String(r.created_at ?? "").slice(0, 10);
        out.push({ source: "ops_report", id, subtitle: `${dk} · ${au} · ${dt}` });
      }
      for (const r of hubsRes.data ?? []) {
        const id = r.id as string;
        const au = String(r.author_username ?? "—");
        const dt = String(r.created_at ?? "").slice(0, 10);
        out.push({ source: "operation_hub", id, subtitle: `Operation hub · ${au} · ${dt}` });
      }
      for (const r of legRes.data ?? []) {
        const id = r.id as string;
        const dt = String(r.created_at ?? "").slice(0, 10);
        out.push({ source: "legacy_mission", id, subtitle: `Legacy mission · ${dt}` });
      }
      setIntelLinkOptions(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, selectedPin?.id, selectedPin?.markerOwnerProfileId]);

  const saveIntelEdits = useCallback(
    async (markerId: string, next: { title: string; notes: string; link: MapIntelLinkPick | null }) => {
      if (!supabase || !mapKey || mapKey.length !== 32) {
        Alert.alert("Map", "Map encryption key not available.");
        return;
      }
      const base = tacticalPayloadById[markerId];
      if (!base) {
        Alert.alert("Map", "Could not load marker data.");
        return;
      }
      const merged: TacticalMapPayload = {
        ...base,
        title: next.title.trim() || undefined,
        notes: next.notes.trim() || undefined,
        linkedOpsReportId: undefined,
        linkedOperationHubId: undefined,
        linkedLegacyMissionId: undefined,
        linkLabel: undefined,
      };
      if (next.link) {
        merged.linkLabel = next.link.subtitle;
        if (next.link.source === "ops_report") merged.linkedOpsReportId = next.link.id;
        else if (next.link.source === "operation_hub") merged.linkedOperationHubId = next.link.id;
        else merged.linkedLegacyMissionId = next.link.id;
      }
      const encrypted = encryptUtf8(mapKey, JSON.stringify(merged), "mm-map-marker");
      const { error } = await supabase.from("map_markers").update({ encrypted_payload: encrypted }).eq("id", markerId);
      if (error) {
        Alert.alert("Map", error.message);
        return;
      }
      void loadMarkers();
    },
    [supabase, mapKey, tacticalPayloadById, loadMarkers],
  );

  const deleteTacticalMarkerRow = useCallback(
    async (markerId: string) => {
      if (!supabase) return;
      const { error: delErr } = await supabase.from("map_markers").delete().eq("id", markerId);
      if (delErr) {
        Alert.alert("Map", delErr.message);
        return;
      }
      setSelectedPin(null);
      void loadMarkers();
    },
    [supabase, loadMarkers],
  );

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

  const loadTeamPositions = useCallback(async () => {
    if (!supabase || !mapKey || mapKey.length !== 32) {
      setTeamLivePins([]);
      return;
    }
    const { data, error } = await supabase
      .from("team_positions")
      .select("profile_id, username, encrypted_payload")
      .order("updated_at", { ascending: false });
    if (error) {
      console.warn(error.message);
      return;
    }
    const next: MapPin[] = [];
    for (const row of data ?? []) {
      if (row.profile_id === profileId) continue;
      try {
        const json = decryptUtf8(mapKey, row.encrypted_payload as string, TEAM_POSITION_AAD);
        const pos = JSON.parse(json) as TeamPositionPayloadV1;
        if (typeof pos.lat !== "number" || typeof pos.lng !== "number") continue;
        const uname = String(row.username ?? "op");
        next.push({
          id: `team-pos-${row.profile_id}`,
          lat: pos.lat,
          lng: pos.lng,
          title: `Live · ${uname}`,
          tint: tintForUsername(uname),
        });
      } catch {
        /* wrong key */
      }
    }
    setTeamLivePins(next);
  }, [supabase, mapKey, profileId]);

  useEffect(() => {
    void loadTeamPositions();
  }, [loadTeamPositions]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("mm-team-positions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_positions" },
        () => void loadTeamPositions(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, loadTeamPositions]);

  const clearMyTeamPosition = useCallback(async () => {
    if (!supabase || !profileId) return;
    await supabase.from("team_positions").delete().eq("profile_id", profileId);
  }, [supabase, profileId]);

  useEffect(() => {
    if (!shareTeamLocation || !supabase || !profileId || !mapKey || mapKey.length !== 32) return;
    const push = async () => {
      if (!userLoc) return;
      const payload: TeamPositionPayloadV1 = {
        v: 1,
        lat: userLoc.lat,
        lng: userLoc.lng,
        at: Date.now(),
      };
      const enc = encryptUtf8(mapKey, JSON.stringify(payload), TEAM_POSITION_AAD);
      const { error } = await supabase.from("team_positions").upsert(
        {
          profile_id: profileId,
          username: username?.trim() || "operator",
          encrypted_payload: enc,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "profile_id" },
      );
      if (error) console.warn(error.message);
    };
    void push();
    const id = setInterval(() => void push(), 20000);
    return () => clearInterval(id);
  }, [shareTeamLocation, supabase, profileId, mapKey, username, userLoc]);

  const saveTacticalFeature = async (cat: TacCategoryId, pick: NonNullable<typeof categoryPick>) => {
    if (!supabase || !profileId || !mapKey) return;
    const creator = username?.trim() || "Operator";
    const payload = buildTacticalPayload(pick.geom, cat, pick.coordinates, creator, { staleHours: 48 });
    const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), "mm-map-marker");
    const { data, error } = await supabase
      .from("map_markers")
      .insert({
        profile_id: profileId,
        encrypted_payload: encrypted,
      })
      .select("id")
      .single();
    if (error) {
      Alert.alert("Map", error.message);
      return;
    }
    setCategoryPick(null);
    void loadMarkers();
    if (data?.id) void logAction("MAP_PIN", data.id as string);
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
    if (mode === "route" || mode === "zone") {
      setActiveMapTool("navigate");
      setMeasureA(null);
    }
  };

  const mapPointerMode: MapPointerMode =
    drawTool === "route" ||
    drawTool === "zone" ||
    pointDropMode ||
    (Platform.OS === "web" &&
      (activeMapTool === "buffer" ||
        activeMapTool === "measure" ||
        activeMapTool === "draw" ||
        activeMapTool === "mil_symbol"))
      ? "crosshair"
      : "default";

  const selectActiveMapTool = useCallback((id: ActiveMapTool) => {
    setDrawTool("idle");
    setPointDropMode(false);
    setPathDraft([]);
    setMeasureA(null);
    setMeasureHover(null);
    setActiveMapTool(id);
  }, []);

  const nudgeBufferRadius = useCallback(
    (dir: -1 | 1) => {
      setBufferRadiusTyping(false);
      const { step } = BUFFER_RANGE[bufferUnit];
      setBufferRadiusAmount((a) => snapBufferRadius(a + dir * step, bufferUnit));
    },
    [bufferUnit],
  );

  const commitBufferRadiusField = useCallback(() => {
    setBufferRadiusTyping(false);
    const parsed = parseFloat(bufferRadiusText.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      setBufferRadiusText(formatBufferRadiusInput(bufferRadiusAmount, bufferUnit));
      return;
    }
    const { min, max } = BUFFER_RANGE[bufferUnit];
    const next = snapBufferRadius(clamp(parsed, min, max), bufferUnit);
    setBufferRadiusAmount(next);
    setBufferRadiusText(formatBufferRadiusInput(next, bufferUnit));
  }, [bufferRadiusAmount, bufferRadiusText, bufferUnit]);

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

  const mergedPins = useMemo(() => {
    const teamAndTac = [...tacticalPins, ...teamLivePins];
    return showIntel ? [...teamAndTac, ...intelPins, ...supermapPins] : teamAndTac;
  }, [tacticalPins, teamLivePins, showIntel, intelPins, supermapPins]);

  const draftLinePreview = useMemo((): MapPolylineOverlay | null => {
    if (drawTool === "route" && pathDraft.length >= 2) {
      return {
        id: "__mm_draft_line__",
        coordinates: pathDraft.map((x) => ({ latitude: x.lat, longitude: x.lng })),
        color: chrome.textMuted,
        title: "Route draft",
        lineDash: "7 5",
      };
    }
    if (drawTool === "zone" && pathDraft.length === 2) {
      return {
        id: "__mm_draft_line2__",
        coordinates: pathDraft.map((x) => ({ latitude: x.lat, longitude: x.lng })),
        color: chrome.textMuted,
        title: "Zone draft",
        lineDash: "7 5",
      };
    }
    return null;
  }, [drawTool, pathDraft, chrome.textMuted]);

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
      strokeColor: chrome.textMuted,
      fillColor: "rgba(139,115,85,0.22)",
      title: "Zone draft",
    };
  }, [drawTool, pathDraft, chrome.textMuted]);

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

  // (place search moved to HUD)

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

  const ChipStrip = ({ children }: { children: ReactNode }) =>
    compactToolChips ? (
      Platform.OS === "web" ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={styles.chipStripWebMobile}
          contentContainerStyle={styles.chipStripWebMobileInner}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.chipRowWrap}>{children}</View>
      )
    ) : (
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}>
        {children}
      </ScrollView>
    );

  const mgrsLabel = useMemo(() => {
    if (!center) return "";
    try {
      // mgrs.forward expects [lon, lat]
      // dynamic import to keep bundle light
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require("mgrs") as { forward: (lngLat: [number, number], accuracy?: number) => string };
      return m.forward([center.lng, center.lat], 5);
    } catch {
      return "";
    }
  }, [center?.lat, center?.lng]);

  const centerLabel =
    !center
      ? "—"
      : centerFmt === "mgrs" && mgrsLabel
        ? mgrsLabel
        : `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;

  const applyCrosshairMgrsToForm = () => {
    if (!mgrsPickHandler) return;
    if (!center) {
      Alert.alert("Map", "Pan/ zoom until the crosshair sits on your point, then try again.");
      return;
    }
    const grid = lngLatToMgrs(center.lat, center.lng, 5);
    if (!grid.trim()) {
      Alert.alert("Map", "Could not compute MGRS for the crosshair.");
      return;
    }
    mgrsPickHandler(grid);
    setMgrsPickHandler(null);
    router.back();
  };

  const cancelMgrsPick = () => {
    if (!mgrsPickHandler) return;
    setMgrsPickHandler(null);
  };

  const handleMapPress = (lat: number, lng: number) => {
    if (drawTool === "route" || drawTool === "zone" || pointDropMode) {
      onMapTap(lat, lng);
      return;
    }
    if (Platform.OS === "web" && activeMapTool === "draw") {
      return;
    }
    if (Platform.OS === "web" && activeMapTool === "buffer") {
      setBufferModal({ lat, lng });
      return;
    }
    if (Platform.OS === "web" && activeMapTool === "measure") {
      if (!measureA) {
        setMeasureA({ lat, lng });
        setMeasureHover(null);
      } else {
        const dKm = distanceKm(measureA.lat, measureA.lng, lat, lng);
        const primary = formatDistanceFromKm(dKm, gisMeasureReadoutMode);
        const other = formatDistanceFromKm(dKm, gisMeasureReadoutMode === "metric" ? "imperial" : "metric");
        Alert.alert("Measure", `${primary}\n${other}`);
        setMeasureA(null);
        setMeasureHover(null);
      }
      return;
    }
    if (Platform.OS === "web" && activeMapTool === "mil_symbol") {
      const sidc = tacticalChoicesToSIDC(milAffiliation, milUnit);
      const creator = username?.trim() || "operator";
      const feat = ensureFeatureId({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
          kind: "mil_symbol",
          sidc,
          affiliation: milAffiliation,
          unitType: milUnit,
          createdAt: Date.now(),
          createdBy: creator,
        },
      });
      setGisFc((prev) => appendFeature(prev, feat));
      setActiveMapTool("navigate");
      return;
    }
    setSelectedPin(null);
    setSelectedGisFeature(null);
  };

  const onGisFeatureSelectLeaflet = useCallback((f: Feature) => {
    setSelectedPin(null);
    setSelectedGisFeature(f);
  }, []);

  const onMouseMoveLatLng = useCallback(
    (lat: number, lng: number) => {
      if (Platform.OS !== "web") return;
      if (activeMapTool === "measure" && measureA) {
        setMeasureHover({ lat, lng });
      }
      try {
        const mgrsLib = require("mgrs") as {
          forward: (ll: [number, number], accuracy?: number) => string;
        };
        setCursorMgrs(mgrsLib.forward([lng, lat], 5));
      } catch {
        setCursorMgrs("—");
      }
    },
    [activeMapTool, measureA],
  );

  const onPmCreateLeaflet = useCallback(
    (feat: Feature) => {
      const creator = username?.trim() || "operator";
      const baseProps: Record<string, unknown> = {
        ...((feat.properties as Record<string, unknown>) ?? {}),
        createdAt: Date.now(),
        createdBy: creator,
      };
      const g = feat.geometry;
      if (g?.type === "LineString") {
        baseProps.kind = "route";
        baseProps.lineColor = gisGeomanLineColor;
        try {
          baseProps.lengthMiles = lineLengthMiles(feat as Feature<LineString>);
        } catch {
          /* keep kind only */
        }
      } else if (g?.type === "Polygon") {
        baseProps.kind = "zone";
        baseProps.zoneStroke = gisGeomanZoneStroke;
        baseProps.zoneFill = gisGeomanZoneFill;
      } else {
        baseProps.kind = baseProps.kind ?? "geoman";
      }
      const enriched = ensureFeatureId({ ...feat, properties: baseProps });
      setGisFc((prev) => appendFeature(prev, enriched));
      setActiveMapTool("navigate");
    },
    [username, gisGeomanLineColor, gisGeomanZoneStroke, gisGeomanZoneFill],
  );

  const saveGisEncryptedLocal = useCallback(async () => {
    if (!mapKey) {
      Alert.alert("GIS", "Map encryption key unavailable. Unlock vault or configure shared map key.");
      return;
    }
    try {
      const blob = encryptFeatureCollectionJson(gisFc, mapKey);
      await saveEncryptedGisDraft(blob);
      Alert.alert("GIS", "Encrypted GeoJSON draft saved on this device (IndexedDB).");
    } catch (e) {
      Alert.alert("GIS", e instanceof Error ? e.message : "Save failed.");
    }
  }, [gisFc, mapKey]);

  const commitGisFeature = useCallback(
    (next: Feature) => {
      const fixed = ensureFeatureId(next);
      setGisFc((prev) => {
        const fc = upsertFeatureInCollection(prev, fixed);
        if (mapKey) {
          try {
            const blob = encryptFeatureCollectionJson(fc, mapKey);
            void saveEncryptedGisDraft(blob);
          } catch (e) {
            Alert.alert("GIS backup", e instanceof Error ? e.message : "Could not write encrypted draft.");
          }
        }
        return fc;
      });
      setSelectedGisFeature(fixed);
    },
    [mapKey],
  );

  const applyBufferFromModal = () => {
    if (!bufferModal) return;
    const km = bufferAmountToKm(bufferRadiusAmount, bufferUnit);
    const poly = bufferPointKm(bufferModal.lat, bufferModal.lng, km);
    const creator = username?.trim() || "operator";
    const feat = ensureFeatureId({
      ...poly,
      properties: {
        kind: "buffer",
        radiusKm: km,
        bufferUnit,
        bufferAmount: bufferRadiusAmount,
        bufferStroke: gisBufferStroke,
        bufferFill: gisBufferFill,
        bufferFillOpacity: 0.14,
        createdAt: Date.now(),
        createdBy: creator,
        center: [bufferModal.lng, bufferModal.lat],
      },
    });
    setGisFc((prev) => appendFeature(prev, feat));
    setBufferModal(null);
    setActiveMapTool("navigate");
  };

  const gisPaletteForMap = useMemo<Partial<GisDrawPalette>>(
    () => ({
      bufferStroke: gisBufferStroke,
      bufferFill: gisBufferFill,
      lineString: gisGeomanLineColor,
      polygonStroke: gisGeomanZoneStroke,
      polygonFill: gisGeomanZoneFill,
      measure: gisMeasureColor,
    }),
    [gisBufferStroke, gisBufferFill, gisGeomanLineColor, gisGeomanZoneStroke, gisGeomanZoneFill, gisMeasureColor],
  );

  const measurePreviewForMap = useMemo<MeasurePreview | null>(() => {
    if (Platform.OS !== "web" || activeMapTool !== "measure" || !measureA) return null;
    return {
      from: measureA,
      to: measureHover,
      color: gisMeasureColor,
    };
  }, [activeMapTool, measureA, measureHover, gisMeasureColor]);

  const measureHudDistance =
    Platform.OS === "web" && activeMapTool === "measure" && measureA && measureHover
      ? formatDistanceFromKm(
          distanceKm(measureA.lat, measureA.lng, measureHover.lat, measureHover.lng),
          gisMeasureReadoutMode,
        )
      : null;

  const mapHudPadTop = Math.max(10, insets.top + 8);
  const coordStackBelowHud = mapHudPadTop + 54 + 10;
  /** Padding above/below the coord rail + default expanded chip height — clears “Map tools” FAB under HUD. */
  const MAP_COORD_RAIL_WRAP_PAD = 10;
  const mapCoordRailReserve = MAP_COORD_RAIL_WRAP_PAD + COORD_WIDGET_DEFAULT_EXPANDED_H;
  const mapToolsExpandFabTop = mapCoordRailReserve + coordStackBelowHud + 12;

  const mapCoordReadout = (
    <View
      style={[
        styles.mapCoordRail,
        {
          paddingTop: 6,
          paddingBottom: 4,
          paddingHorizontal: 10,
          borderBottomColor: scheme === "dark" ? "#27272a" : "#e4e4e7",
          backgroundColor: chrome.background,
        },
      ]}>
      <CoordWidget
        variant="rail"
        tint={chrome.tint}
        border={chrome.border}
        surface={chrome.surface}
        text={chrome.text}
        textMuted={chrome.tabIconDefault}
        label={centerLabel}
        fmt={centerFmt}
        onToggleFmt={() => setCenterFmt((v) => (v === "latlng" ? "mgrs" : "latlng"))}
      />
    </View>
  );

  const mapNode = (
    <View style={{ flex: 1, minHeight: 0 }}>
      <TacticalMap
        pins={mergedPins}
        polylines={mapPolylines}
        polygons={mapPolygons}
        onLongPress={onMapLongPress}
        onPress={handleMapPress}
        onPinSelect={(p) => {
          setSelectedGisFeature(null);
          setSelectedPin(p);
        }}
        flyTo={flyTo}
        baseLayer={baseLayer}
        userLocation={userLoc}
        pointerMode={mapPointerMode}
        onCenterChange={(lat, lng, zoom) => setCenter({ lat, lng, zoom })}
        mapDimPercent={visualTheme === "nightops" ? mapNightDimPercent : 0}
        {...(Platform.OS === "web"
          ? {
              gisFeatureCollection: gisFc,
              onGisFeatureSelect: onGisFeatureSelectLeaflet,
              geomanEnabled: activeMapTool === "draw",
              onPmCreate: onPmCreateLeaflet,
              onMouseMoveLatLng,
              onLocateRequest: requestWebLocation,
              gisMapZoom: center?.zoom,
              measurePreview: measurePreviewForMap,
              gisPalette: gisPaletteForMap,
            }
          : {})}
      />
      {/* Crosshair */}
      <View pointerEvents="none" style={styles.crosshairWrap}>
        <View style={[styles.crosshairDot, { borderColor: chrome.tint }]} />
        <View style={[styles.crosshairLineH, { backgroundColor: chrome.tint }]} />
        <View style={[styles.crosshairLineV, { backgroundColor: chrome.tint }]} />
      </View>

      {Platform.OS === "web" ? (
        <View
          style={[
            styles.mapToolRail,
            {
              top: coordStackBelowHud,
              backgroundColor: chrome.surface,
              borderColor: chrome.border,
            },
          ]}>
          {(
            [
              ["navigate", "Nav"],
              ["buffer", "Buf"],
              ["measure", "Msr"],
              ["draw", "Draw"],
              ["mil_symbol", "MIL"],
            ] as const
          ).map(([id, short]) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={
                id === "navigate"
                  ? "Navigate"
                  : id === "buffer"
                    ? "Buffer"
                    : id === "measure"
                      ? "Measure"
                      : id === "draw"
                        ? "Draw"
                        : "MIL point"
              }
              accessibilityState={{ selected: activeMapTool === id }}
              onPress={() => selectActiveMapTool(id)}
              style={({ pressed }) => [
                styles.mapToolRailBtn,
                {
                  borderColor: activeMapTool === id ? chrome.tint : chrome.border,
                  borderWidth: activeMapTool === id ? 2 : 1,
                  backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                },
              ]}>
              <Text
                style={[
                  styles.mapToolRailLabel,
                  { color: activeMapTool === id ? chrome.tint : chrome.text },
                ]}>
                {short}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {layersOpen ? (
        <Pressable
          accessibilityLabel="Close layers menu"
          onPress={() => setLayersOpen(false)}
          style={[StyleSheet.absoluteFillObject, styles.hudLayersBackdrop]}
        />
      ) : null}

      {/* HUD: full-width search + layers menu anchored to the layers button (opens downward). */}
      <View
        style={[styles.hudTop, { paddingTop: mapHudPadTop, zIndex: 1050 }]}
        pointerEvents="box-none">
        <View style={styles.hudTopRow} pointerEvents="box-none">
          <View
            style={[
              styles.hudSearchCard,
              { backgroundColor: chrome.surface, borderColor: chrome.border },
            ]}>
            <Pressable
              onPress={() => setHudSearchOpen((v) => !v)}
              style={styles.hudIconBtn}
              accessibilityRole="button"
              accessibilityLabel={hudSearchOpen ? "Minimize search" : "Open search"}>
              <FontAwesome name={hudSearchOpen ? "chevron-up" : "search"} size={16} color={chrome.tabIconDefault} />
            </Pressable>
            {hudSearchOpen ? (
              <>
                <TextInput
                  value={hudQuery}
                  onChangeText={setHudQuery}
                  placeholder="Search place, grid, POI…"
                  placeholderTextColor="#888"
                  onSubmitEditing={() => void runHudSearch()}
                  style={[
                    styles.hudInput,
                    { color: chrome.text, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
                  ]}
                  returnKeyType="search"
                />
                <Pressable
                  onPress={() => void runHudSearch()}
                  style={[styles.hudGoBtn, { backgroundColor: chrome.tint, opacity: hudSearching ? 0.6 : 1 }]}
                  disabled={hudSearching}>
                  <Text style={[styles.hudGoTx, { color: onTintLabel }]}>
                    {hudSearching ? "…" : "Go"}
                  </Text>
                </Pressable>
              </>
            ) : (
              <Text style={[styles.hudMiniLabel, { color: chrome.tabIconDefault }]}>Search</Text>
            )}
          </View>

          <View style={styles.hudLayersAnchor} collapsable={false}>
            <Pressable
              onPress={() => setLayersOpen((v) => !v)}
              style={[
                styles.hudLayersFab,
                {
                  backgroundColor: chrome.surface,
                  borderColor: layersOpen ? chrome.tint : chrome.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Layers"
              accessibilityState={{ expanded: layersOpen }}>
              <FontAwesome name="th-large" size={18} color={chrome.tabIconDefault} />
            </Pressable>

            {layersOpen ? (
              <View
                style={[
                  styles.layersDropdown,
                  { borderColor: chrome.border, backgroundColor: chrome.elevated },
                ]}
                accessibilityRole="menu">
                <Text style={[styles.layersTitle, { color: chrome.text }]}>Layers</Text>
                <View style={styles.layersRow}>
                  {(
                    [
                      ["osm_dark", "OSM Dark"],
                      ["osm", "OSM"],
                      ["topo", "Topo"],
                      ["satellite", "Sat"],
                      ["hybrid", "Hybrid"],
                    ] as const
                  ).map(([id, label]) => (
                    <Pressable
                      key={id}
                      accessibilityRole="menuitem"
                      onPress={() => {
                        setBaseLayer(id);
                        setLayersOpen(false);
                      }}
                      style={[
                        styles.layerChip,
                        {
                          borderColor: baseLayer === id ? chrome.tint : chrome.border,
                          backgroundColor: baseLayer === id ? chrome.panel : "transparent",
                        },
                      ]}>
                      <Text style={[styles.layerChipTx, { color: chrome.text }]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.layersHint, { color: chrome.tabIconDefault }]}>
                  Tip: keep Intel off unless you need OSINT overlays.
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {mgrsPickHandler ? (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            top: insets.top + 10,
            left: 12,
            right: 12,
            zIndex: 2000,
            padding: 12,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: chrome.border,
            backgroundColor: chrome.surface,
            gap: 10,
          }}>
          <Text style={{ color: chrome.text, fontWeight: "900", fontSize: 14 }}>Location pick (reports)</Text>
          <Text style={{ color: chrome.tabIconDefault, fontSize: 12, lineHeight: 17 }}>
            Align the map crosshair, confirm MGRS in the crosshair widget, then apply. Cancel returns without changing
            your form.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Pressable
              onPress={applyCrosshairMgrsToForm}
              style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: chrome.tint }}>
              <Text style={{ color: onTintLabel, fontWeight: "900" }}>Apply crosshair MGRS</Text>
            </Pressable>
            <Pressable
              onPress={cancelMgrsPick}
              style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, borderWidth: 2, borderColor: chrome.border }}>
              <Text style={{ color: chrome.text, fontWeight: "800" }}>Cancel pick</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {Platform.OS === "web" ? (
        <View
          pointerEvents="none"
          style={[
            styles.cursorMgrsHud,
            {
              backgroundColor: chrome.surface,
              borderColor: chrome.border,
              bottom: (dockToolsRight ? 16 : MIN_SHEET_H + 12) + insets.bottom,
            },
          ]}>
          <Text style={[styles.cursorMgrsLabel, { color: chrome.tabIconDefault }]}>Cursor MGRS</Text>
          <Text style={[styles.cursorMgrsVal, { color: chrome.text }]} numberOfLines={1}>
            {cursorMgrs}
          </Text>
          {measureHudDistance ? (
            <>
              <Text style={[styles.cursorMgrsLabel, { color: chrome.tabIconDefault, marginTop: 6 }]}>
                Measure ({gisMeasureReadoutMode})
              </Text>
              <Text style={[styles.cursorMgrsVal, { color: gisMeasureColor, fontWeight: "800" }]}>
                {measureHudDistance}
              </Text>
            </>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={chrome.tint} size="large" />
        </View>
      ) : null}
    </View>
  );

  const mapToolsInner = (
    <>
            <Text style={[styles.mapToolsIntro, { color: chrome.tabIconDefault }]}>
              Team pins & zones sync for everyone with the same unit key. Use Share live so others see your position
              (updates ~20s). Turn on Intel overlay to add Overpass / OSINT on top.
            </Text>
            {Platform.OS === "web" ? (
              <>
                <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>Tactical GIS (browser)</Text>
                <Text style={[styles.drawHint, { color: chrome.tabIconDefault }]}>
                  Modes live on the left map rail (Nav / Buf / Msr / Draw / MIL). Turf.js buffers, Geoman sketch, milsymbol
                  markers, live MGRS cursor — all client-side. Save encrypts the GeoJSON to this device only (IndexedDB).
                </Text>
                {activeMapTool === "measure" ? (
                  <>
                    <Text style={[styles.drawHint, { color: chrome.tabIconDefault }]}>
                      {measureA
                        ? "Move the cursor for a live line, then tap the second point."
                        : "Tap the map for the first point."}
                    </Text>
                    <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>Readout</Text>
                    <ChipStrip>
                      <Pressable
                        style={({ pressed }) => [
                          styles.chip,
                          {
                            borderWidth: gisMeasureReadoutMode === "metric" ? 2 : 1,
                            borderColor: gisMeasureReadoutMode === "metric" ? chrome.tint : chrome.tabIconDefault,
                            backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                          },
                        ]}
                        onPress={() => setGisMeasureReadoutMode("metric")}>
                        <Text style={[styles.chipLabel, { color: chrome.text }]}>Metric</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.chip,
                          {
                            borderWidth: gisMeasureReadoutMode === "imperial" ? 2 : 1,
                            borderColor: gisMeasureReadoutMode === "imperial" ? chrome.tint : chrome.tabIconDefault,
                            backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                          },
                        ]}
                        onPress={() => setGisMeasureReadoutMode("imperial")}>
                        <Text style={[styles.chipLabel, { color: chrome.text }]}>Imperial</Text>
                      </Pressable>
                    </ChipStrip>
                  </>
                ) : null}
                {activeMapTool === "mil_symbol" ? (
                  <>
                    <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>MIL affiliation</Text>
                    <ChipStrip>
                      {(
                        [
                          ["friendly", "Fr"],
                          ["hostile", "Ho"],
                          ["neutral", "Ne"],
                          ["unknown", "Un"],
                        ] as const
                      ).map(([id, label]) => (
                        <Pressable
                          key={id}
                          style={({ pressed }) => [
                            styles.chip,
                            {
                              borderWidth: milAffiliation === id ? 2 : 1,
                              borderColor: milAffiliation === id ? chrome.tint : chrome.tabIconDefault,
                              backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                            },
                          ]}
                          onPress={() => setMilAffiliation(id)}>
                          <Text style={[styles.chipLabel, { color: chrome.text }]}>{label}</Text>
                        </Pressable>
                      ))}
                    </ChipStrip>
                    <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>MIL type</Text>
                    <ChipStrip>
                      {(
                        [
                          ["infantry", "Inf"],
                          ["medical", "Med"],
                          ["supply", "Sply"],
                          ["unknown", "?"],
                        ] as const
                      ).map(([id, label]) => (
                        <Pressable
                          key={id}
                          style={({ pressed }) => [
                            styles.chip,
                            {
                              borderWidth: milUnit === id ? 2 : 1,
                              borderColor: milUnit === id ? chrome.tint : chrome.tabIconDefault,
                              backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                            },
                          ]}
                          onPress={() => setMilUnit(id)}>
                          <Text style={[styles.chipLabel, { color: chrome.text }]}>{label}</Text>
                        </Pressable>
                      ))}
                    </ChipStrip>
                  </>
                ) : null}
                <ChipStrip>
                  <Pressable
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        borderColor: chrome.accent,
                        backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                      },
                    ]}
                    onPress={() => void saveGisEncryptedLocal()}>
                    <Text style={[styles.chipLabel, { color: chrome.text }]}>Save GIS (encrypted)</Text>
                  </Pressable>
                </ChipStrip>
              </>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(app)/map-exports")}
              style={({ pressed }) => [
                styles.mapAuxLink,
                { borderColor: chrome.tint, opacity: pressed ? 0.88 : 1 },
              ]}>
              <Text style={[styles.mapAuxLinkTx, { color: chrome.tint }]}>
                Team GPX library — open in Gaia, Garmin, QGIS…
              </Text>
              <Text style={[styles.mapAuxLinkSub, { color: chrome.tabIconDefault }]}>
                Publish plaintext snapshots everyone can download
              </Text>
            </Pressable>
            <ChipStrip>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void useGpsCenter()}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>GPS drop</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => setShowIntel((v) => !v)}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>
                  Intel {showIntel ? "on" : "off"}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: shareTeamLocation ? 2 : 1,
                    borderColor: shareTeamLocation ? chrome.accent : chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => {
                  setShareTeamLocation((v) => {
                    const next = !v;
                    if (!next) void clearMyTeamPosition();
                    return next;
                  });
                }}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>
                  Share live {shareTeamLocation ? "on" : "off"}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: baseLayer === "satellite" ? 2 : 1,
                    borderColor: baseLayer === "satellite" ? chrome.accent : chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() =>
                  setBaseLayer((b) => (b === "satellite" ? "osm_dark" : "satellite"))
                }>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>
                  {baseLayer === "satellite" ? "Satellite" : "Basemap"}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: pointDropMode ? 2 : 1,
                    borderColor: pointDropMode ? chrome.tint : chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => {
                  if (pointDropMode) {
                    setPointDropMode(false);
                  } else {
                    setPathDraft([]);
                    setDrawTool("idle");
                    setActiveMapTool("navigate");
                    setMeasureA(null);
                    setPointDropMode(true);
                  }
                }}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>
                  Pin drop {pointDropMode ? "ON" : "off"}
                </Text>
              </Pressable>
            </ChipStrip>

            <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>Tactical map</Text>
            <Text style={[styles.drawHint, { color: chrome.tabIconDefault }]}>
              Long-press to drop a point. Pick a category — everyone sees who placed it. Route / zone: tap the map for
              corners, then Finish and categorize.
            </Text>
            <ChipStrip>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: drawTool === "idle" ? 2 : 1,
                    borderColor: drawTool === "idle" ? chrome.tint : chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => setDrawMode("idle")}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>Point</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: drawTool === "route" ? 2 : 1,
                    borderColor: drawTool === "route" ? chrome.tint : chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => setDrawMode("route")}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>Route</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: drawTool === "zone" ? 2 : 1,
                    borderColor: drawTool === "zone" ? chrome.tint : chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => setDrawMode("zone")}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>Zone</Text>
              </Pressable>
            </ChipStrip>
            {drawTool !== "idle" ? (
              <View style={styles.drawActions}>
                <Text style={[styles.vertexCount, { color: chrome.text }]}>
                  Vertices: {pathDraft.length}
                  {drawTool === "route" ? " · min 2" : " · min 3"}
                </Text>
                <View style={styles.drawBtnRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.drawSecondaryBtn,
                      {
                        borderColor: chrome.tabIconDefault,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                    onPress={() => setPathDraft((d) => d.slice(0, -1))}>
                    <Text style={[styles.drawSecondaryLabel, { color: chrome.text }]}>Undo</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.drawSecondaryBtn,
                      {
                        borderColor: chrome.tabIconDefault,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                    onPress={() => setPathDraft([])}>
                    <Text style={[styles.drawSecondaryLabel, { color: chrome.text }]}>Clear</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => {
                      const dis =
                        (drawTool === "route" && pathDraft.length < 2) ||
                        (drawTool === "zone" && pathDraft.length < 3);
                      return [
                        styles.drawFinishBtn,
                        {
                          backgroundColor: chrome.tint,
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

        {/* Place search moved into floating HUD */}

            <Pressable
              onPress={() => setIntelToolsOpen((v) => !v)}
              style={({ pressed }) => [
                styles.intelToolsToggle,
                {
                  borderColor: chrome.tint,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}>
              <Text style={[styles.intelToolsToggleText, { color: chrome.tint }]}>
                {intelToolsOpen ? "▼ Hide Overpass & OSINT" : "▶ Show Overpass & OSINT"}
              </Text>
            </Pressable>

            {intelToolsOpen ? (
              <>
                <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>Overpass quick (OSM)</Text>
                <ChipStrip>
                  <Pressable
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        borderColor: chrome.tabIconDefault,
                        backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                      },
                    ]}
                    onPress={() => void runIntel("water")}>
                    <Text style={[styles.chipLabel, { color: chrome.text }]}>Water</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        borderColor: chrome.tabIconDefault,
                        backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                      },
                    ]}
                    onPress={() => void runIntel("power")}>
                    <Text style={[styles.chipLabel, { color: chrome.text }]}>Power</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        borderColor: chrome.tabIconDefault,
                        backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                      },
                    ]}
                    onPress={() => void runIntel("emergency")}>
                    <Text style={[styles.chipLabel, { color: chrome.text }]}>Emergency</Text>
                  </Pressable>
                </ChipStrip>

            <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>Overpass · infrastructure presets</Text>
            <ChipStrip>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runC4isrIntel(OVERPASS_C4ISR_PRESETS.power_substations)}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>Substations</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runC4isrIntel(OVERPASS_C4ISR_PRESETS.medical)}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>Medical</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runC4isrIntel(OVERPASS_C4ISR_PRESETS.fuel)}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>Fuel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runC4isrIntel(OVERPASS_C4ISR_PRESETS.natural_water)}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>Waterfalls</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: chrome.tabIconDefault,
                    backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                  },
                ]}
                onPress={() => void runC4isrIntel(OVERPASS_C4ISR_PRESETS.comm_towers)}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>Comm towers</Text>
              </Pressable>
            </ChipStrip>

            <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>OSINT layers (SuperMap)</Text>
            <Text style={[styles.drawHint, { color: chrome.tabIconDefault }]}>
              Toggle sources, then load. Uses map centroid (first tactical pin or default Nevada). Power draws lines +
              substations; USGS and FIRMS are points.
            </Text>
            <ChipStrip>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: osintPower ? 2 : 1,
                    borderColor: osintPower ? chrome.accent : chrome.tabIconDefault,
                    backgroundColor: pressed ? chrome.panel : "transparent",
                  },
                ]}
                onPress={() => setOsintPower((v) => !v)}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>Grid · power</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: osintUsgs ? 2 : 1,
                    borderColor: osintUsgs ? chrome.danger : chrome.tabIconDefault,
                    backgroundColor: pressed ? chrome.panel : "transparent",
                  },
                ]}
                onPress={() => setOsintUsgs((v) => !v)}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>USGS EQ</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderWidth: osintFirms ? 2 : 1,
                    borderColor: osintFirms ? chrome.tabIconDefault : chrome.tabIconDefault,
                    backgroundColor: pressed ? chrome.panel : "transparent",
                  },
                ]}
                onPress={() => setOsintFirms((v) => !v)}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>NASA FIRMS</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: chrome.accent,
                    backgroundColor: pressed ? chrome.panel : chrome.elevated,
                  },
                ]}
                onPress={() => void refreshSupermapLayers()}>
                <Text style={[styles.chipLabel, { color: chrome.text }]}>Load OSINT</Text>
              </Pressable>
            </ChipStrip>

        <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>Overpass query</Text>
        <TextInput
          placeholder="Overpass QL — use __BBOX__ for bbox"
          placeholderTextColor="#888"
          value={customQl}
          onChangeText={setCustomQl}
          style={[
            styles.input,
            {
              color: chrome.text,
              borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
              backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
            },
          ]}
        />
        <Pressable
          style={({ pressed }) => [
            styles.runBtn,
            { backgroundColor: chrome.tint, opacity: pressed ? 0.9 : 1 },
          ]}
          onPress={() => void runCustomIntel()}>
          <Text style={[styles.runBtnLabel, { color: onTintLabel }]}>Run query</Text>
        </Pressable>
              </>
            ) : null}
    </>
  );

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: chrome.background },
        dockToolsRight && styles.screenDocked,
        Platform.OS === "web" ? { minHeight: "100%" as never } : null,
      ]}>
      <TacticalCategoryModal
        visible={!!categoryPick}
        title={categoryModalTitle}
        scheme={scheme === "dark" ? "dark" : "light"}
        onClose={() => setCategoryPick(null)}
        onSelect={(cat) => {
          if (categoryPick) void saveTacticalFeature(cat, categoryPick);
        }}
      />
      <Modal
        visible={Platform.OS === "web" && !!bufferModal}
        transparent
        animationType="fade"
        onRequestClose={() => setBufferModal(null)}>
        <View style={styles.bufferModalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setBufferModal(null)}
            accessibilityLabel="Dismiss buffer dialog"
          />
          <View
            style={[
              styles.bufferModalCard,
              { backgroundColor: chrome.surface, borderColor: chrome.border },
            ]}>
            <Text style={[styles.bufferModalTitle, { color: chrome.text }]}>Buffer radius</Text>
            <ChipStrip>
              {(
                [
                  ["km", "km"],
                  ["m", "m"],
                  ["mi", "mi"],
                  ["yd", "yd"],
                ] as const
              ).map(([u, label]) => (
                <Pressable
                  key={u}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      borderWidth: bufferUnit === u ? 2 : 1,
                      borderColor: bufferUnit === u ? chrome.tint : chrome.tabIconDefault,
                      backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                    },
                  ]}
                  onPress={() => {
                    if (u === bufferUnit) return;
                    setBufferRadiusTyping(false);
                    setBufferRadiusAmount((amt) => {
                      const conv = convertAmountBetweenUnits(amt, bufferUnit, u);
                      const { min, max } = BUFFER_RANGE[u];
                      return Math.max(min, Math.min(max, conv));
                    });
                    setBufferUnit(u);
                  }}>
                  <Text style={[styles.chipLabel, { color: chrome.text }]}>{label}</Text>
                </Pressable>
              ))}
            </ChipStrip>
            <Text style={[styles.drawHint, { color: chrome.tabIconDefault }]}>
              {bufferUnit === "km" && "Kilometers"}
              {bufferUnit === "m" && "Meters"}
              {bufferUnit === "mi" && "Miles"}
              {bufferUnit === "yd" && "Yards"}
              {`: ${bufferRadiusAmount.toFixed(bufferUnit === "mi" || bufferUnit === "km" ? 3 : 0)} · Range `}
              {BUFFER_RANGE[bufferUnit].min}–{BUFFER_RANGE[bufferUnit].max}{" "}
              {bufferUnit === "km" ? "km" : bufferUnit === "m" ? "m" : bufferUnit === "mi" ? "mi" : "yd"}
            </Text>
            <View style={styles.bufferSliderRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Decrease buffer radius"
                onPress={() => nudgeBufferRadius(-1)}
                style={({ pressed }) => [
                  styles.bufferStepperBtn,
                  {
                    borderColor: chrome.border,
                    backgroundColor: scheme === "dark" ? "#18181b" : "#f4f4f5",
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <Text style={{ color: chrome.text, fontSize: 20, fontWeight: "800", lineHeight: 22 }}>−</Text>
              </Pressable>
              <Slider
                key={`buffer-radius-${bufferUnit}`}
                style={styles.bufferSlider}
                minimumValue={BUFFER_RANGE[bufferUnit].min}
                maximumValue={BUFFER_RANGE[bufferUnit].max}
                step={BUFFER_RANGE[bufferUnit].step}
                value={bufferRadiusAmount}
                onValueChange={(v) => {
                  setBufferRadiusTyping(false);
                  setBufferRadiusAmount(v);
                }}
                minimumTrackTintColor={chrome.tint}
                maximumTrackTintColor={chrome.border}
                thumbTintColor={Platform.OS === "ios" ? undefined : chrome.tint}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Increase buffer radius"
                onPress={() => nudgeBufferRadius(1)}
                style={({ pressed }) => [
                  styles.bufferStepperBtn,
                  {
                    borderColor: chrome.border,
                    backgroundColor: scheme === "dark" ? "#18181b" : "#f4f4f5",
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <Text style={{ color: chrome.text, fontSize: 20, fontWeight: "800", lineHeight: 22 }}>+</Text>
              </Pressable>
            </View>
            <View style={styles.bufferRadiusFieldRow}>
              <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault, marginTop: 0, flexShrink: 0 }]}>
                Exact value
              </Text>
              <TextInput
                value={bufferRadiusText}
                onChangeText={setBufferRadiusText}
                onFocus={() => setBufferRadiusTyping(true)}
                onBlur={() => commitBufferRadiusField()}
                keyboardType="decimal-pad"
                style={[
                  styles.bufferRadiusInput,
                  {
                    color: chrome.text,
                    borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
                    backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
                  },
                ]}
                returnKeyType="done"
                onSubmitEditing={() => commitBufferRadiusField()}
              />
            </View>
            <Text style={[styles.fieldLabel, { color: chrome.tabIconDefault }]}>Buffer colors</Text>
            <ChipStrip>
              {GIS_COLOR_SWATCHES.map((c) => (
                <Pressable
                  key={`bf-${c}`}
                  onPress={() => {
                    setGisBufferStroke(c);
                    setGisBufferFill(c);
                  }}
                  accessibilityLabel={`Buffer color ${c}`}
                  style={[
                    styles.gisColorSwatchOuter,
                    {
                      borderColor: gisBufferStroke === c && gisBufferFill === c ? chrome.tint : chrome.border,
                      borderWidth: gisBufferStroke === c && gisBufferFill === c ? 2 : 1,
                    },
                  ]}>
                  <View style={[styles.gisColorSwatchInner, { backgroundColor: c }]} />
                </Pressable>
              ))}
            </ChipStrip>
            <View style={styles.bufferModalRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.bufferModalSecondary,
                  { borderColor: chrome.border, opacity: pressed ? 0.85 : 1 },
                ]}
                onPress={() => setBufferModal(null)}>
                <Text style={{ color: chrome.text, fontWeight: "700" }}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.bufferModalPrimary,
                  { backgroundColor: chrome.tint, opacity: pressed ? 0.9 : 1 },
                ]}
                onPress={applyBufferFromModal}>
                <Text style={{ color: onTintLabel, fontWeight: "800" }}>Apply</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {dockToolsRight ? (
        <>
          <View style={styles.mapCol}>
            {mapCoordReadout}
            <View style={styles.mapFill}>{mapNode}</View>
            {mapToolsDockCollapsed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show map tools sidebar"
                onPress={() => persistMapToolsDockCollapsed(false)}
                style={({ pressed }) => [
                  styles.mapDockExpandFab,
                  {
                    top: mapToolsExpandFabTop,
                    backgroundColor: chrome.surface,
                    borderColor: chrome.border,
                    opacity: pressed ? 0.92 : 1,
                    ...(Platform.OS === "web"
                      ? { boxShadow: "0 2px 14px rgba(0,0,0,0.2)" }
                      : { elevation: 6 }),
                  },
                ]}>
                <FontAwesome name="chevron-left" size={14} color={chrome.tint} />
                <Text style={[styles.mapDockExpandFabTx, { color: chrome.text }]}>Map tools</Text>
              </Pressable>
            ) : null}
          </View>
          {selectedGisFeature ? (
            <MapGisFeaturePanel
              feature={selectedGisFeature}
              chrome={chrome}
              variant="trailing"
              onDismiss={() => setSelectedGisFeature(null)}
              onCenterMap={(lat, lng) => flyToCoords(lat, lng, 14)}
              onAccentLabel={onTintLabel}
              movementMph={routeEtaMph}
              onMovementMphChange={setRouteEtaMph}
              onCommitFeature={commitGisFeature}
            />
          ) : selectedPin ? (
            <MapIntelPanel
              pin={selectedPin}
              payload={tacticalPayloadById[selectedPin.id] ?? null}
              chrome={chrome}
              variant="trailing"
              onDismiss={() => setSelectedPin(null)}
              onCenterMap={() => {
                flyToCoords(selectedPin.lat, selectedPin.lng, 14);
              }}
              onAccentLabel={onTintLabel}
              canEdit={
                !!profileId &&
                !!mapKey &&
                !!selectedPin.markerOwnerProfileId &&
                selectedPin.markerOwnerProfileId === profileId &&
                !!tacticalPayloadById[selectedPin.id]
              }
              onSaveIntel={
                profileId &&
                mapKey &&
                selectedPin.markerOwnerProfileId === profileId &&
                tacticalPayloadById[selectedPin.id]
                  ? async (n) => {
                      await saveIntelEdits(selectedPin.id, n);
                    }
                  : undefined
              }
              linkOptions={intelLinkOptions}
              onDeleteMyMarker={
                profileId &&
                selectedPin.markerOwnerProfileId &&
                selectedPin.markerOwnerProfileId === profileId
                  ? () => void deleteTacticalMarkerRow(selectedPin.id)
                  : undefined
              }
            />
          ) : null}
          {!mapToolsDockCollapsed ? (
            <View
              style={[
                styles.toolsDock,
                {
                  backgroundColor: chrome.background,
                  borderLeftColor: scheme === "dark" ? "#27272a" : "#e4e4e7",
                  paddingTop: insets.top > 0 ? 8 : 0,
                },
              ]}>
              <View
                style={[
                  styles.toolsDockHead,
                  { borderBottomColor: scheme === "dark" ? "#27272a" : "#e4e4e7" },
                ]}>
                <View style={styles.toolsDockHeadRow}>
                  <View style={styles.toolsDockHeadTitles}>
                    <Text style={[styles.panelTitle, { color: chrome.tabIconDefault }]}>Map tools</Text>
                    <Text style={[styles.toolsDockHint, { color: chrome.tabIconDefault }]}>
                      Desktop sidebar · turn off in Settings
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Hide map tools for fullscreen map"
                    onPress={() => persistMapToolsDockCollapsed(true)}
                    style={({ pressed }) => [
                      styles.toolsDockCollapseBtn,
                      {
                        borderColor: chrome.border,
                        backgroundColor: pressed ? chrome.panel : "transparent",
                      },
                    ]}>
                    <FontAwesome name="chevron-right" size={16} color={chrome.tint} />
                  </Pressable>
                </View>
              </View>
              <ScrollView
                style={[
                  styles.toolsDockScroll,
                  Platform.OS === "web" ? ({ touchAction: "pan-y" } as unknown as any) : null,
                ]}
                contentContainerStyle={[styles.sheetBodyContent, { paddingBottom: sheetPadBottom + 8 }]}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator>
                {mapToolsInner}
              </ScrollView>
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.mobileMapStack}>
          {mapCoordReadout}
          <View style={styles.mapFill}>{mapNode}</View>
          {selectedGisFeature ? (
            <MapGisFeaturePanel
              feature={selectedGisFeature}
              chrome={chrome}
              variant="bottom"
              onDismiss={() => setSelectedGisFeature(null)}
              onCenterMap={(lat, lng) => flyToCoords(lat, lng, 14)}
              onAccentLabel={onTintLabel}
              scrollPanY
              maxBottomPx={Math.round(windowH * 0.5)}
              movementMph={routeEtaMph}
              onMovementMphChange={setRouteEtaMph}
              onCommitFeature={commitGisFeature}
            />
          ) : selectedPin ? (
            <MapIntelPanel
              pin={selectedPin}
              payload={tacticalPayloadById[selectedPin.id] ?? null}
              chrome={chrome}
              variant="bottom"
              onDismiss={() => setSelectedPin(null)}
              onCenterMap={() => {
                flyToCoords(selectedPin.lat, selectedPin.lng, 14);
              }}
              onAccentLabel={onTintLabel}
              scrollPanY
              maxBottomPx={Math.round(windowH * 0.58)}
              canEdit={
                !!profileId &&
                !!mapKey &&
                !!selectedPin.markerOwnerProfileId &&
                selectedPin.markerOwnerProfileId === profileId &&
                !!tacticalPayloadById[selectedPin.id]
              }
              onSaveIntel={
                profileId &&
                mapKey &&
                selectedPin.markerOwnerProfileId === profileId &&
                tacticalPayloadById[selectedPin.id]
                  ? async (n) => {
                      await saveIntelEdits(selectedPin.id, n);
                    }
                  : undefined
              }
              linkOptions={intelLinkOptions}
              onDeleteMyMarker={
                profileId &&
                selectedPin.markerOwnerProfileId &&
                selectedPin.markerOwnerProfileId === profileId
                  ? () => void deleteTacticalMarkerRow(selectedPin.id)
                  : undefined
              }
            />
          ) : null}

          <View
            style={[
              styles.sheet,
              {
                height: sheetH,
                backgroundColor: chrome.background,
                borderTopColor: scheme === "dark" ? "#27272a" : "#e4e4e7",
                transform: [{ translateX: sheetOffsetX }],
                paddingBottom: Platform.OS === "web" ? insets.bottom : 0,
                maxHeight: windowH * 0.5,
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
              <Pressable
                style={styles.sheetTitleBtn}
                onPress={() => (sheetExpanded ? setSheetH(MIN_SHEET_H) : expandSheet())}>
                <Text style={[styles.panelTitle, { color: chrome.tabIconDefault }]}>Map tools</Text>
                <FontAwesome
                  name={sheetExpanded ? "chevron-down" : "chevron-up"}
                  size={12}
                  color={chrome.tabIconDefault}
                />
              </Pressable>
              <Text style={[styles.sheetDragHint, { color: chrome.tabIconDefault }]}>
                {compactToolChips ? "Swipe up · chips wrap on phone" : "Drag up · side"}
              </Text>
            </View>

            {sheetExpanded ? (
              <ScrollView
                style={[
                  styles.sheetBodyScroll,
                  Platform.OS === "web" ? ({ touchAction: "pan-y" } as unknown as any) : null,
                ]}
                contentContainerStyle={[styles.sheetBodyContent, { paddingBottom: sheetPadBottom }]}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}>
                {mapToolsInner}
              </ScrollView>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
  },
  screenDocked: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  /** Calcite-style column: map canvas + optional intel strip + anchored tools sheet. */
  mobileMapStack: {
    flex: 1,
    minHeight: 0,
    width: "100%" as const,
    flexDirection: "column",
  },
  mapCol: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    position: "relative",
    flexDirection: "column",
  },
  mapCoordRail: {
    flexShrink: 0,
    alignSelf: "stretch",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  mapDockExpandFab: {
    position: "absolute",
    right: 12,
    /** Below crosshair coord panel (1200) when stacks collide after drag. */
    zIndex: 1150,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mapDockExpandFabTx: {
    fontSize: 13,
    fontWeight: "800",
  },
  /** Map fills the column; bottom sheet overlays on mobile, sidebar sits beside on desktop dock. */
  mapFill: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
  toolsDock: {
    width: 372,
    maxWidth: "40%",
    flexShrink: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    ...(Platform.OS === "web"
      ? { boxShadow: "-4px 0 18px rgba(0,0,0,0.18)" }
      : { elevation: 10 }),
  },
  toolsDockHead: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  toolsDockHeadRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  toolsDockHeadTitles: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  toolsDockCollapseBtn: {
    marginTop: -2,
    padding: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolsDockHint: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.2,
    opacity: 0.65,
  },
  toolsDockScroll: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 14,
  },
  chipRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
    marginHorizontal: -2,
  },
  /** Web PWA: horizontal chip rail instead of a wrapping grid beside the map. */
  chipStripWebMobile: {
    flexGrow: 0,
    marginHorizontal: -14,
  },
  chipStripWebMobileInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    flexGrow: 0,
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  sheet: {
    flexShrink: 0,
    width: "100%" as const,
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
  mapToolsIntro: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  mapAuxLink: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  mapAuxLinkTx: { fontSize: 14, fontWeight: "800" },
  mapAuxLinkSub: { fontSize: 11, marginTop: 4, lineHeight: 15 },
  hudTop: {
    position: "absolute",
    left: 10,
    right: 10,
    top: 0,
    pointerEvents: "box-none",
  },
  hudTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    pointerEvents: "box-none",
  },
  hudSearchCard: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  hudLayersAnchor: {
    position: "relative",
    flexShrink: 0,
    zIndex: 1060,
  },
  hudLayersFab: {
    borderWidth: 1,
    borderRadius: 12,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  hudLayersBackdrop: {
    zIndex: 900,
    backgroundColor: "transparent",
  },
  hudIconBtn: { paddingHorizontal: 12, paddingVertical: 12 },
  hudInput: { flex: 1, paddingVertical: 10, paddingHorizontal: 10, fontSize: 14 },
  hudGoBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, marginRight: 10 },
  hudGoTx: { fontWeight: "900", fontSize: 13 },
  hudMiniLabel: { flex: 1, fontSize: 12, fontWeight: "800", paddingVertical: 12 },
  layersDropdown: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: 8,
    width: 268,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 14px 34px rgba(0,0,0,0.55)" } as const)
      : { elevation: 18 }),
  },
  layersTitle: { fontSize: 12, fontWeight: "900", marginBottom: 8, letterSpacing: 0.6, textTransform: "uppercase" },
  layersRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  layerChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  layerChipTx: { fontSize: 13, fontWeight: "800" },
  layersHint: { fontSize: 11, lineHeight: 15, marginTop: 10, opacity: 0.85 },

  crosshairWrap: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 44,
    height: 44,
    marginLeft: -22,
    marginTop: -22,
    alignItems: "center",
    justifyContent: "center",
  },
  crosshairDot: { width: 10, height: 10, borderRadius: 10, borderWidth: 2, backgroundColor: "rgba(0,0,0,0.25)" },
  crosshairLineH: { position: "absolute", height: 2, width: 44, opacity: 0.85 },
  crosshairLineV: { position: "absolute", width: 2, height: 44, opacity: 0.85 },

  coordBox: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: "hidden",
    ...(Platform.OS === "web" ? { boxShadow: "0 2px 10px rgba(0,0,0,0.2)" } : { elevation: 6 }),
  },
  /** Full-width readout above the Leaflet canvas (same chrome as `coordBox`, not absolutely positioned). */
  coordRail: {
    alignSelf: "stretch",
    width: "100%" as const,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: "hidden",
    ...(Platform.OS === "web" ? { boxShadow: "0 2px 10px rgba(0,0,0,0.14)" } : { elevation: 3 }),
  },
  coordInner: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  coordInnerExpanded: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  coordInnerMin: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  coordTextCol: { flex: 1, minWidth: 0, gap: 4 },
  coordEyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },
  coordVal: { fontSize: 14, fontWeight: "800", lineHeight: 18 },
  coordValMin: { fontSize: 12, fontWeight: "800", flex: 1, minWidth: 0 },
  coordActionsCol: { alignItems: "flex-end", gap: 10, paddingTop: 2 },
  coordActionsRow: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0 },
  coordActionLink: { fontSize: 12, fontWeight: "800" },
  intelToolsToggle: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 4,
    marginBottom: 8,
    alignItems: "center",
  },
  intelToolsToggleText: {
    fontSize: 14,
    fontWeight: "800",
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
  cursorMgrsHud: {
    position: "absolute",
    left: 10,
    zIndex: 600,
    maxWidth: "92%" as const,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cursorMgrsLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  cursorMgrsVal: {
    fontSize: 11,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  bufferModalBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 24,
  },
  bufferModalCard: {
    width: "100%" as const,
    maxWidth: 400,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
    zIndex: 2,
  },
  bufferModalTitle: {
    fontSize: 17,
    fontWeight: "800",
  },
  bufferModalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  bufferModalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
  },
  bufferModalSecondary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  bufferModalPrimary: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  bufferSliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  bufferSlider: {
    flex: 1,
    minWidth: 0,
    height: 40,
  },
  bufferStepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  bufferRadiusFieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  bufferRadiusInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: 16,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  mapToolRail: {
    position: "absolute",
    left: 10,
    zIndex: 1040,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 6,
    gap: 4,
  },
  mapToolRailBtn: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 52,
  },
  mapToolRailLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  gisColorSwatchOuter: {
    padding: 2,
    borderRadius: 6,
  },
  gisColorSwatchInner: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
});
