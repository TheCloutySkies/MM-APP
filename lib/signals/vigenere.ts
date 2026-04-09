/**
 * Classical Vigenère cipher (16th-century polyalphabetic substitution).
 *
 * This implements the standard repeating-keyword method over the Latin alphabet:
 * for each plaintext letter P and key letter K (both mapped to 0–25), the ciphertext
 * letter is (P + K) mod 26; decryption uses (C − K) mod 26.
 *
 * Rules (common convention used in field tools and textbooks):
 * - Only A–Z / a–z are transformed; all other characters are copied unchanged.
 * - The keyword is lowercased; non-letters are stripped from the keyword. If nothing
 *   remains, the plaintext is returned unchanged (no shifts).
 * - Key material advances only for letters that participate in the cipher (not for
 *   spaces, digits, or punctuation that are left as-is).
 * - Original letter case is preserved on output.
 *
 * Reference test vector (must round-trip with same keyword):
 *   vigenereEncrypt("ATTACKATDAWN", "LEMON") === "LXFOPVEFRNHR"
 *
 * This is not a stand-in (no XOR-with-hash, no Base64 masquerading as Vigenère).
 */

function transform(text: string, key: string, dir: 1 | -1): string {
  const k = key.toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return text;
  let j = 0;
  return text
    .split("")
    .map((ch) => {
      const code = ch.toLowerCase().charCodeAt(0);
      if (code < 97 || code > 122) return ch;
      const shift = k.charCodeAt(j % k.length) - 97;
      j++;
      const a = code - 97;
      const out = (a + dir * shift + 260) % 26;
      const next = String.fromCharCode(97 + out);
      return ch === ch.toUpperCase() ? next.toUpperCase() : next;
    })
    .join("");
}

export function vigenereEncrypt(plaintext: string, keyword: string): string {
  return transform(plaintext, keyword, 1);
}

export function vigenereDecrypt(ciphertext: string, keyword: string): string {
  return transform(ciphertext, keyword, -1);
}
