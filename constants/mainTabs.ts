/**
 * Main tab routes registered in `app/(app)/_layout.tsx` (visible rail — not `href: null` shells).
 */
export const MAIN_TAB_ROUTE_ORDER = [
  "home",
  "vault",
  "signals",
  "map",
  "reports",
  "missions",
  "calendar",
  "activity",
  "settings",
] as const;

export type MainTabRouteId = (typeof MAIN_TAB_ROUTE_ORDER)[number];

export const MAIN_TAB_LABEL: Record<MainTabRouteId, string> = {
  home: "Home",
  vault: "Vault",
  signals: "Ciphers",
  map: "Map",
  reports: "Reports",
  missions: "Missions",
  calendar: "Calendar",
  activity: "Activity",
  settings: "Settings",
};

export const MAIN_TAB_ROUTE_SET = new Set<string>(MAIN_TAB_ROUTE_ORDER);

export const MM_TAB_DRAG_MIME = "application/mm-main-tab";

export function isMainTabRouteId(id: string): id is MainTabRouteId {
  return MAIN_TAB_ROUTE_SET.has(id);
}

export function normalizeTabOrder(saved: string | null): MainTabRouteId[] {
  if (!saved) return [...MAIN_TAB_ROUTE_ORDER];
  try {
    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) return [...MAIN_TAB_ROUTE_ORDER];
    const seen = new Set<MainTabRouteId>();
    const out: MainTabRouteId[] = [];
    for (const x of parsed) {
      if (typeof x !== "string" || !isMainTabRouteId(x) || seen.has(x)) continue;
      seen.add(x);
      out.push(x);
    }
    for (const id of MAIN_TAB_ROUTE_ORDER) {
      if (!seen.has(id)) out.push(id);
    }
    return out;
  } catch {
    return [...MAIN_TAB_ROUTE_ORDER];
  }
}

/** Insert `dragged` immediately before `anchor` in order (both must be main tab ids). */
export function reorderTabBefore(
  order: MainTabRouteId[],
  dragged: MainTabRouteId,
  anchor: MainTabRouteId,
): MainTabRouteId[] {
  if (dragged === anchor) return [...order];
  const rest = order.filter((id) => id !== dragged);
  const idx = rest.indexOf(anchor);
  if (idx === -1) return [...rest, dragged];
  return [...rest.slice(0, idx), dragged, ...rest.slice(idx)];
}
