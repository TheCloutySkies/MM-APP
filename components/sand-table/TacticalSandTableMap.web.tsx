/**
 * Isolated Leaflet “sandbox” for the Sand Table: separate map instance from the global tactical map.
 * Web-only (Expo .web). Tiles use crossOrigin for safer DOM-to-image export.
 */
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection } from "geojson";
import type { Layer, Map as LeafletMap, LeafletMouseEvent, Polyline } from "leaflet";
import * as L from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    Alert,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from "react-native";

import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { lngLatToMgrs } from "@/lib/geo/mgrsFormat";
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

type ToolMode = "draw" | "symbol" | "text" | "measure";
type BaseLayer = "osm" | "dark";

type MapWithPmHack = LeafletMap & {
  pm?: {
    disableGlobalEditMode?: () => void;
    disableGlobalRemovalMode?: () => void;
    disableGlobalDragMode?: () => void;
    disableGlobalCutMode?: () => void;
    disableGlobalRotateMode?: () => void;
    enableGlobalEditMode?: () => void;
    disableDraw?: () => void;
  };
};

function geomanStepAwayFromMapTools(m: MapWithPmHack) {
  const pm = m.pm;
  if (!pm) return;
  try {
    pm.disableGlobalEditMode?.();
    pm.disableGlobalRemovalMode?.();
    pm.disableGlobalDragMode?.();
    pm.disableGlobalCutMode?.();
    pm.disableGlobalRotateMode?.();
  } catch {
    /* ignore */
  }
}

function gridStepDegrees(zoom: number): number {
  if (zoom <= 6) return 2;
  if (zoom <= 7) return 1;
  if (zoom <= 8) return 0.5;
  if (zoom <= 9) return 0.25;
  if (zoom <= 10) return 0.1;
  if (zoom <= 11) return 0.05;
  if (zoom <= 12) return 0.02;
  if (zoom <= 14) return 0.01;
  if (zoom <= 16) return 0.005;
  return 0.002;
}

function redrawMgrsOverlay(map: LeafletMap, group: L.LayerGroup, show: boolean) {
  group.clearLayers();
  if (!show) return;
  const b = map.getBounds();
  const z = map.getZoom();
  const step = gridStepDegrees(z);
  const west = b.getWest();
  const south = b.getSouth();
  const east = b.getEast();
  const north = b.getNorth();
  const lineStyle: L.PolylineOptions = {
    weight: 1,
    opacity: 0.5,
    color: "#94a3b8",
    interactive: false,
  };
  const lat0 = Math.floor(south / step) * step;
  const lng0 = Math.floor(west / step) * step;
  for (let lat = lat0; lat <= north + 1e-9; lat += step) {
    if (lat < -85 || lat > 85) continue;
    L.polyline(
      [
        [lat, west],
        [lat, east],
      ],
      lineStyle,
    ).addTo(group);
  }
  for (let lng = lng0; lng <= east + 1e-9; lng += step) {
    L.polyline(
      [
        [south, lng],
        [north, lng],
      ],
      lineStyle,
    ).addTo(group);
  }
  let labelCount = 0;
  const maxLabels = 42;
  let i = 0;
  for (let lat = lat0; lat <= north + 1e-9; lat += step, i++) {
    let j = 0;
    for (let lng = lng0; lng <= east + 1e-9; lng += step, j++) {
      if (i % 2 !== 0 || j % 2 !== 0) continue;
      if (labelCount >= maxLabels) return;
      const mgrs = lngLatToMgrs(lat, lng, 4);
      if (!mgrs) continue;
      labelCount++;
      const icon = L.divIcon({
        className: "mm-sand-mgrs-lbl",
        html: `<div style="font-size:9px;font-weight:900;color:rgba(241,245,249,.95);text-shadow:0 0 4px #020617;padding:1px 3px;white-space:nowrap">${mgrs}</div>`,
        iconSize: [1, 1],
        iconAnchor: [0, 0],
      });
      L.marker([lat, lng], { icon, interactive: false, pane: "overlayPane" }).addTo(group);
    }
  }
}

type LeafletMapWithPm = LeafletMap & {
  pm: {
    getGeomanLayers: (asFeatureGroup?: boolean) => L.FeatureGroup;
    disableDraw?: () => void;
  };
};

