import { arrayBufferFromB64, b64FromArrayBuffer, randomBytes } from "@/lib/signals/subtle";

export type WhisperEnvelopeV1 = {
  v: 1;
  alg: "ECDH-P384+A256GCM";
  senderPubSpkiB64: string;
  ivB64: string;
  ctB64: string;
};

function subtleOrThrow(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("window.crypto.subtle unavailable.");
  return s;
}

export async function generateWhisperKeypair(): Promise<CryptoKeyPair> {
  const subtle = subtleOrThrow();
  return await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-384" },
    true,
    ["deriveKey", "deriveBits"],
  );
}

export async function exportPublicKeySpkiB64(publicKey: CryptoKey): Promise<string> {
  const subtle = subtleOrThrow();
  const spki = await subtle.exportKey("spki", publicKey);
  return b64FromArrayBuffer(spki);
}

export async function importPublicKeySpkiB64(spkiB64: string): Promise<CryptoKey> {
  const subtle = subtleOrThrow();
  const spki = arrayBufferFromB64(spkiB64.trim());
  return await subtle.importKey("spki", spki, { name: "ECDH", namedCurve: "P-384" }, true, []);
}

export async function exportPrivateKeyPkcs8(privateKey: CryptoKey): Promise<Uint8Array> {
  const subtle = subtleOrThrow();
  const pkcs8 = await subtle.exportKey("pkcs8", privateKey);
  return new Uint8Array(pkcs8);
}

export async function importPrivateKeyPkcs8(pkcs8Bytes: Uint8Array): Promise<CryptoKey> {
  const subtle = subtleOrThrow();
  const buf = pkcs8Bytes.buffer.slice(pkcs8Bytes.byteOffset, pkcs8Bytes.byteOffset + pkcs8Bytes.byteLength) as ArrayBuffer;
  return await subtle.importKey("pkcs8", buf, { name: "ECDH", namedCurve: "P-384" }, false, ["deriveKey"]);
}

async function deriveAesKeyFromEcdh(opts: { privateKey: CryptoKey; peerPublicKey: CryptoKey }): Promise<CryptoKey> {
  const subtle = subtleOrThrow();
  return await subtle.deriveKey(
    { name: "ECDH", public: opts.peerPublicKey },
    opts.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function whisperEncrypt(opts: {
  myPrivateKey: CryptoKey;
  myPublicKey: CryptoKey;
  peerPublicKeySpkiB64: string;
  plaintextUtf8: string;
}): Promise<WhisperEnvelopeV1> {
  const subtle = subtleOrThrow();
  const peer = await importPublicKeySpkiB64(opts.peerPublicKeySpkiB64);
  const key = await deriveAesKeyFromEcdh({ privateKey: opts.myPrivateKey, peerPublicKey: peer });
  const iv = randomBytes(12);
  const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const pt = new TextEncoder().encode(opts.plaintextUtf8);
  const ptBuf = pt.buffer.slice(pt.byteOffset, pt.byteOffset + pt.byteLength) as ArrayBuffer;
  const ct = await subtle.encrypt({ name: "AES-GCM", iv: ivBuf }, key, ptBuf);
  const senderPubSpkiB64 = await exportPublicKeySpkiB64(opts.myPublicKey);
  return {
    v: 1,
    alg: "ECDH-P384+A256GCM",
    senderPubSpkiB64,
    ivB64: b64FromArrayBuffer(ivBuf),
    ctB64: b64FromArrayBuffer(ct),
  };
}

export async function whisperDecrypt(opts: {
  myPrivateKey: CryptoKey;
  envelopeJson: string;
}): Promise<string> {
  const subtle = subtleOrThrow();
  let env: WhisperEnvelopeV1;
  try {
    env = JSON.parse(opts.envelopeJson) as WhisperEnvelopeV1;
  } catch {
    throw new Error("Envelope is not valid JSON.");
  }
  if (!env || env.v !== 1 || env.alg !== "ECDH-P384+A256GCM") throw new Error("Unsupported envelope.");
  const senderPub = await importPublicKeySpkiB64(env.senderPubSpkiB64);
  const key = await deriveAesKeyFromEcdh({ privateKey: opts.myPrivateKey, peerPublicKey: senderPub });
  const ivBuf = arrayBufferFromB64(env.ivB64);
  const ctBuf = arrayBufferFromB64(env.ctB64);
  try {
    const pt = await subtle.decrypt({ name: "AES-GCM", iv: ivBuf }, key, ctBuf);
    return new TextDecoder().decode(new Uint8Array(pt));
  } catch {
    throw new Error("Decrypt failed (wrong private key or corrupted message).");
  }
}

