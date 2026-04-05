import * as argon2 from "hash-wasm";

/** Derive a 32-byte key for AES-256 using Argon2id (memory-hard). */
export async function deriveKeyArgon2id(
  passwordUtf8: string,
  saltUtf8: string,
): Promise<Uint8Array> {
  const raw = await argon2.argon2id({
    password: passwordUtf8,
    salt: saltUtf8,
    parallelism: 4,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: "binary",
  });
  return new Uint8Array(raw);
}
