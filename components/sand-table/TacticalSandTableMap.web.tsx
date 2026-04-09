/**
 * Isolated Leaflet “sandbox” for the Sand Table: separate map instance from the global tactical map.
 * Web-only (Expo .web). Tiles use crossOrigin for safer DOM-to-image export.
 */
import type { Feature, FeatureCollection } from "geojson";
import * as turf from "@turf/turf";
import type { Layer, LeafletMouseEvent, Map as LeafletMap, Polyline } from "leaflet";
import L from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import {
  generateTacticalSymbolSvg,
  milSymbolIconSize,
  tacticalChoicesToSIDC,
  type TacticalAffiliation,
  type TacticalUnitType,
} from "@/lib/gis/milSym";

import domtoimage from "dom-to-image-more";

function useLeafletCss() {
  useEffect(() => {
    const cssId = "mm-leaflet-css";
    if (typeof document !== "undefined" && !document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const base = "https://unpkg.com/leaflet@1.9.4/dist/images/";
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: `${base}marker-icon-2x.png`,
      iconUrl: `${base}marker-icon.png`,
      shadowUrl: `${base}marker-shadow.png`,
    });
  }, []);
}

function ensureGeomanCssLink() {
  if (typeof document === "undefined") return;
  const id = "mm-geoman-css";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/@geoman-io/leaflet-geoman-free@2.19.2/dist/leaflet-geoman.css";
  document.head.appendChild(link);
}

let leafletGeomanLoaded = false;
function loadLeafletGeomanOnce() {
  if (leafletGeomanLoaded) return;
  const g = globalThis as typeof globalThis & { L?: typeof L };
  g.L = L;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@geoman-io/leaflet-geoman-free");
  leafletGeomanLoaded = true;
}

type GeomanPmControls = {
  addControls: (o: Record<string, unknown>) => void;
  removeControls: () => void;
};

function ensureMapPm(map: LeafletMap): GeomanPmControls | undefined {
  loadLeafletGeomanOnce();
  const PM = L as unknown as { PM?: { Map: new (mp: LeafletMap) => GeomanPmControls } };
  if (!PM.PM?.Map) return undefined;
  const m = map as LeafletMap & { pm?: GeomanPmControls };
  if (!m.pm) m.pm = new PM.PM.Map(map);
  return m.pm;
}

function sandboxOsmTileLayer() {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    crossOrigin: true,
  });
}

function sandboxDarkTileLayer() {
  return L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    attribution: '&copy; OSM · © CARTO',
    crossOrigin: true,
  });
}

function flattenLineLatLngs(raw: L.LatLng[] | L.LatLng[][]): L.LatLng[] {
  if (!raw.length) return [];
  const a0 = raw[0] as L.LatLng | L.LatLng[];
  if (Array.isArray(a0)) {
    return (raw as L.LatLng[][]).flat();
  }
  return raw as L.LatLng[];
}

function polylineLengthKm(latlngs: L.LatLng[]): number | null {
  if (latlngs.length < 2) return null;
  const coords = latlngs.map((p) => [p.lng, p.lat] as [number, number]);
  try {
    const ls = turf.lineString(coords);
    return turf.length(ls, { units: "kilometers" });
  } catch {
    return null;
  }
}

export type TacticalSandTableMapProps = {
  scheme: "light" | "dark";
  onApprove: (fc: FeatureCollection, pngDataUrl: string) => void;
};

type ToolMode = "draw" | "symbol" | "text";
type BaseLayer = "osm" | "dark";

type LeafletMapWithPm = LeafletMap & {
  pm: {
    getGeomanLayers: (asFeatureGroup?: boolean) => L.FeatureGroup;
    disableDraw?: () => void;
  };
};

function asPmMap(map: LeafletMap): LeafletMapWithPm {
  return map as unknown as LeafletMapWithPm;
}

