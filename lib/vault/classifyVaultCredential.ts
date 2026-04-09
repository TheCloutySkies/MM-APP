import * as aes from "@/lib/crypto/aesGcm";
import { utf8 } from "@/lib/crypto/bytes";
import { deriveKeyArgon2id } from "@/lib/crypto/kdf";
import { SK, secureGet } from "@/lib/secure/mmSecureStore";

/**
 * Classify master+PIN without unlocking the vault or mutating MM store.
 * Used for Activity Log gate + duress cover traffic.
 */
export async function classifyVaultCredential(
  masterPassword: string,
  pin: string,
): Promise<"primary" | "duress" | "fail"> {
  const saltMain = await secureGet(SK.saltMain);
  const saltDecoy = await secureGet(SK.saltDecoy);
  const wrapMainJson = await secureGet(SK.wrapMain);
  const wrapDecoyJson = await secureGet(SK.wrapDecoy);
  if (!saltMain || !saltDecoy || !wrapMainJson || !wrapDecoyJson) return "fail";

  const kMainTry = await deriveKeyArgon2id(masterPassword + pin, saltMain);
  const kDecoyTry = await deriveKeyArgon2id(masterPassword + pin, saltDecoy);
  let mainKey: Uint8Array | null = null;
  let decoyKey: Uint8Array | null = null;
  try {
    mainKey = aes.aes256GcmDecrypt(kMainTry, JSON.parse(wrapMainJson), utf8("mm-main-wrap"));
  } catch {
    mainKey = null;
  }
  try {
    decoyKey = aes.aes256GcmDecrypt(kDecoyTry, JSON.parse(wrapDecoyJson), utf8("mm-decoy-wrap"));
  } catch {
    decoyKey = null;
  }
  kMainTry.fill(0);
  kDecoyTry.fill(0);
  await new Promise((r) => setTimeout(r, 200));
  if (mainKey && decoyKey) {
    mainKey.fill(0);
    decoyKey.fill(0);
    return "fail";
  }
  if (mainKey) {
    mainKey.fill(0);
    return "primary";
  }
  if (decoyKey) {
    decoyKey.fill(0);
    return "duress";
  }
  return "fail";
}
