/** Closed MM roster — must match server-seeded mm_profiles.usernames. */
export const MM_ALLOWLIST = [
  "alpha-kilo",
  "charlie-sierra",
  "golf-lima",
  "kilo-mike",
  "echo-juliet",
  "golf-sierra",
  "mm-guest1",
  "mm-guest2",
] as const;

export type MMUsername = (typeof MM_ALLOWLIST)[number];

export function isAllowlistedUsername(u: string): boolean {
  const x = u.trim().toLowerCase();
  return (MM_ALLOWLIST as readonly string[]).includes(x);
}
