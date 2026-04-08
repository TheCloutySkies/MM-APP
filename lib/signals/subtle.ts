import { base64ToBytes, bytesToBase64, utf8, utf8decode } from "@/lib/crypto/bytes";

export type AesGcmB64BundleV1 = {
  v: 1;
  alg: "AES-256-GCM";
  kdf: "PBKDF2-SHA256";
  iter: number;
  saltB64: string;
  ivB64: string;
  ctB64: string;
};

function subtleOrThrow(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("window.crypto.subtle is not available in this environment.");
  return s;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export async function pbkdf2AesGcmKeyFromPassphrase(opts: {
  passphrase: string;
  salt: Uint8Array;
  iterations: number;
}): Promise<CryptoKey> {
  const subtle = subtleOrThrow();
  const base = await subtle.importKey("raw", toArrayBuffer(utf8(opts.passphrase)), "PBKDF2", false, ["deriveKey"]);
  return await subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(opts.salt),
      iterations: opts.iterations,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function aesGcmEncryptTextToBundle(opts: {
  passphrase: string;
  plaintext: string;
  iterations?: number;
}): Promise<AesGcmB64BundleV1> {
  const subtle = subtleOrThrow();
  const iterations = opts.iterations ?? 250_000;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await pbkdf2AesGcmKeyFromPassphrase({ passphrase: opts.passphrase, salt, iterations });
  const ct = await subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(utf8(opts.plaintext)));
  return {
    v: 1,
    alg: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iter: iterations,
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    ctB64: bytesToBase64(new Uint8Array(ct)),
  };
}

export async function aesGcmDecryptTextFromBundle(opts: {
  passphrase: string;
  bundleJson: string;
}): Promise<string> {
  const subtle = subtleOrThrow();
  let bundle: AesGcmB64BundleV1;
  try {
    bundle = JSON.parse(opts.bundleJson) as AesGcmB64BundleV1;
  } catch {
    throw new Error("Bundle is not valid JSON.");
  }
  if (!bundle || bundle.v !== 1 || bundle.alg !== "AES-256-GCM") {
    throw new Error("Unsupported bundle format.");
  }
  const salt = base64ToBytes(bundle.saltB64);
  const iv = base64ToBytes(bundle.ivB64);
  const ct = base64ToBytes(bundle.ctB64);
  const key = await pbkdf2AesGcmKeyFromPassphrase({
    passphrase: opts.passphrase,
    salt,
    iterations: bundle.iter,
  });
  try {
    const pt = await subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ct),
    );
    return utf8decode(new Uint8Array(pt));
  } catch {
    throw new Error("Decrypt failed (wrong passphrase or corrupted bundle).");
  }
}

export function b64FromArrayBuffer(buf: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buf));
}

export function arrayBufferFromB64(b64: string): ArrayBuffer {
  const u8 = base64ToBytes(b64);
  return toArrayBuffer(u8);
}

