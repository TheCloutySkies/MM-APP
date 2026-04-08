/** Encrypted team “blue force” snapshots (same AES key as map markers). */

export const TEAM_POSITION_AAD = "mm-team-position-v1" as const;

export type TeamPositionPayloadV1 = {
  v: 1;
  lat: number;
  lng: number;
  /** Optional horizontal accuracy in meters */
  accuracyM?: number;
  at: number;
};

/** Stable pin color from username (HSL). */
export function tintForUsername(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 72%, 52%)`;
}
