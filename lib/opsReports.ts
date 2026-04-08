/**
 * Operational reporting payloads (encrypted at rest).
 * Decryption key: same as map markers — `resolveMapEncryptKey` + optional `EXPO_PUBLIC_MM_MAP_SHARED_KEY`.
 */

export type OpsDocKind =
  | "mission_plan"
  | "sitrep"
  | "aar"
  | "target_package"
  | "intel_report";

export const OPS_AAD = {
  mission_plan: "mm-ops-mission",
  sitrep: "mm-ops-sitrep",
  aar: "mm-ops-aar",
  target_package: "mm-ops-target-pkg",
  intel_report: "mm-ops-intel",
} as const;

export const OPERATION_HUB_AAD = "mm-operation-hub-v1" as const;
export const BULLETIN_AAD = "mm-ops-bulletin-v1" as const;
/** Reply thread on mission_plan / other ops_reports rows (same decrypt key as map/ops). */
export const OPS_COMMENT_AAD = "mm-ops-comment-v1" as const;

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
  | IntelReportPayloadV1;

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
