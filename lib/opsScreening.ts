/** Final screening after vault unlock: fill-in-the-blank (case-insensitive). */
export const OPS_SCREENING_ANSWER_NORMALIZED = "farted";

/**
 * 32-byte AES key (64 hex) granted to every user who passes the screening prompt.
 * Same value should be used server-side / in EXPO_PUBLIC_MM_MAP_SHARED_KEY if you inject it for builds.
 */
export const SCREENING_REWARD_TEAM_KEY_HEX =
  "ee1eafbc2a5e553b83e10c2e7ff358b7f69bd2349bb04a7b0d2d1fab024e8702" as const;

export function normalizeOpsScreeningInput(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isOpsScreeningAnswerCorrect(raw: string): boolean {
  return normalizeOpsScreeningInput(raw) === OPS_SCREENING_ANSWER_NORMALIZED;
}
