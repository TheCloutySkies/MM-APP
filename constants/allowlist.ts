/** Legacy team login only (access key flow). Email/password accounts do not use this list. */
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
