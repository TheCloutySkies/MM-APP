import type { Feature, FeatureCollection } from "geojson";
import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { ensureFeatureId } from "@/lib/gis/gisTypes";
import {
    generateTacticalSymbolSvg,
    milSymbolIconSize,
} from "@/lib/gis/milSym";

import type { GisDrawPalette, MeasurePreview } from "./gisMapTypes";
import type {
    MapBaseLayerId,
    MapFlyToRequest,
    MapPin,
    MapPointerMode,
    MapPolygonOverlay,
    MapPolylineOverlay,
    MapUserLocation,
} from "./mapTypes";

export type { GisDrawPalette, MeasurePreview };

const DEFAULT_GIS_PALETTE: GisDrawPalette = {
  bufferStroke: "#ef4444",
  bufferFill: "#ef4444",
  lineString: "#60a5fa",
  polygonStroke: "#6b8e5c",
  polygonFill: "#6b8e5c",
  measure: "#fbbf24",
};

type Props = {
  pins: MapPin[];
  polylines?: MapPolylineOverlay[];
  polygons?: MapPolygonOverlay[];
  onLongPress?: (lat: number, lng: number) => void;
  onPress?: (lat: number, lng: number) => void;
  flyTo?: MapFlyToRequest | null;
  baseLayer?: MapBaseLayerId;
  userLocation?: MapUserLocation | null;
  pointerMode?: MapPointerMode;
  onCenterChange?: (lat: number, lng: number, zoom?: number) => void;
  /** 0–100 Night Ops map darken — scales Leaflet container brightness. */
  mapDimPercent?: number;
  onPinSelect?: (pin: MapPin) => void;
  /** Tactical GIS: client-side FeatureCollection (buffers, Geoman draws, MIL points). */
  gisFeatureCollection?: FeatureCollection | null;
  onGisFeatureSelect?: (feature: Feature) => void;
  geomanEnabled?: boolean;
  onPmCreate?: (feature: Feature) => void;
  onMouseMoveLatLng?: (lat: number, lng: number) => void;
  /** Map zoom — scales milsymbol DivIcons on change. */
  gisMapZoom?: number;
  /** Ephemeral measure line + endpoints while Measure tool is active. */
  measurePreview?: MeasurePreview | null;
  /** Default colors for GIS vectors (per-feature props may override). */
  gisPalette?: Partial<GisDrawPalette>;
};

/** CDN assets so Metro never resolves leaflet/dist/images/*.png */
function useLeafletAssets() {
  useEffect(() => {
    const cssId = "mm-leaflet-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const pulseId = "mm-user-loc-css";
    if (!document.getElementById(pulseId)) {
      const s = document.createElement("style");
      s.id = pulseId;
      s.textContent = `@keyframes mm-pulse{0%{transform:scale(1);opacity:.85}100%{transform:scale(2.4);opacity:0}}.mm-user-dot{width:14px;height:14px;border-radius:50%;background:#1e88e5;border:2px solid #fff;box-shadow:0 0 0 2px rgba(30,136,229,.5);position:relative}.mm-user-dot:after{content:"";position:absolute;inset:-6px;border-radius:50%;animation:mm-pulse 1.75s ease-out infinite;background:rgba(30,136,229,.4)}`;
      document.head.appendChild(s);
    }
    const base = "https://unpkg.com/leaflet@1.9.4/dist/images/";
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: `${base}marker-icon-2x.png`,
      iconUrl: `${base}marker-icon.png`,
      shadowUrl: `${base}marker-shadow.png`,
    });
  }, []);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function popupHtml(title: string, subtitle?: string): string {
  const sub = subtitle
    ? `<div style="font-size:12px;margin-top:5px;line-height:1.35;opacity:.9;white-space:pre-wrap">${escapeHtml(
        subtitle,
      ).replace(/\n/g, "<br/>")}</div>`
    : "";
  return `<div><strong>${escapeHtml(title)}</strong>${sub}</div>`;
}

function markerIcon(tint: string) {
  return L.divIcon({
    className: "mm-leaflet-pin",
    html: `<div style="background:${tint};width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45)"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function userLocationIcon() {
  return L.divIcon({
    className: "mm-leaflet-user",
    html: `<div class="mm-user-dot"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function makeOsmLayer() {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  });
}

function makeOsmDarkLayer() {
  return L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> · © CARTO',
  });
}

function makeTopoLayer() {
  return L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    subdomains: "abc",
    attribution: '© OpenTopoMap (CC-BY-SA) · © OSM contributors',
  });
}