export function TacticalSandTableMap({ scheme, onApprove }: TacticalSandTableMapProps) {
  useLeafletCss();
  const p = Colors[scheme];
  const { width } = useWindowDimensions();
  const panelW = width >= 900 ? 320 : 280;

  const hostRef = useRef<View>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const manualGroupRef = useRef<L.FeatureGroup | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const selectedRef = useRef<Layer | null>(null);
  const [, forceSel] = useState(0);
  const bumpSel = () => forceSel((x) => x + 1);

  const [toolMode, setToolMode] = useState<ToolMode>("draw");
  const toolModeRef = useRef(toolMode);
  toolModeRef.current = toolMode;

  const [baseLayer, setBaseLayer] = useState<BaseLayer>("osm");

  const [affiliation, setAffiliation] = useState<TacticalAffiliation>("friendly");
  const [unitType, setUnitType] = useState<TacticalUnitType>("infantry");
  const affRef = useRef(affiliation);
  const unitRef = useRef(unitType);
  affRef.current = affiliation;
  unitRef.current = unitType;
  const [liveRouteKm, setLiveRouteKm] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const selectLayer = useCallback((layer: Layer) => {
    selectedRef.current = layer;
    bumpSel();
  }, []);

  useEffect(() => {
    const el = hostRef.current as unknown as HTMLElement | null;
    if (!el || typeof window === "undefined") return;

    ensureGeomanCssLink();
    loadLeafletGeomanOnce();

    const map = L.map(el, { zoomControl: true }).setView([39.5, -120.2], 7);
    mapRef.current = map;
    const osm = sandboxOsmTileLayer();
    osm.addTo(map);
    tileRef.current = osm;

    const manual = L.featureGroup().addTo(map);
    manualGroupRef.current = manual;

    const pm = ensureMapPm(map);
    pm?.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: true,
      drawRectangle: true,
      drawPolygon: true,
      drawCircle: true,
      removalMode: true,
      editMode: true,
      dragMode: false,
      cutPolygon: false,
      rotateMode: false,
    });

    const onDrawStart = (e: unknown) => {
      const working = (e as { workingLayer?: Polyline }).workingLayer;
      if (!working || typeof (working as Polyline).getLatLngs !== "function") return;
      const refresh = () => {
        const llRaw = (working as Polyline).getLatLngs() as L.LatLng[] | L.LatLng[][];
        const flat = flattenLineLatLngs(llRaw);
        const km = polylineLengthKm(flat);
        setLiveRouteKm(km);
      };
      working.on("pm:vertexadded", refresh);
      working.on("pm:vertexremoved", refresh);
      refresh();
    };

    const onDrawEnd = () => setLiveRouteKm(null);

    map.on("pm:drawstart", onDrawStart as L.LeafletEventHandlerFn);
    map.on("pm:drawend", onDrawEnd);
    map.on("pm:globaleditmodetoggled", () => {
      /* selection UX handled by pm:click */
    });

    const onPmClick = ((e: unknown) => {
      const layer = (e as { layer?: Layer }).layer;
      if (layer) selectLayer(layer);
    }) as L.LeafletEventHandlerFn;
    map.on("pm:click", onPmClick);

    const onMapClick = (ev: LeafletMouseEvent) => {
      const mode = toolModeRef.current;
      if (mode === "draw") return;
      if (mode === "symbol") {
        const sidc = tacticalChoicesToSIDC(affRef.current, unitRef.current);
        const svg = generateTacticalSymbolSvg({ sidc, size: 40 });
        const { w, h, ax, ay } = milSymbolIconSize(sidc, 40);
        const icon = L.divIcon({
          className: "mm-sand-mil",
          html: `<div style="width:${w}px;height:${h}px;line-height:0">${svg}</div>`,
          iconSize: [w, h],
          iconAnchor: [ax, ay],
        });
        const m = L.marker(ev.latlng, { icon, draggable: true });
        (m as unknown as { feature?: Feature }).feature = {
          type: "Feature",
          properties: { mmKind: "milsymbol", affiliation: affRef.current, unitType: unitRef.current, sidc },
          geometry: { type: "Point", coordinates: [ev.latlng.lng, ev.latlng.lat] },
        };
        m.on("click", (clickEv) => {
          L.DomEvent.stopPropagation(clickEv);
          selectLayer(m);
        });
        manual.addLayer(m);
        return;
      }
      if (mode === "text") {
        const wrap = document.createElement("div");
        wrap.style.cssText =
          "min-width:140px;background:rgba(15,23,42,.88);border:1px solid rgba(148,163,184,.6);border-radius:8px;padding:6px;";
        const input = document.createElement("input");
        input.setAttribute("type", "text");
        input.setAttribute("placeholder", "Label…");
        input.style.cssText =
          "width:100%;font-size:13px;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;";
        wrap.appendChild(input);
        const icon = L.divIcon({ html: wrap, className: "mm-sand-text", iconSize: [160, 38], iconAnchor: [80, 19] });
        const m = L.marker(ev.latlng, { icon, draggable: true });
        m.on("click", (clickEv) => {
          L.DomEvent.stopPropagation(clickEv);
          selectLayer(m);
        });
        manual.addLayer(m);
        requestAnimationFrame(() => input.focus());
        const finalize = () => {
          const raw = input.value.trim() || "TEXT";
          const label = document.createElement("div");
          label.textContent = raw;
          label.style.cssText =
            "font-size:12px;font-weight:800;letter-spacing:.02em;color:#fef3c7;text-shadow:0 1px 3px rgba(0,0,0,.85);padding:4px 8px;border-radius:8px;background:rgba(15,23,42,.78);border:1px solid rgba(251,191,36,.45);max-width:220px;white-space:pre-wrap;";
          const divIcon = L.divIcon({
            html: label,
            className: "mm-sand-text-fixed",
            iconSize: [Math.min(220, Math.max(44, raw.length * 7)), 28],
            iconAnchor: [Math.min(220, Math.max(44, raw.length * 7)) / 2, 14],
          });
          m.setIcon(divIcon);
          (m as unknown as { feature?: Feature }).feature = {
            type: "Feature",
            properties: { mmKind: "text", label: raw },
            geometry: { type: "Point", coordinates: [ev.latlng.lng, ev.latlng.lat] },
          };
        };
        input.addEventListener("keydown", (kev) => {
          if (kev.key === "Enter") {
            kev.preventDefault();
            finalize();
          }
        });
        input.addEventListener("blur", finalize, { once: true });
      }
    };
    map.on("click", onMapClick);

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            map.invalidateSize();
          })
        : null;
    ro?.observe(el);
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      ro?.disconnect();
      map.off("pm:drawstart", onDrawStart as L.LeafletEventHandlerFn);
      map.off("pm:drawend", onDrawEnd);
      map.off("pm:click", onPmClick);
      map.off("click", onMapClick);
      pm?.removeControls();
      map.remove();
      mapRef.current = null;
      manualGroupRef.current = null;
      tileRef.current = null;
      selectedRef.current = null;
    };
  }, [selectLayer]);

  useEffect(() => {
    const map = mapRef.current;
    const cur = tileRef.current;
    if (!map || !cur) return;
    map.removeLayer(cur);
    const next = baseLayer === "dark" ? sandboxDarkTileLayer() : sandboxOsmTileLayer();
    next.addTo(map);
    tileRef.current = next;
  }, [baseLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (toolMode !== "draw") {
      try {
        asPmMap(map).pm.disableDraw?.();
      } catch {
        /* ignore */
      }
    }
  }, [toolMode]);

  const applyStroke = (color: string, dashArray?: string) => {
    const layer = selectedRef.current;
    if (!layer || !("setStyle" in layer)) {
      Alert.alert("Sand Table", "Select a line, zone, or circle first.");
      return;
    }
    (layer as L.Path).setStyle({ color, weight: 4, dashArray });
    bumpSel();
  };

  const deleteSelected = () => {
    const layer = selectedRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    try {
      map.removeLayer(layer);
    } catch {
      /* ignore */
    }
    selectedRef.current = null;
    bumpSel();
  };

  const runExport = async () => {
    const map = mapRef.current;
    const manual = manualGroupRef.current;
    if (!map || !manual) return;
    setExporting(true);
    try {
      const pmFc = asPmMap(map).pm.getGeomanLayers(true).toGeoJSON() as FeatureCollection;
      const manualFc = manual.toGeoJSON() as FeatureCollection;
      const merged: FeatureCollection = {
        type: "FeatureCollection",
        features: [...(pmFc.features ?? []), ...(manualFc.features ?? [])],
      };
      const node = map.getContainer();
      const dataUrl = await domtoimage.toPng(node, { cacheBust: true });
      onApprove(merged, dataUrl);
    } catch (e) {
      console.error(e);
      Alert.alert(
        "Export failed",
        e instanceof Error
          ? `${e.message}\n\nIf tiles tainted the canvas, confirm the basemap uses crossOrigin and try again.`
          : "Could not export map image.",
      );
    } finally {
      setExporting(false);
    }
  };

  const unitChoices: { id: TacticalUnitType; label: string }[] = [
    { id: "infantry", label: "Infantry" },
    { id: "vehicle", label: "Vehicle" },
    { id: "medical", label: "Medical" },
    { id: "supply", label: "Logistics" },
    { id: "cache", label: "Cache" },
    { id: "unknown", label: "Unknown" },
  ];

  const affChoices: { id: TacticalAffiliation; label: string }[] = [
    { id: "friendly", label: "Friendly" },
    { id: "hostile", label: "Hostile" },
    { id: "neutral", label: "Neutral" },
    { id: "unknown", label: "Unknown" },
  ];

  return (
    <View style={styles.row}>
      <View style={styles.mapCol}>
        <View ref={hostRef} style={styles.mapHost} collapsable={false} />
        {liveRouteKm != null ? (
          <View style={styles.metricBox} pointerEvents="none">
            <Text style={styles.metricTitle}>Route length</Text>
            <Text style={styles.metricVal}>{liveRouteKm.toFixed(2)} km</Text>
          </View>
        ) : null}
      </View>
      <ScrollView style={[styles.panel, { width: panelW, borderLeftColor: p.tabIconDefault, backgroundColor: scheme === "dark" ? "#0b1220" : TacticalPalette.elevated }]}>
        <Text style={[styles.panelKicker, { color: TacticalPalette.accent }]}>EDITOR</Text>
        <Text style={[styles.panelHead, { color: p.text }]}>Vectors & symbols</Text>
        <Text style={[styles.panelHint, { color: p.tabIconDefault }]}>
          This map is isolated from the global tactical map. Draw routes and zones with the Leaflet toolbar, then use symbol/text tools here.
        </Text>

        <Text style={[styles.section, { color: p.tabIconDefault }]}>Basemap</Text>
        <View style={styles.chipRow}>
          {(
            [
              ["osm", "OSM"],
              ["dark", "Night"],
            ] as const
          ).map(([id, label]) => {
            const on = baseLayer === id;
            return (
              <Pressable
                key={id}
                onPress={() => setBaseLayer(id)}
                style={[
                  styles.chip,
                  { borderColor: on ? TacticalPalette.accent : p.tabIconDefault },
                  on && { backgroundColor: `${TacticalPalette.accent}22` },
                ]}>
                <Text style={{ color: p.text, fontWeight: on ? "900" : "600", fontSize: 12 }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.section, { color: p.tabIconDefault }]}>Placement mode</Text>
        <View style={styles.chipRow}>
          {(
            [
              ["draw", "Draw"],
              ["symbol", "Symbol"],
              ["text", "Text"],
            ] as const
          ).map(([id, label]) => {
            const on = toolMode === id;
            return (
              <Pressable
                key={id}
                onPress={() => setToolMode(id)}
                style={[
                  styles.chip,
                  { borderColor: on ? p.tint : p.tabIconDefault },
                  on && { backgroundColor: `${p.tint}18` },
                ]}>
                <Text style={{ color: p.text, fontWeight: on ? "900" : "600", fontSize: 12 }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {toolMode === "symbol" ? (
          <>
            <Text style={[styles.section, { color: p.tabIconDefault }]}>Affiliation</Text>
            <View style={styles.chipRow}>
              {affChoices.map((c) => {
                const on = affiliation === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setAffiliation(c.id)}
                    style={[
                      styles.chip,
                      { borderColor: on ? p.tint : p.tabIconDefault },
                      on && { backgroundColor: `${p.tint}14` },
                    ]}>
                    <Text style={{ color: p.text, fontWeight: on ? "900" : "600", fontSize: 11 }}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.section, { color: p.tabIconDefault }]}>Unit type</Text>
            <View style={styles.chipWrap}>
              {unitChoices.map((c) => {
                const on = unitType === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setUnitType(c.id)}
                    style={[
                      styles.chip,
                      { borderColor: on ? p.tint : p.tabIconDefault },
                      on && { backgroundColor: `${p.tint}14` },
                    ]}>
                    <Text style={{ color: p.text, fontWeight: on ? "900" : "600", fontSize: 11 }}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.panelHint, { color: p.tabIconDefault }]}>
              Tap the map to drop the current symbol. Drag to fine-tune.
            </Text>
          </>
        ) : null}

        {toolMode === "text" ? (
          <Text style={[styles.panelHint, { color: p.tabIconDefault }]}>
            Tap the map to place a label. Press Enter or blur the field to lock text to the map.
          </Text>
        ) : null}

        <Text style={[styles.section, { color: p.tabIconDefault }]}>Selected graphic</Text>
        <View style={styles.chipRow}>
          <Pressable onPress={() => applyStroke("#6b8e5c")} style={[styles.colorDot, { backgroundColor: "#6b8e5c" }]} />
          <Pressable onPress={() => applyStroke("#dc2626")} style={[styles.colorDot, { backgroundColor: "#dc2626" }]} />
          <Pressable onPress={() => applyStroke("#f97316")} style={[styles.colorDot, { backgroundColor: "#f97316" }]} />
        </View>
        <View style={styles.chipRow}>
          <Pressable onPress={() => applyStroke("#3b82f6", undefined)} style={styles.miniBtn}>
            <Text style={styles.miniBtnTx}>Solid</Text>
          </Pressable>
          <Pressable onPress={() => applyStroke("#eab308", "8 6")} style={styles.miniBtn}>
            <Text style={styles.miniBtnTx}>Planned</Text>
          </Pressable>
          <Pressable onPress={() => applyStroke("#94a3b8", "2 6")} style={styles.miniBtn}>
            <Text style={styles.miniBtnTx}>Dotted</Text>
          </Pressable>
        </View>
        <Pressable onPress={deleteSelected} style={styles.dangerBtn}>
          <Text style={styles.dangerTx}>Delete selected</Text>
        </Pressable>

        <Pressable
          disabled={exporting}
          onPress={() => void runExport()}
          style={[styles.approveBtn, { opacity: exporting ? 0.6 : 1, backgroundColor: TacticalPalette.accent }]}>
          <Text style={styles.approveTx}>{exporting ? "Exporting…" : "Approve & export plan"}</Text>
        </Pressable>
        <Text style={[styles.footerHint, { color: p.tabIconDefault }]}>
          Exports GeoJSON plus PNG of this isolated view only. Tiles use crossOrigin to reduce canvas tainting.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minHeight: 0 },
  mapCol: { flex: 1, minWidth: 0, position: "relative" as const },
  mapHost: { flex: 1, width: "100%", height: "100%" },
  metricBox: {
    position: "absolute" as const,
    top: 12,
    left: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(15,23,42,0.82)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(148,163,184,0.5)",
  },
  metricTitle: { color: "#cbd5e1", fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  metricVal: { color: "#f8fafc", fontSize: 18, fontWeight: "900", marginTop: 4 },
  panel: { maxWidth: 360, borderLeftWidth: StyleSheet.hairlineWidth, padding: 14, paddingBottom: 32 },
  panelKicker: { fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  panelHead: { fontSize: 18, fontWeight: "900", marginTop: 6, marginBottom: 8 },
  panelHint: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  section: { fontSize: 11, fontWeight: "800", marginTop: 12, marginBottom: 6, letterSpacing: 0.4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 2 },
  colorDot: { width: 34, height: 34, borderRadius: 10, borderWidth: 2, borderColor: "#0f172a" },
  miniBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: "#1e293b" },
  miniBtnTx: { color: "#e2e8f0", fontWeight: "800", fontSize: 11 },
  dangerBtn: { alignSelf: "flex-start", marginTop: 10, paddingVertical: 10, paddingHorizontal: 12 },
  dangerTx: { color: "#fecaca", fontWeight: "900", fontSize: 13 },
  approveBtn: { marginTop: 18, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  approveTx: { color: "#0b1220", fontWeight: "900", fontSize: 14 },
  footerHint: { fontSize: 11, lineHeight: 16, marginTop: 10 },
});
