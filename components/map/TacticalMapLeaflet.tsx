import L from "leaflet";
import { useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";

import type {
    MapBaseLayerId,
    MapFlyToRequest,
    MapPin,
    MapPointerMode,
    MapPolygonOverlay,
    MapPolylineOverlay,
    MapUserLocation,
} from "./mapTypes";

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
}: Props) {
  useLeafletAssets();

  const containerRef = useRef<View>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const hybridLabelsRef = useRef<L.TileLayer | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
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
      L.marker([p.lat, p.lng], { icon: markerIcon(p.tint), title: p.title })
        .bindPopup(popupHtml(p.title, p.subtitle))
        .addTo(group);
    }

    const ul = userLocRef.current;
    if (ul) {
      L.marker([ul.lat, ul.lng], { icon: userLocationIcon(), title: "You", zIndexOffset: 900 })
        .bindPopup(popupHtml("Your position", "Live GPS / geolocation"))
        .addTo(group);
    }
  };

  useEffect(() => {
    const el = containerRef.current as unknown as HTMLElement | null;
    if (!el) return;

    const map = L.map(el, { scrollWheelZoom: true, zoomControl: false }).setView([39.5, -120.2], 7);
    mapRef.current = map;
    L.control.zoom({ position: "bottomright" }).addTo(map);

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
      map.off("contextmenu", onCtx);
      map.off("click", onMapClick);
      map.off("moveend", emitCenter);
      map.off("zoomend", emitCenter);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
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
  }, [pins, polylines, polygons, userLocation]);

  useEffect(() => {
    if (flyTo == null) return;
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 10, { duration: 1.2 });
  }, [flyTo?.seq]);

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
