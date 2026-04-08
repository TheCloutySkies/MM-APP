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

/** True if the string is safe to send to mm-login (server still validates roster). */
export function isLegacyRosterLoginInputAllowed(u: string): boolean {
  const x = u.trim().toLowerCase();
  if (!x) return false;
  if (isAllowlistedUsername(x)) return true;
  // Initials alias: ak → alpha-kilo (resolved server-side)
  if (!x.includes("-") && /^[a-z0-9]{2,8}$/.test(x)) return true;
  // Full kebab handle
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x)) return true;
  return false;
}
