import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { decryptUtf8, encryptUtf8 } from "@/lib/crypto/aesGcm";
import { hexToBytes, utf8 } from "@/lib/crypto/bytes";

const PBKDF2_ITER = 250_000;
const AAD = "mm-calendar-v1";

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** Prefer Web Crypto PBKDF2 when available (prompt); Noble PBKDF2 on native. PBKDF2-HMAC-SHA256 → 32-byte AES key. */
export async function deriveCalendarAesKeyFromPin(pin: string, saltHex: string): Promise<Uint8Array> {
  const salt = hexToBytes(saltHex);
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.importKey === "function" && typeof subtle.deriveBits === "function") {
    const enc = new TextEncoder();
    const keyMaterial = await subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: toArrayBuffer(salt),
        iterations: PBKDF2_ITER,
        hash: "SHA-256",
      },
      keyMaterial,
      256,
    );
    return new Uint8Array(bits);
  }
  return pbkdf2Async(sha256, utf8(pin), salt, { c: PBKDF2_ITER, dkLen: 32 });
}

export function encryptCalendarPayloadJson(key32: Uint8Array, plain: unknown): string {
  return encryptUtf8(key32, JSON.stringify(plain), AAD);
}

export function decryptCalendarPayloadJson(key32: Uint8Array, payloadJson: string): unknown {
  const text = decryptUtf8(key32, payloadJson, AAD);
  return JSON.parse(text) as unknown;
}