function makeSatelliteLayer() {
  return L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles © Esri" },
  );
}

/** Bing-style hybrid: imagery + reference labels / boundaries (Esri). */
function makeHybridLabelsLayer() {
  return L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Labels © Esri",
      maxZoom: 19,
      pane: "overlayPane",
    },
  );
}

/** Geoman CSS via CDN — avoids Metro `import(".css")` and async chunks that break Expo web. */
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

let leafletGeomanModuleLoaded = false;

/**
 * Geoman expects `globalThis.L` (script-tag style). Some bundlers also split Leaflet; align them.
 * The module patches Leaflet init hooks — maps created before this load never get `map.pm`, so we
 * attach with `new L.PM.Map(map)` in the Geoman effect when needed.
 */
function loadLeafletGeomanOnce() {
  if (leafletGeomanModuleLoaded) return;
  const g = globalThis as typeof globalThis & { L?: typeof L };
  g.L = L;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@geoman-io/leaflet-geoman-free");
    leafletGeomanModuleLoaded = true;
  } catch {
    leafletGeomanModuleLoaded = false;
    throw new Error("[Geoman] failed to load @geoman-io/leaflet-geoman-free");
  }
}

type GeomanPmControls = {
  addControls: (o: Record<string, unknown>) => void;
  removeControls: () => void;
};

/** Ensures `map.pm` exists for maps that were created before Geoman was first loaded. */
function ensureMapPmControls(map: L.Map): GeomanPmControls | undefined {
  loadLeafletGeomanOnce();
  const PM = L as unknown as { PM?: { Map: new (mp: L.Map) => GeomanPmControls } };
  if (!PM.PM?.Map) {
    console.warn("[Geoman] L.PM.Map missing after load");
    return undefined;
  }
  const m = map as L.Map & { pm?: GeomanPmControls };
  if (!m.pm) {
    m.pm = new PM.PM.Map(map);
  }
  return m.pm;
}

