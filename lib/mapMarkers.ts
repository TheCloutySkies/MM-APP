import type { MapPin, MapPolygonOverlay, MapPolylineOverlay } from "@/components/map/mapTypes";

/** Militia / field-ops marker categories (Google Maps–style picker). */
export const TAC_CATEGORIES = [
  { id: "danger", label: "Danger / hazard" },
  { id: "police", label: "Police / LE" },
  { id: "rally_point", label: "Rally point" },
  { id: "enemy", label: "Enemy / OPFOR" },
  { id: "infrastructure", label: "Infrastructure" },
  { id: "checkpoint", label: "Checkpoint" },
  { id: "supply", label: "Supply / logistics" },
  { id: "observation", label: "Observation / OP" },
  { id: "movement", label: "Movement / route line" },
  { id: "barricade", label: "Barricade / block" },
  { id: "medical", label: "Medical / aid" },
  { id: "comms", label: "Comms / relay" },
  { id: "other", label: "Other" },
] as const;

export type TacCategoryId = (typeof TAC_CATEGORIES)[number]["id"];

export type TacticalGeometryKind = "point" | "route" | "zone";

/** Encrypted JSON stored in `map_markers.encrypted_payload` (v2). */
export type TacticalMapPayload = {
  v: 2;
  geom: TacticalGeometryKind;
  category: TacCategoryId;
  title?: string;
  notes?: string;
  coordinates: { lat: number; lng: number }[];
  droppedAt: number;
  staleHours?: number;
  createdBy: string;
};

export type TacticalLayers = {
  pins: MapPin[];
  polylines: MapPolylineOverlay[];
  polygons: MapPolygonOverlay[];
};

export function tacCategoryLabel(id: string): string {
  const row = TAC_CATEGORIES.find((c) => c.id === id);
  return row?.label ?? id;
}

