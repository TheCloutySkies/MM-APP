import L from "leaflet";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";

import type { MapFlyToRequest, MapPin, MapPolygonOverlay, MapPolylineOverlay } from "./mapTypes";

type Props = {
  pins: MapPin[];
  polylines?: MapPolylineOverlay[];
  polygons?: MapPolygonOverlay[];
  onLongPress?: (lat: number, lng: number) => void;
  /** Single-tap (e.g. drawing routes/zones). */
  onPress?: (lat: number, lng: number) => void;
  flyTo?: MapFlyToRequest | null;
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

function TacticalMapLeaflet({
  pins,
  polylines = [],
  polygons = [],
  onLongPress,
  onPress,
  flyTo,
}: Props) {
  useLeafletAssets();

  const containerRef = useRef<View>(null);
  const mapRef = useRef<L.Map | null>(null);
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
  };

  useEffect(() => {
    const el = containerRef.current as unknown as HTMLElement | null;
    if (!el) return;

    const map = L.map(el, { scrollWheelZoom: true }).setView([39.5, -120.2], 7);
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    paintAll();

    const onCtx = (e: L.LeafletMouseEvent) => {
      onLongPressRef.current?.(e.latlng.lat, e.latlng.lng);
    };
    map.on("contextmenu", onCtx);

    const onMapClick = (e: L.LeafletMouseEvent) => {
      onPressRef.current?.(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", onMapClick);

    const t = requestAnimationFrame(() => {
      map.invalidateSize();
    });

    return () => {
      cancelAnimationFrame(t);
      map.off("contextmenu", onCtx);
      map.off("click", onMapClick);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    paintAll();
  }, [pins, polylines, polygons]);

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
  fill: { flex: 1, minHeight: 0, width: "100%" },
});

export { TacticalMapLeaflet };
export default TacticalMapLeaflet;
