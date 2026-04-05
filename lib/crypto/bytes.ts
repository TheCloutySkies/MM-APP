import { randomBytes } from "@noble/hashes/utils.js";

export function randomNonce12(): Uint8Array {
  return randomBytes(12);
}

export function bytesToBase64(u8: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(u8).toString("base64");
  }
  let s = "";
  u8.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, "").replace(/\s/g, "");
  if (clean.length % 2 !== 0) throw new Error("Invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function utf8decode(u8: Uint8Array): string {
  return new TextDecoder().decode(u8);
}
