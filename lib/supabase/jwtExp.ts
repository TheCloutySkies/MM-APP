/** Client-side JWT `exp` read (no verification). Used to avoid noisy 401s when the token is already stale. */

import { base64ToBytes } from "@/lib/crypto/bytes";

const LEEWAY_SEC = 60;

function base64UrlPayloadToUtf8(payloadB64Url: string): string {
  const pad = "=".repeat((4 - (payloadB64Url.length % 4)) % 4);
  const b64 = (payloadB64Url + pad).replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob !== "undefined") {
    return atob(b64);
  }
  return new TextDecoder().decode(base64ToBytes(b64));
}

export function jwtExpUnixSeconds(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const json = base64UrlPayloadToUtf8(parts[1]!);
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

export function isJwtExpired(token: string, leewaySec = LEEWAY_SEC): boolean {
  const exp = jwtExpUnixSeconds(token);
  if (exp == null) return false;
  return Math.floor(Date.now() / 1000) >= exp - leewaySec;
}