function TacticalMapLeaflet({
  pins,
  polylines = [],
  polygons = [],
  onLongPress,
  onPress,
  flyTo,
  baseLayer = "osm",
  userLocation,
  pointerMode = "default",
  onCenterChange,
  mapDimPercent = 0,
  onPinSelect,
  gisFeatureCollection = null,
  onGisFeatureSelect,
  geomanEnabled = false,
  onPmCreate,
  onMouseMoveLatLng,
  gisMapZoom = 10,
  measurePreview = null,
  gisPalette: gisPalettePartial,
}: Props) {
  useLeafletAssets();

  const gisPalette = useMemo(
    () => ({ ...DEFAULT_GIS_PALETTE, ...gisPalettePartial }),
    [
      gisPalettePartial?.bufferStroke,
      gisPalettePartial?.bufferFill,
      gisPalettePartial?.lineString,
      gisPalettePartial?.polygonStroke,
      gisPalettePartial?.polygonFill,
      gisPalettePartial?.measure,
    ],
  );

  const containerRef = useRef<View>(null);
  const mapRef = useRef<L.Map | null>(null);
  /** Locate-to-GPS button inside Leaflet control bar — updated from `paintAll` when fixes arrive. */
  const locateControlLinkRef = useRef<HTMLAnchorElement | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const hybridLabelsRef = useRef<L.TileLayer | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const geoJsonGroupRef = useRef<L.LayerGroup | null>(null);
  const measurePreviewGroupRef = useRef<L.LayerGroup | null>(null);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const polylinesRef = useRef(polylines);
  polylinesRef.current = polylines;
  const polygonsRef = useRef(polygons);
  polygonsRef.current = polygons;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const userLocRef = useRef(userLocation);
  userLocRef.current = userLocation;
  const onCenterRef = useRef(onCenterChange);
  onCenterRef.current = onCenterChange;
  const mapDimRef = useRef(mapDimPercent);
  mapDimRef.current = mapDimPercent;
  const onPinSelectRef = useRef(onPinSelect);
  onPinSelectRef.current = onPinSelect;
  const gisFcRef = useRef(gisFeatureCollection);
  gisFcRef.current = gisFeatureCollection;
  const onGisSelectRef = useRef(onGisFeatureSelect);
  onGisSelectRef.current = onGisFeatureSelect;
  const onPmCreateRef = useRef(onPmCreate);
  onPmCreateRef.current = onPmCreate;
  const onMouseMoveRef = useRef(onMouseMoveLatLng);
  onMouseMoveRef.current = onMouseMoveLatLng;
  const gisZoomRef = useRef(gisMapZoom);
  gisZoomRef.current = gisMapZoom;
  const gisPaletteRef = useRef(gisPalette);
  gisPaletteRef.current = gisPalette;

  const applyMapDim = (map: L.Map, dimRaw: number) => {
    const el = map.getContainer();
    const dim = Math.max(0, Math.min(100, dimRaw));
    if (dim <= 0) {
      el.style.filter = "";
      return;
    }
    const brightness = Math.max(0.12, 1 - (dim / 100) * 0.88);
    el.style.filter = `brightness(${brightness})`;
  };

  const paintAll = () => {
    const group = layerRef.current;
    if (!group) return;
    group.clearLayers();

    for (const poly of polygonsRef.current) {
      const latlngs = poly.coordinates.map((c) => [c.latitude, c.longitude] as [number, number]);
      if (latlngs.length < 3) continue;
      L.polygon(latlngs, {
        color: poly.strokeColor,
        weight: 2,
        fillColor: poly.fillColor,
        fillOpacity: 0.9,
      })
        .bindPopup(popupHtml(poly.title, poly.subtitle))
        .addTo(group);
    }

    for (const line of polylinesRef.current) {
      const latlngs = line.coordinates.map((c) => [c.latitude, c.longitude] as [number, number]);
      if (latlngs.length < 2) continue;
      L.polyline(latlngs, {
        color: line.color,
        weight: 4,
        opacity: 0.92,
        dashArray: line.lineDash,
      })
        .bindPopup(popupHtml(line.title, line.subtitle))
        .addTo(group);
    }

    for (const p of pinsRef.current) {
      const mk = L.marker([p.lat, p.lng], { icon: markerIcon(p.tint), title: p.title });
      const handler = onPinSelectRef.current;
      if (handler) {
        mk.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          handler(p);
        });
      } else {
        mk.bindPopup(popupHtml(p.title, p.subtitle));
      }
      mk.addTo(group);
    }

    const ul = userLocRef.current;
    if (ul) {
      L.marker([ul.lat, ul.lng], { icon: userLocationIcon(), title: "You", zIndexOffset: 900 })
        .bindPopup(popupHtml("Your position", "Live GPS / geolocation"))
        .addTo(group);
    }

    const locLink = locateControlLinkRef.current;
    if (locLink) {
      const has = Boolean(userLocRef.current);
      locLink.style.opacity = has ? "1" : "0.42";
      locLink.style.cursor = has ? "pointer" : "default";
      locLink.setAttribute("aria-disabled", has ? "false" : "true");
    }
  };

  useEffect(() => {
    const el = containerRef.current as unknown as HTMLElement | null;
    if (!el) return;

    const map = L.map(el, { scrollWheelZoom: true, zoomControl: false }).setView([39.5, -120.2], 7);
    mapRef.current = map;
    /** Zoom first so it sits flush to the corner; locate is added second and stacks above (+/−). */
    L.control.zoom({ position: "bottomright" }).addTo(map);

    const LocateCtrl = L.Control.extend({
      options: { position: "bottomright" },
      onAdd(ctrlMap: L.Map) {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
        const link = L.DomUtil.create("a", "", container) as HTMLAnchorElement;
        link.href = "#";
        link.title = "Zoom to current location";
        link.setAttribute("aria-label", "Zoom to current location");
        link.style.display = "flex";
        link.style.alignItems = "center";
        link.style.justifyContent = "center";
        link.innerHTML =
          '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>';
        const onLocate = (e: Event) => {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          const u = userLocRef.current;
          if (!u) return;
          const z = Math.max(ctrlMap.getZoom(), 15);
          ctrlMap.flyTo([u.lat, u.lng], z, { duration: 1 });
        };
        L.DomEvent.on(link, "click", onLocate);
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        locateControlLinkRef.current = link;
        return container;
      },
      onRemove() {
        locateControlLinkRef.current = null;
      },
    });
    new LocateCtrl().addTo(map);

    if (baseLayer === "hybrid") {
      const sat = makeSatelliteLayer();
      sat.addTo(map);
      const labels = makeHybridLabelsLayer();
      labels.addTo(map);
      tileRef.current = sat;
      hybridLabelsRef.current = labels;
    } else {
      const initial =
        baseLayer === "satellite"
          ? makeSatelliteLayer()
          : baseLayer === "topo"
            ? makeTopoLayer()
            : baseLayer === "osm_dark"
              ? makeOsmDarkLayer()
              : makeOsmLayer();
      initial.addTo(map);
      tileRef.current = initial;
      hybridLabelsRef.current = null;
    }

    layerRef.current = L.layerGroup().addTo(map);
    geoJsonGroupRef.current = L.layerGroup().addTo(map);
    measurePreviewGroupRef.current = L.layerGroup().addTo(map);
    paintAll();
    applyMapDim(map, mapDimRef.current);

    const onCtx = (e: L.LeafletMouseEvent) => {
      onLongPressRef.current?.(e.latlng.lat, e.latlng.lng);
    };
    map.on("contextmenu", onCtx);

    const onMapClick = (e: L.LeafletMouseEvent) => {
      onPressRef.current?.(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", onMapClick);

    const emitCenter = () => {
      const c = map.getCenter();
      onCenterRef.current?.(c.lat, c.lng, map.getZoom());
    };
    emitCenter();
    map.on("moveend", emitCenter);
    map.on("zoomend", emitCenter);

    const t = requestAnimationFrame(() => {
      map.invalidateSize();
    });

    return () => {
      cancelAnimationFrame(t);
      locateControlLinkRef.current = null;
      map.off("contextmenu", onCtx);
      map.off("click", onMapClick);
      map.off("moveend", emitCenter);
      map.off("zoomend", emitCenter);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      geoJsonGroupRef.current = null;
      measurePreviewGroupRef.current = null;
      tileRef.current = null;
      hybridLabelsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const el = containerRef.current as unknown as HTMLElement | null;
    if (!map || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const cur = tileRef.current;
    const hy = hybridLabelsRef.current;
    if (!map || !cur) return;
    map.removeLayer(cur);
    if (hy) {
      map.removeLayer(hy);
      hybridLabelsRef.current = null;
    }
    if (baseLayer === "hybrid") {
      const sat = makeSatelliteLayer();
      sat.addTo(map);
      const labels = makeHybridLabelsLayer();
      labels.addTo(map);
      tileRef.current = sat;
      hybridLabelsRef.current = labels;
    } else {
      const next =
        baseLayer === "satellite"
          ? makeSatelliteLayer()
          : baseLayer === "topo"
            ? makeTopoLayer()
            : baseLayer === "osm_dark"
              ? makeOsmDarkLayer()
              : makeOsmLayer();
      next.addTo(map);
      tileRef.current = next;
    }
  }, [baseLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const el = map.getContainer();
    el.style.cursor = pointerMode === "crosshair" ? "crosshair" : "";
  }, [pointerMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyMapDim(map, mapDimPercent);
  }, [mapDimPercent]);

  useEffect(() => {
    paintAll();
  }, [pins, polylines, polygons, userLocation, onPinSelect]);

  useEffect(() => {
    if (flyTo == null) return;
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 10, { duration: 1.2 });
  }, [flyTo?.seq]);

  useEffect(() => {
    const g = geoJsonGroupRef.current;
    if (!g) return;
    g.clearLayers();
    const fc = gisFeatureCollection;
    if (!fc?.features?.length) return;
    const z = gisMapZoom ?? 10;
    const palette = gisPaletteRef.current;
    const symSize = Math.max(26, Math.min(58, Math.round(22 + z * 1.2)));
    L.geoJSON(fc, {
      style: (feat) => {
        const props = feat?.properties as Record<string, unknown> | null;
        const kind = props?.kind;
        if (kind === "buffer") {
          const stroke =
            typeof props?.bufferStroke === "string" ? props.bufferStroke : palette.bufferStroke;
          const fill = typeof props?.bufferFill === "string" ? props.bufferFill : palette.bufferFill;
          const fo =
            typeof props?.bufferFillOpacity === "number" && Number.isFinite(props.bufferFillOpacity)
              ? props.bufferFillOpacity
              : 0.14;
          return {
            color: stroke,
            weight: 2,
            fillColor: fill,
            fillOpacity: fo,
            interactive: false,
          } as L.PathOptions;
        }
        if (feat?.geometry?.type === "LineString") {
          const c = typeof props?.lineColor === "string" ? props.lineColor : palette.lineString;
          return { color: c, weight: 4, opacity: 0.92 } as L.PathOptions;
        }
        const s = typeof props?.zoneStroke === "string" ? props.zoneStroke : palette.polygonStroke;
        const f = typeof props?.zoneFill === "string" ? props.zoneFill : palette.polygonFill;
        return {
          color: s,
          weight: 2,
          fillColor: f,
          fillOpacity: 0.16,
        } as L.PathOptions;
      },
      pointToLayer: (feat, latlng) => {
        const sidc = (feat.properties as Record<string, unknown> | undefined)?.sidc;
        if (typeof sidc === "string" && sidc.length > 0) {
          const svg = generateTacticalSymbolSvg({ sidc, size: symSize, infoFields: false });
          const { w, h, ax, ay } = milSymbolIconSize(sidc, symSize);
          const icon = L.divIcon({
            html: `<div style="width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center">${svg}</div>`,
            iconSize: [w, h],
            iconAnchor: [ax, ay],
            className: "mm-mil-marker",
          });
          return L.marker(latlng, { icon, interactive: true });
        }
        return L.circleMarker(latlng, {
          radius: 7,
          color: "#6b8e5c",
          fillColor: "#93c47d",
          fillOpacity: 0.85,
          weight: 2,
        });
      },
      onEachFeature: (feat, layer) => {
        const kind = (feat.properties as Record<string, unknown> | null)?.kind;
        if (kind === "buffer") return;
        layer.on("click", (ev: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(ev);
          onGisSelectRef.current?.(feat as Feature);
        });
      },
    }).addTo(g);
  }, [gisFeatureCollection, gisMapZoom, gisPalette]);

  useEffect(() => {
    const g = measurePreviewGroupRef.current;
    if (!g) return;
    g.clearLayers();
    const p = measurePreview;
    const palette = gisPaletteRef.current;
    if (!p?.from) return;
    const col = p.color ?? palette.measure;
    const a: L.LatLngTuple = [p.from.lat, p.from.lng];
    L.circleMarker(a, { radius: 5, color: col, weight: 2, fillColor: col, fillOpacity: 0.9 }).addTo(g);
    const to = p.to;
    if (to && (to.lat !== p.from.lat || to.lng !== p.from.lng)) {
      const b: L.LatLngTuple = [to.lat, to.lng];
      L.polyline(
        [a, b],
        { color: col, weight: 3, opacity: 0.95, dashArray: "8 6" },
      ).addTo(g);
      L.circleMarker(b, { radius: 5, color: col, weight: 2, fillColor: "#fff", fillOpacity: 0.95 }).addTo(
        g,
      );
    }
  }, [measurePreview]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const fn = (e: L.LeafletMouseEvent) => onMouseMoveRef.current?.(e.latlng.lat, e.latlng.lng);
    map.on("mousemove", fn);
    return () => {
      map.off("mousemove", fn);
    };
  }, []);

  useEffect(() => {
    if (!geomanEnabled) return;
    const map = mapRef.current;
    if (!map) return;
    let alive = true;
    const pmCreateHandler: L.LeafletEventHandlerFn = (e) => {
      const ev = e as unknown as { layer: L.Layer };
      const layer = ev.layer as L.Layer & { toGeoJSON: () => Feature };
      const gj = ensureFeatureId(layer.toGeoJSON());
      map.removeLayer(layer);
      onPmCreateRef.current?.(gj);
    };

    try {
      ensureGeomanCssLink();
    } catch (e) {
      console.warn("[Geoman] CSS link failed", e);
      return;
    }
    let pm: GeomanPmControls | undefined;
    try {
      pm = ensureMapPmControls(map);
    } catch (e) {
      console.warn("[Geoman] failed to load", e);
      return;
    }
    if (!pm || typeof pm.addControls !== "function") {
      console.warn("[Geoman] map.pm is unavailable (Leaflet / Geoman binding)");
      return;
    }
    if (!alive || !mapRef.current) return;
    pm.addControls({
      position: "topright",
      drawMarker: false,
      drawPolyline: true,
      drawPolygon: true,
      drawRectangle: false,
      drawCircle: false,
      drawCircleMarker: false,
      drawText: false,
      editMode: true,
      dragMode: true,
      removalMode: true,
      cutPolygon: false,
    });
    map.on("pm:create", pmCreateHandler);

    return () => {
      alive = false;
      map.off("pm:create", pmCreateHandler);
      (map as L.Map & { pm?: { removeControls: () => void } }).pm?.removeControls();
    };
  }, [geomanEnabled]);

  return <View ref={containerRef} style={styles.fill} collapsable={false} />;
}

const styles = StyleSheet.create({
  /** Match parent flex; `minHeight: 0` so Leaflet’s container gets real height on web. */
  fill: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    ...(Platform.OS === "web" ? ({ touchAction: "none" } as const) : null),
  },
});

export { TacticalMapLeaflet };
export default TacticalMapLeaflet;
