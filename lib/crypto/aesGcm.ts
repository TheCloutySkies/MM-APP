import { gcm } from "@noble/ciphers/aes.js";
import { base64ToBytes, bytesToBase64, randomNonce12, utf8, utf8decode } from "./bytes";

export type AeadBundle = {
  nonceB64: string;
  cipherB64: string;
};

export function aes256GcmEncrypt(
  key32: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): AeadBundle {
  if (key32.length !== 32) throw new Error("AES-256 expects 32-byte key");
  const nonce = randomNonce12();
  const aes = gcm(key32, nonce, aad);
  const combined = aes.encrypt(plaintext);
  return { nonceB64: bytesToBase64(nonce), cipherB64: bytesToBase64(combined) };
}

export function aes256GcmDecrypt(
  key32: Uint8Array,
  bundle: AeadBundle,
  aad?: Uint8Array,
): Uint8Array {
  if (key32.length !== 32) throw new Error("AES-256 expects 32-byte key");
  const nonce = base64ToBytes(bundle.nonceB64);
  const combined = base64ToBytes(bundle.cipherB64);
  const aes = gcm(key32, nonce, aad);
  return aes.decrypt(combined);
}

export function encryptUtf8(key32: Uint8Array, text: string, aad?: string): string {
  const bundle = aes256GcmEncrypt(key32, utf8(text), aad ? utf8(aad) : undefined);
  return JSON.stringify(bundle);
}

export function decryptUtf8(key32: Uint8Array, json: string, aad?: string): string {
  const bundle = JSON.parse(json) as AeadBundle;
  const pt = aes256GcmDecrypt(key32, bundle, aad ? utf8(aad) : undefined);
  return utf8decode(pt);
}
