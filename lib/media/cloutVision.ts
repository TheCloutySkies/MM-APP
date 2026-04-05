import { stripImageMetadataIfJpeg } from "@/lib/metadata/stripExif";

/**
 * Offline media pipeline placeholder for CloutVision analysis.
 * Today: metadata scrub only. Extend with TFLite / CV when models are available.
 */
export function runCloutVisionPipeline(fileBytes: Uint8Array, mimeHint?: string): Uint8Array {
  if (mimeHint?.includes("jpeg") || mimeHint?.includes("jpg")) {
    return stripImageMetadataIfJpeg(fileBytes);
  }
  return stripImageMetadataIfJpeg(fileBytes);
}
