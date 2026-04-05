/**
 * Operational reporting payloads (encrypted at rest).
 * Decryption key: same as map markers — `resolveMapEncryptKey` + optional `EXPO_PUBLIC_MM_MAP_SHARED_KEY`.
 */

export type OpsDocKind = "mission_plan" | "sitrep" | "aar";

export const OPS_AAD = {
  mission_plan: "mm-ops-mission",
  sitrep: "mm-ops-sitrep",
  aar: "mm-ops-aar",
} as const;

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

export type AnyOpsPayload = MissionPlanPayloadV1 | SitrepPayloadV1 | AarPayloadV1;

export function parseMembersInput(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
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
