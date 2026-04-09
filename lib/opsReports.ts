/**
 * Operational reporting payloads (encrypted at rest).
 * Decryption key: same as map markers — `resolveMapEncryptKey` + optional `EXPO_PUBLIC_MM_MAP_SHARED_KEY`.
 */

import { decryptUtf8 } from "./crypto/aesGcm";

/** Shown when no candidate key decrypts ciphertext (Settings team key + env + vault partitions). */
export const OPS_TEAM_DECRYPT_HELP = `This item is encrypted end-to-end. None of the keys on this device could open it.

If your unit shares one operations key: open Settings → Team operations key and paste the same 64-character hex (only 0–9 and a–f) that everyone else uses. That matches map markers and all mission hub reports.

If your build already embeds EXPO_PUBLIC_MM_MAP_SHARED_KEY, it must be identical to the key the author used when they saved.

If the author encrypted using only their personal vault (no shared team key), only someone with that same vault material can read it. Ask them to save again using the unit shared key so the whole team can open it.`;

/** Try AES-GCM decrypt with each 32-byte key until one succeeds. */
export function tryDecryptUtf8WithKeys(ciphertext: string, aad: string, keys: Uint8Array[]): string | null {
  for (const key of keys) {
    if (key.length !== 32) continue;
    try {
      return decryptUtf8(key, ciphertext, aad);
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

export type OpsDocKind =
  | "mission_plan"
  | "sitrep"
  | "aar"
  | "target_package"
  | "intel_report"
  | "spotrep"
  | "medevac_nine_line"
  | "route_recon";

export const OPS_AAD = {
  mission_plan: "mm-ops-mission",
  sitrep: "mm-ops-sitrep",
  aar: "mm-ops-aar",
  target_package: "mm-ops-target-pkg",
  intel_report: "mm-ops-intel",
  spotrep: "mm-ops-spotrep",
  medevac_nine_line: "mm-ops-medevac-9",
  route_recon: "mm-ops-route-recon",
} as const;

export const OPERATION_HUB_AAD = "mm-operation-hub-v1" as const;
export const BULLETIN_AAD = "mm-ops-bulletin-v1" as const;
/** Reply thread on mission_plan / other ops_reports rows (same decrypt key as map/ops). */
export const OPS_COMMENT_AAD = "mm-ops-comment-v1" as const;
/** Sand Table isolated editor exports (same decrypt material as map / ops when embedded in route recon). */
export const SAND_TABLE_GEOJSON_AAD = "mm-sand-table-geojson-v1" as const;
export const SAND_TABLE_PNG_AAD = "mm-sand-table-png-v1" as const;

export type OpsCommentPayloadV1 = {
  v: 1;
  body: string;
  createdAt: number;
};
export const GEAR_LOADOUT_AAD = "mm-gear-loadout-v1" as const;
export const VAULT_FOLDER_NAME_AAD = "mm-vault-folder-name-v1" as const;

export type ExerciseNature = "live_operation" | "patrol" | "training_exercise" | "other";

export type MissionPlanPayloadV1 = {
  v: 1;
  kind: "mission_plan";
  title: string;
  /** AO, grids, named areas, link to map, etc. */
  locations: string;
  operationType: string;
  enemySizeDisposition: string;
  formationTaskOrg: string;
  infrastructureNotes: string;
  weaponryEquipment: string;
  exerciseNature: ExerciseNature;
  exerciseNatureDetail?: string;
  /** Callsigns / roster IDs required (e.g. Charlie, Sierra, Alpha Kilo) */
  requiredMembers: string[];
  notes?: string;
  createdAt: number;
};

export type SitrepPayloadV1 = {
  v: 1;
  kind: "sitrep";
  reportDatetime: string;
  reportingUnit: string;
  location: string;
  situationOverview: string;
  enemyForcesActivity?: string;
  friendlyForcesStatus?: string;
  sustainmentAdmin?: string;
  personnelStatus?: string;
  equipmentStatus?: string;
  weather?: string;
  commandersAssessment?: string;
  remarks?: string;
  classification?: string;
  preparedBy: string;
  relatedMissionTitle?: string;
};

export type AarPayloadV1 = {
  v: 1;
  kind: "aar";
  operationTitle: string;
  dateRange: string;
  missionObjectives: string;
  intentSummary: string;
  executionWhatOccurred: string;
  strengthsObserved: string;
  deficienciesObserved: string;
  lessonsLearned: string;
  recommendations: string;
  sustainmentNotes?: string;
  preparedBy: string;
};

export type OperationHubPayloadV1 = {
  v: 1;
  kind: "operation_hub";
  title: string;
  codename?: string;
  notes?: string;
  createdAt: number;
};

export type TargetPackagePayloadV1 = {
  v: 1;
  kind: "target_package";
  objectiveName: string;
  coordinates: string;
  infilRoutes: string;
  exfilRoutes: string;
  hvtDescription: string;
  commPlan: string;
  carverNotes?: string;
  createdAt: number;
};

export type IntelReportBranch = "area" | "observed_activity" | "individuals";

export type IntelReportPayloadV1 = {
  v: 1;
  kind: "intel_report";
  branch: IntelReportBranch;
  title: string;
  terrain?: string;
  weatherImpact?: string;
  keyInfrastructure?: string;
  saluteSize?: string;
  saluteActivity?: string;
  saluteLocation?: string;
  saluteUnit?: string;
  saluteTime?: string;
  saluteEquipment?: string;
  physicalDescription?: string;
  affiliations?: string;
  threatLevel?: string;
  remarks?: string;
  createdAt: number;
};

/** SPOTREP — SALUTE activity (dropdown). */
export type SpotrepActivityId =
  | "stationary"
  | "moving_n"
  | "moving_s"
  | "moving_e"
  | "moving_w"
  | "patrol"
  | "occupying"
  | "defending";

export const SPOTREP_ACTIVITY_CHOICES: { id: SpotrepActivityId; label: string }[] = [
  { id: "stationary", label: "Stationary" },
  { id: "moving_n", label: "Moving N" },
  { id: "moving_s", label: "Moving S" },
  { id: "moving_e", label: "Moving E" },
  { id: "moving_w", label: "Moving W" },
  { id: "patrol", label: "Patrol" },
  { id: "occupying", label: "Occupying" },
  { id: "defending", label: "Defending" },
];

export function spotrepActivityLabel(id: string): string {
  const row = SPOTREP_ACTIVITY_CHOICES.find((c) => c.id === id);
  return row?.label ?? id;
}

export type SpotrepPayloadV1 = {
  v: 1;
  kind: "spotrep";
  saluteSize: string;
  saluteActivity: SpotrepActivityId | string;
  saluteLocation: string;
  saluteUnit: string;
  saluteTime: string;
  saluteEquipment: string;
  assessment: string;
  createdAt: number;
};

export type MedevacSpecialEquipment = "none" | "hoist" | "extraction" | "ventilator";

export const MEDEVAC_SPECIAL_EQUIPMENT_CHOICES: { id: MedevacSpecialEquipment; label: string }[] = [
  { id: "none", label: "None" },
  { id: "hoist", label: "Hoist" },
  { id: "extraction", label: "Extraction equipment" },
  { id: "ventilator", label: "Ventilator" },
];

export type MedevacNineLinePayloadV1 = {
  v: 1;
  kind: "medevac_nine_line";
  line1_location: string;
  line2_callsignFreq: string;
  line3_urgent: number;
  line3_priority: number;
  line3_routine: number;
  line4_specialEquipment: MedevacSpecialEquipment;
  line5_litter: number;
  line5_ambulatory: number;
  line6_securityAtPickup?: string;
  line7_markingMethod?: string;
  line8_nationalityStatus?: string;
  line9_nbCbrn?: string;
  createdAt: number;
};

export type RouteReconMarkerKind = "bridge" | "choke" | "comm_zone";

export type RouteReconBridgeMarker = {
  kind: "bridge";
  id: string;
  lat: number;
  lng: number;
  mgrs?: string;
  weightLimit?: string;
  heightClearance?: string;
  notes?: string;
};

export type RouteReconChokeMarker = {
  kind: "choke";
  id: string;
  lat: number;
  lng: number;
  mgrs?: string;
  description?: string;
};

export type RouteReconCommMarker = {
  kind: "comm_zone";
  id: string;
  lat: number;
  lng: number;
  mgrs?: string;
  /** Green = good, yellow = marginal, red = dead. */
  signalStrength: "good" | "marginal" | "dead";
  notes?: string;
};

export type RouteReconMarkerV1 = RouteReconBridgeMarker | RouteReconChokeMarker | RouteReconCommMarker;

export type RouteReconPayloadV1 = {
  v: 1;
  kind: "route_recon";
  routeName: string;
  startMgrs: string;
  endMgrs: string;
  markers: RouteReconMarkerV1[];
  createdAt: number;
  /** AES-GCM JSON bundle (see `encryptUtf8`) of a GeoJSON FeatureCollection from the Sand Table editor. */
  sandTableGeoJsonCipher?: string;
  /** AES-GCM JSON bundle of a PNG data URL (`data:image/png;base64,...`) snapshot of the sand table map view. */
  sandTablePngCipher?: string;
};

export type BulletinPostPayloadV1 = {
  v: 1;
  title: string;
  body: string;
  createdAt: number;
};

export type GearLineItem = { id: string; label: string; packed?: boolean };

export const GEAR_LOADOUT_TYPES = [
  { id: "vehicles", label: "Vehicles" },
  { id: "weapons", label: "Weapons" },
  { id: "bugout", label: "Bug-out" },
  { id: "stashes", label: "Stashes" },
  { id: "kit", label: "Kit" },
  { id: "sustainment", label: "Sustainment" },
] as const;

export type GearLoadoutTypeId = (typeof GEAR_LOADOUT_TYPES)[number]["id"];

/** Legacy on-disk shape; new saves use v2 fields via normalizeGearLoadoutPayload. */
export type GearLoadoutPayloadV1 = {
  v: 1;
  name: string;
  line1: GearLineItem[];
  line2: GearLineItem[];
  line3: GearLineItem[];
  createdAt: number;
};

export type GearLoadoutPayloadV2 = {
  v: 2;
  loadoutType: GearLoadoutTypeId;
  name: string;
  /** Person who owns / prepared this list (shown to the whole team). */
  preparedByName: string;
  line1: GearLineItem[];
  line2: GearLineItem[];
  line3: GearLineItem[];
  createdAt: number;
};

export function gearLoadoutTypeLabel(id: string): string {
  const row = GEAR_LOADOUT_TYPES.find((t) => t.id === id);
  return row?.label ?? id;
}

function coerceLines(x: unknown): GearLineItem[] {
  if (!Array.isArray(x)) return [];
  return x.filter((i) => i && typeof i === "object") as GearLineItem[];
}

/** Normalize v1 or v2 encrypted JSON to a v2-shaped object for UI. */
export function normalizeGearLoadoutPayload(raw: unknown, fallbackAuthor: string): GearLoadoutPayloadV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const line1 = coerceLines(o.line1);
  const line2 = coerceLines(o.line2);
  const line3 = coerceLines(o.line3);
  const name = typeof o.name === "string" ? o.name : "Loadout";
  const createdAt = typeof o.createdAt === "number" ? o.createdAt : Date.now();

  if (o.v === 2) {
    const lt = typeof o.loadoutType === "string" ? o.loadoutType : "kit";
    const loadoutType = (GEAR_LOADOUT_TYPES.some((t) => t.id === lt) ? lt : "kit") as GearLoadoutTypeId;
    return {
      v: 2,
      loadoutType,
      name,
      preparedByName: typeof o.preparedByName === "string" && o.preparedByName.trim() ? o.preparedByName.trim() : fallbackAuthor,
      line1,
      line2,
      line3,
      createdAt,
    };
  }

  if (o.v === 1) {
    return {
      v: 2,
      loadoutType: "kit",
      name,
      preparedByName: fallbackAuthor,
      line1,
      line2,
      line3,
      createdAt,
    };
  }

  return null;
}

export type AnyOpsPayload =
  | MissionPlanPayloadV1
  | SitrepPayloadV1
  | AarPayloadV1
  | TargetPackagePayloadV1
  | IntelReportPayloadV1
  | SpotrepPayloadV1
  | MedevacNineLinePayloadV1
  | RouteReconPayloadV1;

export function parseMembersInput(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Human label for list rows (avoid raw snake_case in UI). */
export function formatDocKindLabel(kind: OpsDocKind): string {
  switch (kind) {
    case "mission_plan":
      return "Mission plan";
    case "sitrep":
      return "SITREP";
    case "aar":
      return "After action report";
    case "target_package":
      return "Target package";
    case "intel_report":
      return "Intel report";
    case "spotrep":
      return "SPOTREP";
    case "medevac_nine_line":
      return "9-line MEDEVAC";
    case "route_recon":
      return "Route recon";
    default:
      return kind;
  }
}

export function previewOpsRow(kind: OpsDocKind, decryptedJson: string): string {
  try {
    const o = JSON.parse(decryptedJson) as Record<string, unknown>;
    switch (kind) {
      case "mission_plan":
        return String(o.title ?? "Mission plan");
      case "sitrep": {
        const u = o.reportingUnit ? String(o.reportingUnit) : "";
        const loc = o.location ? String(o.location) : "";
        return [u, loc].filter(Boolean).join(" · ") || "SITREP";
      }
      case "aar":
        return String(o.operationTitle ?? "After action report");
      case "target_package":
        return String(o.objectiveName ?? "Target package");
      case "intel_report":
        return String(o.title ?? "Intel report");
      case "spotrep": {
        const loc = o.saluteLocation ? String(o.saluteLocation) : "";
        const t = o.saluteTime ? String(o.saluteTime) : "";
        return [loc, t].filter(Boolean).join(" · ") || "SPOTREP";
      }
      case "medevac_nine_line":
        return String(o.line1_location ?? "9-line MEDEVAC");
      case "route_recon":
        return String(o.routeName ?? "Route recon");
      default:
        return kind;
    }
  } catch {
    return "(payload)";
  }
}

export function formatMissionForDisplay(p: MissionPlanPayloadV1): string {
  const lines = [
    `TITLE: ${p.title}`,
    `LOCATIONS / AO: ${p.locations}`,
    `OPERATION TYPE: ${p.operationType}`,
    `EXERCISE / CONTEXT: ${p.exerciseNature}${p.exerciseNatureDetail ? ` — ${p.exerciseNatureDetail}` : ""}`,
    `ENEMY (SIZE / DISPO): ${p.enemySizeDisposition}`,
    `FORMATION / TASK ORG: ${p.formationTaskOrg}`,
    `INFRASTRUCTURE: ${p.infrastructureNotes}`,
    `WEAPONS / EQUIPMENT: ${p.weaponryEquipment}`,
    `REQUIRED: ${p.requiredMembers.join(", ") || "—"}`,
    p.notes ? `NOTES: ${p.notes}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export function formatSitrepForDisplay(p: SitrepPayloadV1): string {
  const lines = [
    p.classification ? `CLASSIFICATION: ${p.classification}` : "",
    `TIME: ${p.reportDatetime}`,
    `UNIT: ${p.reportingUnit}`,
    `LOCATION: ${p.location}`,
    `SITUATION: ${p.situationOverview}`,
    p.enemyForcesActivity ? `ENEMY: ${p.enemyForcesActivity}` : "",
    p.friendlyForcesStatus ? `FRIENDLY: ${p.friendlyForcesStatus}` : "",
    p.sustainmentAdmin ? `SUSTAINMENT: ${p.sustainmentAdmin}` : "",
    p.personnelStatus ? `PERSONNEL: ${p.personnelStatus}` : "",
    p.equipmentStatus ? `EQUIPMENT: ${p.equipmentStatus}` : "",
    p.weather ? `WEATHER: ${p.weather}` : "",
    p.commandersAssessment ? `ASSESSMENT: ${p.commandersAssessment}` : "",
    p.remarks ? `REMARKS: ${p.remarks}` : "",
    `PREPARED BY: ${p.preparedBy}`,
    p.relatedMissionTitle ? `RELATED MISSION: ${p.relatedMissionTitle}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export function formatAarForDisplay(p: AarPayloadV1): string {
  const lines = [
    `OPERATION: ${p.operationTitle}`,
    `DATES: ${p.dateRange}`,
    `MISSION OBJECTIVES: ${p.missionObjectives}`,
    `INTENT: ${p.intentSummary}`,
    `EXECUTION: ${p.executionWhatOccurred}`,
    `STRENGTHS: ${p.strengthsObserved}`,
    `DEFICIENCIES: ${p.deficienciesObserved}`,
    `LESSONS LEARNED: ${p.lessonsLearned}`,
    `RECOMMENDATIONS: ${p.recommendations}`,
    p.sustainmentNotes ? `SUSTAINMENT: ${p.sustainmentNotes}` : "",
    `PREPARED BY: ${p.preparedBy}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function formatTargetPackageForDisplay(p: TargetPackagePayloadV1): string {
  return [
    `OBJECTIVE: ${p.objectiveName}`,
    `COORDINATES: ${p.coordinates}`,
    `INFIL: ${p.infilRoutes}`,
    `EXFIL: ${p.exfilRoutes}`,
    `HVT: ${p.hvtDescription}`,
    `COMM PLAN: ${p.commPlan}`,
    p.carverNotes ? `CARVER / NOTES: ${p.carverNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatIntelReportForDisplay(p: IntelReportPayloadV1): string {
  const head = [`BRANCH: ${p.branch}`, `TITLE: ${p.title}`];
  if (p.branch === "area") {
    head.push(
      `TERRAIN: ${p.terrain ?? "—"}`,
      `WEATHER IMPACT: ${p.weatherImpact ?? "—"}`,
      `INFRASTRUCTURE: ${p.keyInfrastructure ?? "—"}`,
    );
  } else if (p.branch === "observed_activity") {
    head.push(
      `S: ${p.saluteSize ?? "—"}`,
      `A: ${p.saluteActivity ?? "—"}`,
      `L: ${p.saluteLocation ?? "—"}`,
      `U: ${p.saluteUnit ?? "—"}`,
      `T: ${p.saluteTime ?? "—"}`,
      `E: ${p.saluteEquipment ?? "—"}`,
    );
  } else {
    head.push(
      `DESCRIPTION: ${p.physicalDescription ?? "—"}`,
      `AFFILIATIONS: ${p.affiliations ?? "—"}`,
      `THREAT: ${p.threatLevel ?? "—"}`,
    );
  }
  if (p.remarks) head.push(`REMARKS: ${p.remarks}`);
  return head.join("\n");
}

export function formatSpotrepForDisplay(p: SpotrepPayloadV1): string {
  const act = spotrepActivityLabel(String(p.saluteActivity));
  return [
    "SPOTREP (SALUTE)",
    `[S]IZE: ${p.saluteSize || "—"}`,
    `[A]CTIVITY: ${act}`,
    `[L]OCATION: ${p.saluteLocation || "—"}`,
    `[U]NIT / UNIFORM: ${p.saluteUnit || "—"}`,
    `[T]IME (DTG): ${p.saluteTime || "—"}`,
    `[E]QUIPMENT: ${p.saluteEquipment || "—"}`,
    "",
    `ASSESSMENT: ${p.assessment || "—"}`,
  ].join("\n");
}

export function formatMedevacNineLineForDisplay(p: MedevacNineLinePayloadV1): string {
  const spec =
    MEDEVAC_SPECIAL_EQUIPMENT_CHOICES.find((x) => x.id === p.line4_specialEquipment)?.label ??
    p.line4_specialEquipment;
  return [
    "9-LINE MEDEVAC",
    `1. Location: ${p.line1_location || "—"}`,
    `2. Callsign / freq: ${p.line2_callsignFreq || "—"}`,
    `3. Precedence — Urgent: ${p.line3_urgent} · Priority: ${p.line3_priority} · Routine: ${p.line3_routine}`,
    `4. Special equipment: ${spec}`,
    `5. Patients — Litter: ${p.line5_litter} · Ambulatory: ${p.line5_ambulatory}`,
    p.line6_securityAtPickup ? `6. Security at pickup: ${p.line6_securityAtPickup}` : "6. Security at pickup: —",
    p.line7_markingMethod ? `7. Marking method: ${p.line7_markingMethod}` : "7. Marking method: —",
    p.line8_nationalityStatus ? `8. Nationality / status: ${p.line8_nationalityStatus}` : "8. Nationality / status: —",
    p.line9_nbCbrn ? `9. NBC / CBRN: ${p.line9_nbCbrn}` : "9. NBC / CBRN: —",
  ].join("\n");
}

function routeReconMarkerSummary(m: RouteReconMarkerV1): string {
  const grid = m.mgrs?.trim() ? m.mgrs : `${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}`;
  if (m.kind === "bridge") {
    const w = m.weightLimit?.trim() ? ` · W limit ${m.weightLimit}` : "";
    const h = m.heightClearance?.trim() ? ` · H clr ${m.heightClearance}` : "";
    return `Bridge @ ${grid}${w}${h}`;
  }
  if (m.kind === "choke") {
    return `Hazard / choke @ ${grid}${m.description ? ` — ${m.description}` : ""}`;
  }
  return `Comm (${m.signalStrength}) @ ${grid}${m.notes ? ` — ${m.notes}` : ""}`;
}

export function formatRouteReconForDisplay(p: RouteReconPayloadV1): string {
  const head = [
    "ROUTE RECONNAISSANCE",
    `ROUTE / ID: ${p.routeName || "—"}`,
    `START: ${p.startMgrs || "—"}`,
    `END: ${p.endMgrs || "—"}`,
  ];
  if (p.markers?.length) {
    head.push("", "MARKERS:");
    p.markers.forEach((m, i) => head.push(`  ${i + 1}. ${routeReconMarkerSummary(m)}`));
  }
  if (p.sandTableGeoJsonCipher) {
    head.push("", "SAND TABLE: encrypted GeoJSON plan attached");
  }
  if (p.sandTablePngCipher) {
    head.push("SAND TABLE: encrypted PNG snapshot attached");
  }
  return head.join("\n");
}

/** Zulu DTG commonly written as DDHHMMzMONYY (e.g.081430zAPR26). */
export function formatZuluDtg(d = new Date()): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()];
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${day}${hh}${mm}z${mon}${yy}`;
}
