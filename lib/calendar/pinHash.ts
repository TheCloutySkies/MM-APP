import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { utf8 } from "@/lib/crypto/bytes";

/** Client-only SHA-256(hex) of UTF-8 PIN for server profile comparison. */
export function pinHashHex(pin: string): string {
  return bytesToHex(sha256(utf8(pin)));
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
