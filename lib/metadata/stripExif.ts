import piexif from "piexifjs";

import { base64ToBytes, bytesToBase64 } from "@/lib/crypto/bytes";

/**
 * Strip EXIF from JPEG bytes when possible; otherwise return original.
 * Runs fully offline (CloutVision hook point).
 */
export function stripImageMetadataIfJpeg(fileBytes: Uint8Array): Uint8Array {
  const head = String.fromCharCode(...fileBytes.slice(0, 2));
  if (head !== "\xff\xd8") return fileBytes;
  try {
    const b64 = bytesToBase64(fileBytes);
    const dataUrl = `data:image/jpeg;base64,${b64}`;
    const cleaned = piexif.remove(dataUrl);
    const stripped = cleaned.replace(/^data:image\/jpeg;base64,/, "");
    return base64ToBytes(stripped);
  } catch {
    return fileBytes;
  }
}