function asPmMap(map: LeafletMap): LeafletMapWithPm {
  return map as unknown as LeafletMapWithPm;
}

function isPathLikeLayer(layer: Layer | null): layer is L.Path {
  return Boolean(layer && typeof (layer as L.Path).setStyle === "function");
}

export function TacticalSandTableMap({ scheme, onApprove }: TacticalSandTableMapProps) {
  useLeafletCss();
  const p = Colors[scheme];
  const { width, height } = useWindowDimensions();
  const panelW = width >= 900 ? 320 : 280;
  /** Phone / narrow browser: stack map + collapsible tools so the map keeps most of the viewport. */
  const compact = width < 760;

  const hostRef = useRef<View>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const manualGroupRef = useRef<L.FeatureGroup | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const selectedRef = useRef<Layer | null>(null);
  const [selTick, setSelTick] = useState(0);
  const bumpSel = () => setSelTick((x) => x + 1);

  const mgrsGroupRef = useRef<L.LayerGroup | null>(null);
  const measureGroupRef = useRef<L.LayerGroup | null>(null);
  const measurePtsRef = useRef<L.LatLng[]>([]);
  const measureLineRef = useRef<L.Polyline | null>(null);
  const showMgrsGridRef = useRef(true);
  const symbolSizeRef = useRef(40);

  const [showMgrsGrid, setShowMgrsGrid] = useState(true);
  const [styleEditorOpen, setStyleEditorOpen] = useState(false);
  const [measureKm, setMeasureKm] = useState<number | null>(null);
  const [selTitle, setSelTitle] = useState("");
  const [selNotes, setSelNotes] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [symbolSize, setSymbolSize] = useState(40);
  const [circleRadiusM, setCircleRadiusM] = useState("500");

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
  const [editorOpen, setEditorOpen] = useState(() => width >= 760);

  const selectLayer = useCallback((layer: Layer) => {
    selectedRef.current = layer;
    bumpSel();
  }, []);

  useEffect(() => {
    showMgrsGridRef.current = showMgrsGrid;
    const group = mgrsGroupRef.current;
    const map = mapRef.current;
    if (map && group) redrawMgrsOverlay(map, group, showMgrsGrid);
  }, [showMgrsGrid]);

  useEffect(() => {
    symbolSizeRef.current = symbolSize;
  }, [symbolSize]);

  useEffect(() => {
    const layer = selectedRef.current;
    if (!layer) {
      setSelTitle("");
      setSelNotes("");
      setTextDraft("");
      return;
    }
    const feat = (layer as unknown as { feature?: Feature }).feature;
    const p = (feat?.properties ?? {}) as Record<string, unknown>;
    setSelTitle(typeof p.title === "string" ? p.title : "");
    setSelNotes(
      typeof p.notes === "string" ? p.notes : typeof p.details === "string" ? (p.details as string) : "",
    );
    if (p.mmKind === "text" && typeof p.label === "string") setTextDraft(p.label);
    else setTextDraft("");
  }, [selTick]);

  useEffect(() => {
    if (width >= 760) setEditorOpen(true);
  }, [width]);

  useEffect(() => {
    if (!styleEditorOpen) return;
    if (!isPathLikeLayer(selectedRef.current)) setStyleEditorOpen(false);
  }, [selTick, styleEditorOpen]);

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

    const mgrsG = L.layerGroup().addTo(map);
    mgrsGroupRef.current = mgrsG;
    const measG = L.layerGroup().addTo(map);
    measureGroupRef.current = measG;
    /** Manual markers/symbols last so they paint above grid + measure overlays. */
    const manual = L.featureGroup().addTo(map);
    manualGroupRef.current = manual;

    const refreshGrid = () => redrawMgrsOverlay(map, mgrsG, showMgrsGridRef.current);
    refreshGrid();
    map.on("moveend", refreshGrid);
    map.on("zoomend", refreshGrid);

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

    const onPmGuard = () => {
      if (toolModeRef.current !== "draw") geomanStepAwayFromMapTools(map as MapWithPmHack);
    };
    map.on("pm:globaleditmodetoggled", onPmGuard);
    map.on("pm:globalremovalmodetoggled", onPmGuard);

    const onPmCreate = ((e: unknown) => {
      const layer = (e as { layer?: Layer }).layer;
      if (!layer) return;
      selectLayer(layer);
      setStyleEditorOpen(true);
    }) as L.LeafletEventHandlerFn;
    map.on("pm:create", onPmCreate);

    const onMapClick = (ev: LeafletMouseEvent) => {
      const mode = toolModeRef.current;
      if (mode === "draw") return;
      if (mode === "measure") {
        const g = measureGroupRef.current;
        if (!g) return;
        measurePtsRef.current = [...measurePtsRef.current, ev.latlng];
        if (measureLineRef.current) {
          try {
            g.removeLayer(measureLineRef.current);
          } catch {
            /* ignore */
          }
          measureLineRef.current = null;
        }
        const pts = measurePtsRef.current;
        if (pts.length >= 2) {
          const line = L.polyline(pts, {
            color: "#f59e0b",
            weight: 3,
            dashArray: "6 5",
            interactive: false,
          }).addTo(g);
          measureLineRef.current = line;
          setMeasureKm(polylineLengthKm(flattenLineLatLngs(pts)));
        } else {
          setMeasureKm(null);
        }
        return;
      }
      if (mode === "symbol") {
        const sz = Math.max(24, Math.min(96, symbolSizeRef.current));
        const sidc = tacticalChoicesToSIDC(affRef.current, unitRef.current);
        const svg = generateTacticalSymbolSvg({ sidc, size: sz });
        const { w, h, ax, ay } = milSymbolIconSize(sidc, sz);
        const icon = L.divIcon({
          className: "mm-sand-mil",
          html: `<div style="width:${w}px;height:${h}px;line-height:0">${svg}</div>`,
          iconSize: [w, h],
          iconAnchor: [ax, ay],
        });
        const m = L.marker(ev.latlng, { icon, draggable: true });
        (m as unknown as { feature?: Feature }).feature = {
          type: "Feature",
          properties: {
            mmKind: "milsymbol",
            affiliation: affRef.current,
            unitType: unitRef.current,
            sidc,
            symbolSizePx: sz,
          },
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
      map.off("moveend", refreshGrid);
      map.off("zoomend", refreshGrid);
      map.off("pm:globaleditmodetoggled", onPmGuard);
      map.off("pm:globalremovalmodetoggled", onPmGuard);
      map.off("pm:create", onPmCreate);
      map.off("pm:drawstart", onDrawStart as L.LeafletEventHandlerFn);
      map.off("pm:drawend", onDrawEnd);
      map.off("pm:click", onPmClick);
      map.off("click", onMapClick);
      pm?.removeControls();
      map.remove();
      mapRef.current = null;
      manualGroupRef.current = null;
      mgrsGroupRef.current = null;
      measureGroupRef.current = null;
      measurePtsRef.current = [];
      measureLineRef.current = null;
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
      geomanStepAwayFromMapTools(map as MapWithPmHack);
      try {
        asPmMap(map).pm.disableDraw?.();
      } catch {
        /* ignore */
      }
    }
    if (toolMode !== "measure") {
      measurePtsRef.current = [];
      measureLineRef.current = null;
      measureGroupRef.current?.clearLayers();
      setMeasureKm(null);
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

  const applySelectionMeta = () => {
    const layer = selectedRef.current;
    if (!layer) {
      Alert.alert("Sand Table", "Select something on the map first.");
      return;
    }
    const wrap = layer as unknown as { feature?: Feature; toGeoJSON?: () => Feature };
    if (!wrap.feature && typeof wrap.toGeoJSON === "function") {
      try {
        wrap.feature = wrap.toGeoJSON();
      } catch {
        /* ignore */
      }
    }
    if (!wrap.feature) {
      wrap.feature = {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [0, 0] },
      };
    }
    const cur = ((wrap.feature.properties ?? {}) as Record<string, unknown>) ?? {};
    wrap.feature.properties = { ...cur, title: selTitle, notes: selNotes } as Record<string, string>;
    bumpSel();
  };

  const applyTextEdit = () => {
    const layer = selectedRef.current;
    if (!layer || typeof (layer as L.Marker).getLatLng !== "function") {
      Alert.alert("Sand Table", "Select a text label on the map.");
      return;
    }
    const feat = (layer as unknown as { feature?: Feature }).feature;
    const p = feat?.properties as Record<string, unknown> | undefined;
    if (p?.mmKind !== "text") {
      Alert.alert("Sand Table", "Select a pinned text label (not a symbol).");
      return;
    }
    const raw = textDraft.trim() || "TEXT";
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
    (layer as L.Marker).setIcon(divIcon);
    if (feat) {
      feat.properties = { ...(feat.properties as Record<string, unknown>), label: raw };
      const ll = (layer as L.Marker).getLatLng();
      feat.geometry = { type: "Point", coordinates: [ll.lng, ll.lat] };
    }
    bumpSel();
  };

  const applyFillColor = (hex: string) => {
    const layer = selectedRef.current;
    if (!layer || !("setStyle" in layer)) {
      Alert.alert("Sand Table", "Select a filled shape (polygon, rectangle, or circle).");
      return;
    }
    (layer as L.Path).setStyle({ fillColor: hex, fillOpacity: 0.35 });
    bumpSel();
  };

  const applyCircleSize = () => {
    const layer = selectedRef.current as unknown as { getRadius?: () => number; setRadius?: (m: number) => void };
    const m = Number.parseFloat(String(circleRadiusM).replace(/,/g, ""));
    if (!layer?.setRadius || !Number.isFinite(m) || m <= 0) {
      Alert.alert("Sand Table", "Select a circle, then enter a radius in meters.");
      return;
    }
    layer.setRadius(m);
    bumpSel();
  };

  const applySymbolResize = () => {
    const layer = selectedRef.current;
    if (!layer || typeof (layer as L.Marker).getLatLng !== "function") return;
    const feat = (layer as unknown as { feature?: Feature }).feature;
    const p = feat?.properties as Record<string, unknown> | undefined;
    if (p?.mmKind !== "milsymbol") {
      Alert.alert("Sand Table", "Select a unit symbol on the map.");
      return;
    }
    const sz = Math.max(24, Math.min(120, symbolSize));
    const sidc =
      typeof p.sidc === "string" && p.sidc
        ? p.sidc
        : tacticalChoicesToSIDC(
            (p.affiliation as TacticalAffiliation) ?? "friendly",
            (p.unitType as TacticalUnitType) ?? "infantry",
          );
    const svg = generateTacticalSymbolSvg({ sidc, size: sz });
    const { w, h, ax, ay } = milSymbolIconSize(sidc, sz);
    const icon = L.divIcon({
      className: "mm-sand-mil",
      html: `<div style="width:${w}px;height:${h}px;line-height:0">${svg}</div>`,
      iconSize: [w, h],
      iconAnchor: [ax, ay],
    });
    (layer as L.Marker).setIcon(icon);
    if (feat?.properties) {
      (feat.properties as Record<string, unknown>).symbolSizePx = sz;
      (feat.properties as Record<string, unknown>).sidc = sidc;
    }
    bumpSel();
  };

  const enableShapeVertexEdit = () => {
    const map = mapRef.current;
    if (!map) return;
    setToolMode("draw");
    requestAnimationFrame(() => {
      try {
        (map as MapWithPmHack).pm?.enableGlobalEditMode?.();
      } catch {
        /* ignore */
      }
    });
  };

  const clearMeasure = () => {
    measurePtsRef.current = [];
    measureLineRef.current = null;
    measureGroupRef.current?.clearLayers();
    setMeasureKm(null);
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

  const panelBg = scheme === "dark" ? "#0b1220" : TacticalPalette.elevated;
  const panelBorder = p.tabIconDefault;

  const styleModalBody = (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 480 }}>
      <Text style={[styles.modalSection, { color: p.tabIconDefault }]}>Fill (polygon / rectangle / circle)</Text>
      <View style={styles.chipRow}>
        <Pressable onPress={() => applyFillColor("#22c55e")} style={[styles.colorDot, { backgroundColor: "#22c55e" }]} />
        <Pressable onPress={() => applyFillColor("#f97316")} style={[styles.colorDot, { backgroundColor: "#f97316" }]} />
        <Pressable onPress={() => applyFillColor("#3b82f6")} style={[styles.colorDot, { backgroundColor: "#3b82f6" }]} />
        <Pressable onPress={() => applyFillColor("#a855f7")} style={[styles.colorDot, { backgroundColor: "#a855f7" }]} />
      </View>

      <Text style={[styles.modalSection, { color: p.tabIconDefault }]}>Circle radius (meters)</Text>
      <TextInput
        value={circleRadiusM}
        onChangeText={setCircleRadiusM}
        keyboardType="decimal-pad"
        placeholder="500"
        placeholderTextColor={p.tabIconDefault}
        style={[styles.textField, { color: p.text, borderColor: p.tabIconDefault }]}
      />
      <Pressable onPress={applyCircleSize} style={[styles.miniBtn, { marginTop: 8, alignSelf: "flex-start" }]}>
        <Text style={styles.miniBtnTx}>Apply radius</Text>
      </Pressable>

      <Text style={[styles.modalSection, { color: p.tabIconDefault }]}>Outline / stroke</Text>
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

      <Pressable onPress={enableShapeVertexEdit} style={[styles.miniBtn, { marginTop: 12, alignSelf: "flex-start" }]}>
        <Text style={styles.miniBtnTx}>Edit vertices (Geoman)</Text>
      </Pressable>
    </ScrollView>
  );

  return (
    <>
    <View style={[styles.row, compact && styles.rowCompact]}>
      <View style={[styles.mapCol, compact && styles.mapColCompact]}>
        <View ref={hostRef} style={styles.mapHost} collapsable={false} />
        {toolMode === "measure" && measureKm != null ? (
          <View style={styles.metricBox} pointerEvents="none">
            <Text style={styles.metricTitle}>Measure length</Text>
            <Text style={styles.metricVal}>{measureKm.toFixed(3)} km</Text>
          </View>
        ) : liveRouteKm != null ? (
          <View style={styles.metricBox} pointerEvents="none">
            <Text style={styles.metricTitle}>Route length</Text>
            <Text style={styles.metricVal}>{liveRouteKm.toFixed(2)} km</Text>
          </View>
        ) : null}
      </View>
      {compact ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: editorOpen }}
          onPress={() => setEditorOpen((v) => !v)}
          style={[styles.compactToolBar, { borderTopColor: panelBorder, backgroundColor: scheme === "dark" ? "#111827" : "#e7e5e4" }]}>
          <Text style={[styles.compactToolBarText, { color: p.text }]}>
            {editorOpen ? "▼ Hide tools & export" : "▲ Sand table tools & export"}
          </Text>
        </Pressable>
      ) : null}
      {(!compact || editorOpen) ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          style={[
            styles.panel,
            compact ? styles.panelCompact : { width: panelW },
            !compact && { borderLeftColor: panelBorder },
            compact && { borderTopColor: panelBorder },
            { backgroundColor: panelBg },
            compact && { maxHeight: Math.min(Math.round(height * 0.52), 440) },
          ]}>
        <Text style={[styles.panelKicker, { color: TacticalPalette.accent }]}>EDITOR</Text>
        <Text style={[styles.panelHead, { color: p.text }]}>Vectors & symbols</Text>
        <Text style={[styles.panelHint, { color: p.tabIconDefault }]}>
          This map is isolated from the global tactical map. Draw routes and zones with the Leaflet toolbar, then use symbol/text tools here.
        </Text>

        <Text style={[styles.section, { color: p.tabIconDefault }]}>Basemap</Text>
        <View style={styles.rowBetween}>
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
          <View style={styles.switchRow}>
            <Text style={{ color: p.tabIconDefault, fontSize: 11, fontWeight: "700" }}>MGRS grid</Text>
            <Pressable
              onPress={() => setShowMgrsGrid((v) => !v)}
              style={[
                styles.chip,
                {
                  borderColor: showMgrsGrid ? TacticalPalette.accent : p.tabIconDefault,
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                },
              ]}>
              <Text style={{ color: p.text, fontWeight: showMgrsGrid ? "900" : "600", fontSize: 11 }}>
                {showMgrsGrid ? "On" : "Off"}
              </Text>
            </Pressable>
          </View>
        </View>
        <Text style={[styles.panelHint, { color: p.tabIconDefault }]}>
          Grid lines are geographic (lat/lng); corner labels use your zoom-sized step and MGRS (library accuracy). Included in
          PNG export when enabled.
        </Text>

        <Text style={[styles.section, { color: p.tabIconDefault }]}>Placement mode</Text>
        <View style={styles.chipRow}>
          {(
            [
              ["draw", "Draw"],
              ["symbol", "Symbol"],
              ["text", "Text"],
              ["measure", "Measure"],
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
        {toolMode === "measure" ? (
          <View style={{ gap: 8, marginBottom: 10 }}>
            <Text style={[styles.panelHint, { color: p.tabIconDefault }]}>
              Tap the map to add corners. Distance accumulates along the whole line. Clear to start over.
            </Text>
            <Pressable onPress={clearMeasure} style={[styles.miniBtn, { alignSelf: "flex-start" }]}>
              <Text style={styles.miniBtnTx}>Clear measure</Text>
            </Pressable>
          </View>
        ) : null}

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
            <Text style={[styles.section, { color: p.tabIconDefault }]}>Symbol size (new drops)</Text>
            <TextInput
              value={String(symbolSize)}
              onChangeText={(t) => setSymbolSize(Math.max(16, Math.min(120, Math.round(Number.parseInt(t.replace(/\D/g, "") || "0", 10) || 40))))}
              keyboardType="number-pad"
              placeholder="40"
              placeholderTextColor={p.tabIconDefault}
              style={[styles.textField, { color: p.text, borderColor: p.tabIconDefault }]}
            />
            <Text style={[styles.panelHint, { color: p.tabIconDefault }]}>
              Tap the map to drop the current symbol. Drag to fine-tune. If taps do nothing, switch to Draw briefly, exit any
              Leaflet “edit” mode, then return here.
            </Text>
          </>
        ) : null}

        {toolMode === "text" ? (
          <Text style={[styles.panelHint, { color: p.tabIconDefault }]}>
            Tap the map to place a label. Press Enter or blur the field to lock text to the map.
          </Text>
        ) : null}

        <Text style={[styles.section, { color: p.tabIconDefault }]}>Selected graphic</Text>
        <Text style={[styles.panelHint, { color: p.tabIconDefault }]}>
          Tap a line, polygon, circle, symbol, or label. Titles/notes embed in exported GeoJSON.
        </Text>
        <Text style={[styles.miniLabel, { color: p.tabIconDefault }]}>Title</Text>
        <TextInput
          value={selTitle}
          onChangeText={setSelTitle}
          placeholder="Short label"
          placeholderTextColor={p.tabIconDefault}
          style={[styles.textField, { color: p.text, borderColor: p.tabIconDefault }]}
        />
        <Text style={[styles.miniLabel, { color: p.tabIconDefault, marginTop: 8 }]}>Details</Text>
        <TextInput
          value={selNotes}
          onChangeText={setSelNotes}
          placeholder="Longer notes / context"
          placeholderTextColor={p.tabIconDefault}
          multiline
          style={[styles.textFieldMultiline, { color: p.text, borderColor: p.tabIconDefault }]}
        />
        <Pressable onPress={applySelectionMeta} style={[styles.miniBtn, { marginTop: 8, alignSelf: "flex-start" }]}>
          <Text style={styles.miniBtnTx}>Save title & details to feature</Text>
        </Pressable>

        <Text style={[styles.miniLabel, { color: p.tabIconDefault, marginTop: 12 }]}>Text label</Text>
        <TextInput
          value={textDraft}
          onChangeText={setTextDraft}
          placeholder="Select a text pin to edit"
          placeholderTextColor={p.tabIconDefault}
          style={[styles.textField, { color: p.text, borderColor: p.tabIconDefault }]}
        />
        <View style={[styles.chipRow, { marginTop: 8 }]}>
          <Pressable onPress={applyTextEdit} style={styles.miniBtn}>
            <Text style={styles.miniBtnTx}>Apply text</Text>
          </Pressable>
        </View>

        <Text style={[styles.miniLabel, { color: p.tabIconDefault, marginTop: 12 }]}>Unit symbol size (selected)</Text>
        <TextInput
          value={String(symbolSize)}
          onChangeText={(t) => setSymbolSize(Math.max(16, Math.min(160, Math.round(Number.parseInt(t.replace(/\D/g, "") || "0", 10) || 40))))}
          keyboardType="number-pad"
          style={[styles.textField, { color: p.text, borderColor: p.tabIconDefault }]}
        />
        <Pressable onPress={applySymbolResize} style={[styles.miniBtn, { marginTop: 8, alignSelf: "flex-start" }]}>
          <Text style={styles.miniBtnTx}>Resize selected symbol</Text>
        </Pressable>

        {isPathLikeLayer(selectedRef.current) ? (
          <Pressable
            onPress={() => setStyleEditorOpen(true)}
            style={[
              styles.stylePopLauncher,
              { borderColor: TacticalPalette.accent, backgroundColor: `${TacticalPalette.accent}18` },
            ]}>
            <Text style={{ color: p.text, fontWeight: "900", fontSize: 13 }}>Stroke, fill & shape…</Text>
            <Text style={[styles.panelHint, { color: p.tabIconDefault, marginBottom: 0 }]}>
              Opens after you finish drawing a line or zone, or tap here to tweak the selected vector.
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.panelHint, { color: p.tabIconDefault }]}>
            Finish a line, polygon, rectangle, or circle to style it in a pop-over (or select an existing vector first).
          </Text>
        )}

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
      ) : null}
    </View>

    <Modal
      visible={styleEditorOpen}
      animationType="fade"
      transparent
      onRequestClose={() => setStyleEditorOpen(false)}>
      <Pressable style={styles.styleModalBackdrop} onPress={() => setStyleEditorOpen(false)}>
        <Pressable
          onPress={() => {}}
          style={[styles.styleModalCard, { borderColor: panelBorder, backgroundColor: panelBg }]}>
          <View style={styles.styleModalHead}>
            <Text style={[styles.modalTitle, { color: p.text }]}>Vector appearance</Text>
            <Pressable onPress={() => setStyleEditorOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={{ color: TacticalPalette.accent, fontWeight: "900", fontSize: 14 }}>Done</Text>
            </Pressable>
          </View>
          {styleModalBody}
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minHeight: 0 },
  rowCompact: { flexDirection: "column" },
  mapCol: { flex: 1, minWidth: 0, position: "relative" as const },
  mapColCompact: { width: "100%", minHeight: 220, flex: 1 },
  mapHost: { flex: 1, width: "100%", height: "100%" },
  compactToolBar: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  compactToolBarText: { fontWeight: "900", fontSize: 13 },
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
  panelCompact: {
    width: "100%",
    maxWidth: 9999,
    flexGrow: 0,
    borderLeftWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  panelKicker: { fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  panelHead: { fontSize: 18, fontWeight: "900", marginTop: 6, marginBottom: 8 },
  panelHint: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  section: { fontSize: 11, fontWeight: "800", marginTop: 12, marginBottom: 6, letterSpacing: 0.4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  rowBetween: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
  },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 2 },
  colorDot: { width: 34, height: 34, borderRadius: 10, borderWidth: 2, borderColor: "#0f172a" },
  miniBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: "#1e293b" },
  miniBtnTx: { color: "#e2e8f0", fontWeight: "800", fontSize: 11 },
  dangerBtn: { alignSelf: "flex-start", marginTop: 10, paddingVertical: 10, paddingHorizontal: 12 },
  dangerTx: { color: "#fecaca", fontWeight: "900", fontSize: 13 },
  approveBtn: { marginTop: 18, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  approveTx: { color: "#0b1220", fontWeight: "900", fontSize: 14 },
  footerHint: { fontSize: 11, lineHeight: 16, marginTop: 10 },
  miniLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.35 },
  textField: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textFieldMultiline: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: "top",
  },
  stylePopLauncher: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    gap: 6,
  },
  styleModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 20,
  },
  styleModalCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  styleModalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  modalTitle: { fontSize: 17, fontWeight: "900" },
  modalSection: { fontSize: 11, fontWeight: "800", marginTop: 12, marginBottom: 6, letterSpacing: 0.35 },
});