export function tacCategoryTint(category: string): string {
  switch (category) {
    case "danger":
      return "#b91c1c";
    case "police":
      return "#1e3a8a";
    case "rally_point":
      return "#15803d";
    case "enemy":
      return "#7c2d12";
    case "infrastructure":
      return "#ca8a04";
    case "checkpoint":
      return "#6366f1";
    case "supply":
      return "#0d9488";
    case "observation":
      return "#64748b";
    case "movement":
      return "#2563eb";
    case "barricade":
      return "#4338ca";
    case "medical":
      return "#dc2626";
    case "comms":
      return "#0891b2";
    case "other":
    default:
      return "#475569";
  }
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) return `rgba(71,85,105,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function mapLegacyType(t: string): TacCategoryId {
  switch (t) {
    case "danger":
      return "danger";
    case "police":
      return "police";
    case "loot":
      return "supply";
    case "infra":
    case "infrastructure":
      return "infrastructure";
    case "rally":
      return "rally_point";
    case "enemy":
      return "enemy";
    case "self":
      return "other";
    default:
      return "other";
  }
}

/** Accept v2 payload or legacy `{ lat, lng, type, ... }` point rows. */
export function normalizeTacticalPayload(raw: unknown): TacticalMapPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  if (o.v === 2 && typeof o.geom === "string" && typeof o.category === "string") {
    const coords = o.coordinates;
    if (!Array.isArray(coords)) return null;
    const coordinates: { lat: number; lng: number }[] = [];
    for (const c of coords) {
      if (!c || typeof c !== "object") continue;
      const row = c as Record<string, unknown>;
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) coordinates.push({ lat, lng });
    }
    const geom = o.geom as TacticalGeometryKind;
    if (geom !== "point" && geom !== "route" && geom !== "zone") return null;
    if (geom === "point" && coordinates.length < 1) return null;
    if (geom === "route" && coordinates.length < 2) return null;
    if (geom === "zone" && coordinates.length < 3) return null;
    const droppedAt = Number(o.droppedAt);
    if (!Number.isFinite(droppedAt)) return null;
    const staleHours = o.staleHours != null ? Number(o.staleHours) : 24;
    return {
      v: 2,
      geom,
      category: (TAC_CATEGORIES.some((x) => x.id === o.category) ? o.category : "other") as TacCategoryId,
      title: typeof o.title === "string" ? o.title : undefined,
      notes: typeof o.notes === "string" ? o.notes : undefined,
      coordinates,
      droppedAt,
      staleHours: Number.isFinite(staleHours) ? staleHours : 24,
      createdBy: typeof o.createdBy === "string" ? o.createdBy : "Unknown",
    };
  }

  const lat = Number(o.lat);
  const lng = Number(o.lng);
  const typ = typeof o.type === "string" ? o.type : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !typ) return null;
  const droppedAt = Number(o.droppedAt);
  if (!Number.isFinite(droppedAt)) return null;
  const staleHours = o.staleHours != null ? Number(o.staleHours) : 24;
  return {
    v: 2,
    geom: "point",
    category: mapLegacyType(typ),
    title: typeof o.title === "string" ? o.title : undefined,
    notes: typeof o.notes === "string" ? o.notes : undefined,
    coordinates: [{ lat, lng }],
    droppedAt,
    staleHours: Number.isFinite(staleHours) ? staleHours : 24,
    createdBy: typeof o.createdBy === "string" ? o.createdBy : "Unknown",
  };
}

export function formatCreatorSubtitle(createdBy: string, notes?: string): string | undefined {
  const by = `By ${createdBy}`;
  if (notes?.trim()) return `${by}\n${notes.trim()}`;
  return by;
}

export function tacticPayloadToLayers(
  rowId: string,
  payload: TacticalMapPayload,
  stale: boolean,
): TacticalLayers {
  const tint = tacCategoryTint(payload.category);
  const head = payload.title?.trim() || tacCategoryLabel(payload.category);
  const staleS = stale ? " (stale)" : "";
  const title = `${head}${staleS}`;
  const subtitle = formatCreatorSubtitle(payload.createdBy, payload.notes);
  const pinTint = stale ? "#ca6702" : tint;

  if (payload.geom === "point") {
    const c = payload.coordinates[0];
    return {
      pins: [
        {
          id: rowId,
          lat: c.lat,
          lng: c.lng,
          title,
          subtitle,
          tint: pinTint,
        },
      ],
      polylines: [],
      polygons: [],
    };
  }

  if (payload.geom === "route") {
    const coordinates = payload.coordinates.map((x) => ({
      latitude: x.lat,
      longitude: x.lng,
    }));
    return {
      pins: [],
      polylines: [{ id: rowId, coordinates, color: tint, title, subtitle }],
      polygons: [],
    };
  }

  const ring = payload.coordinates.map((x) => ({
    latitude: x.lat,
    longitude: x.lng,
  }));
  /** RN / many renderers expect closed ring */
  if (ring.length >= 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a.latitude !== b.latitude || a.longitude !== b.longitude) {
      ring.push({ latitude: a.latitude, longitude: a.longitude });
    }
  }
  return {
    pins: [],
    polylines: [],
    polygons: [
      {
        id: rowId,
        coordinates: ring,
        strokeColor: tint,
        fillColor: hexToRgba(tint, 0.22),
        title,
        subtitle,
      },
    ],
  };
}

export function buildTacticalPayload(
  geom: TacticalGeometryKind,
  category: TacCategoryId,
  coordinates: { lat: number; lng: number }[],
  createdBy: string,
  opts?: { title?: string; notes?: string; staleHours?: number },
): TacticalMapPayload {
  const droppedAt = Date.now();
  return {
    v: 2,
    geom,
    category,
    coordinates,
    droppedAt,
    staleHours: opts?.staleHours ?? 48,
    createdBy,
    title: opts?.title,
    notes: opts?.notes,
  };
}
