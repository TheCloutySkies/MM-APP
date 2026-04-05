/**
 * Operational callsign rules for mm_profiles.username (display + team context).
 * Prefer NATO-style two-word handles or short codenames — not real names.
 */

export const CALLSIGN_MIN_LEN = 3;
export const CALLSIGN_MAX_LEN = 40;

/** Lowercase kebab-case: letters, digits, single hyphens between tokens. */
export const CALLSIGN_KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Suggested examples (user can pick any valid handle, not limited to this list). */
export const CALLSIGN_SUGGESTIONS = [
  "alpha-mike",
  "bravo-seven",
  "charlie-sierra",
  "delta-niner",
  "echo-route",
  "foxtrot-red",
  "romeo-shadow",
  "sierra-blue",
  "tango-watch",
  "vector-north",
] as const;

export const CALLSIGN_GUIDANCE =
  "Do not use your real name. Pick a NATO-style handle (two words from the alphabet, lower kebab-case) or a short codename. This is how you appear in MM — think callsign, not ID.";

export function normalizeCallsignInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * @returns Error message for UI, or null if valid.
 */
export function validateCallsign(s: string): string | null {
  if (s.length < CALLSIGN_MIN_LEN) {
    return `Use at least ${CALLSIGN_MIN_LEN} characters.`;
  }
  if (s.length > CALLSIGN_MAX_LEN) {
    return `Keep it under ${CALLSIGN_MAX_LEN} characters.`;
  }
  if (s.includes("@")) {
    return "Handles cannot be an email address.";
  }
  if (s.startsWith("pending-")) {
    return "That prefix is reserved by the system.";
  }
  if (!CALLSIGN_KEBAB.test(s)) {
    return "Use lowercase letters, numbers, and hyphens only (kebab-case). Example: charlie-sierra.";
  }
  return null;
}
