/**
 * P-384 ECDH + AES-256-GCM via Web Crypto (web PWA). Not available in native RN.
 */

export function isWebSubtleAvailable(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.crypto !== "undefined" &&
    !!globalThis.crypto.subtle
  );
}

function abToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function b64ToAb(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function generateP384Identity(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-384" }, true, ["deriveBits"]);
}

export async function exportPublicSpkiB64(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  return abToB64(spki);
}

export async function exportPrivatePkcs8(privateKey: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("pkcs8", privateKey);
}

export async function importPublicSpkiFromB64(spkiB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    b64ToAb(spkiB64),
    { name: "ECDH", namedCurve: "P-384" },
    false,
    [],
  );
}

export async function importPrivatePkcs8(pkcs8: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "ECDH", namedCurve: "P-384" },
    true,
    ["deriveBits"],
  );
}

export async function deriveAesGcmKeyFromEcdh(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  info: string,
): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    384,
  );
  const hkdfBase = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    hkdfBase,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function aesGcmEncryptUtf8(key: CryptoKey, plaintext: string): Promise<{ ivB64: string; ctB64: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  return { ivB64: abToB64(iv.buffer), ctB64: abToB64(ct) };
}

export async function aesGcmDecryptUtf8(key: CryptoKey, ivB64: string, ctB64: string): Promise<string> {
  const iv = new Uint8Array(b64ToAb(ivB64));
  const ct = b64ToAb(ctB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export async function aesGcmEncryptBytes(
  key: CryptoKey,
  plain: Uint8Array,
): Promise<{ ivB64: string; ctB64: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(plain));
  return { ivB64: abToB64(iv.buffer), ctB64: abToB64(ct) };
}

export async function aesGcmDecryptBytes(key: CryptoKey, ivB64: string, ctB64: string): Promise<Uint8Array> {
  const iv = new Uint8Array(b64ToAb(ivB64));
  const ct = b64ToAb(ctB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Uint8Array(pt);
}

/** PBKDF2 → AES-GCM key for wrapping PKCS#8 in local storage (PIN). */
export async function derivePinWrapKey(pin: string, profileId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const mat = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const salt = enc.encode(`mm-e2ee-pin-wrap|${profileId}`);
  const raw = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 120_000, hash: "SHA-256" },
    mat,
    256,
  );
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function wrapPrivatePkcs8WithPin(
  pin: string,
  profileId: string,
  pkcs8: ArrayBuffer,
): Promise<{ ivB64: string; ctB64: string }> {
  const k = await derivePinWrapKey(pin, profileId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, pkcs8);
  return { ivB64: abToB64(iv.buffer), ctB64: abToB64(ct) };
}

export async function unwrapPrivatePkcs8WithPin(
  pin: string,
  profileId: string,
  ivB64: string,
  ctB64: string,
): Promise<ArrayBuffer> {
  const k = await derivePinWrapKey(pin, profileId);
  const iv = new Uint8Array(b64ToAb(ivB64));
  const ct = b64ToAb(ctB64);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, ct);
}
