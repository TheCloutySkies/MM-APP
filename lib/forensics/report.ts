import piexif from "piexifjs";

import { bytesToBase64 } from "@/lib/crypto/bytes";
import { runCloutVisionPipeline } from "@/lib/media/cloutVision";

export type ForensicsReport = {
  fileName: string;
  byteLength: number;
  mimeGuess: string;
  magic: string;
  sha256Hex: string;
  imageSize: { width: number; height: number } | null;
  /** Shannon entropy of raw bytes (0–8); high ≈ compressed/encrypted/random. */
  shannonEntropyBits: number;
  /** First 48 bytes as hex (for manual inspection). */
  hexHead: string;
  utf8Status: "valid" | "invalid" | "empty";
  printableAsciiRatio: number;
  exifSummary: {
    hasExif: boolean;
    hasGps: boolean;
    segmentKeys: string[];
    /** Redacted: counts only */
    tagCounts: Record<string, number>;
  };
};

function shannonEntropyBits(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]!] += 1;
  let e = 0;
  const n = bytes.length;
  for (let b = 0; b < 256; b++) {
    const c = counts[b];
    if (c === 0) continue;
    const p = c / n;
    e -= p * Math.log2(p);
  }
  return e;
}

function hexPrefix(bytes: Uint8Array, max = 48): string {
  const slice = bytes.slice(0, Math.min(max, bytes.length));
  return Array.from(slice, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

function sniffMagic(bytes: Uint8Array): { label: string; mime: string } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { label: "JPEG", mime: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { label: "PNG", mime: "image/png" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { label: "PDF", mime: "application/pdf" };
  }
  if (bytes.length >= 12 && bytes.slice(4, 8).every((b, i) => "RIFF".charCodeAt(i) === b)) {
    return { label: "RIFF/WebP?", mime: "application/octet-stream" };
  }
  return { label: "Unknown", mime: "application/octet-stream" };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function tryImageBitmapSize(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const bmp = await createImageBitmap(blob);
    const w = bmp.width;
    const h = bmp.height;
    bmp.close();
    return { width: w, height: h };
  } catch {
    return null;
  }
}

function summarizeExifFromJpeg(bytes: Uint8Array): ForensicsReport["exifSummary"] {
  const empty: ForensicsReport["exifSummary"] = {
    hasExif: false,
    hasGps: false,
    segmentKeys: [],
    tagCounts: {},
  };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return empty;
  try {
    const b64 = bytesToBase64(bytes);
    const dataUrl = `data:image/jpeg;base64,${b64}`;
    const obj = (piexif as unknown as { load: (url: string) => Record<string, unknown> }).load(dataUrl);
    const segmentKeys = Object.keys(obj).filter((k) => k !== "thumbnail");
    const tagCounts: Record<string, number> = {};
    for (const key of segmentKeys) {
      const seg = obj[key];
      if (seg && typeof seg === "object") {
        tagCounts[key] = Object.keys(seg as object).length;
      }
    }
    const hasGps = Object.prototype.hasOwnProperty.call(obj, "GPS") && tagCounts.GPS > 0;
    return {
      hasExif: segmentKeys.length > 0,
      hasGps,
      segmentKeys,
      tagCounts,
    };
  } catch {
    return empty;
  }
}

/**
 * Client-only forensic summary (metadata + integrity). No server upload.
 */
export async function buildForensicsReport(
  bytes: Uint8Array,
  fileName: string,
  mimeHint?: string,
): Promise<ForensicsReport> {
  const magic = sniffMagic(bytes);
  const mimeGuess = mimeHint && mimeHint !== "application/octet-stream" ? mimeHint : magic.mime;
  const exifSummary: ForensicsReport["exifSummary"] =
    magic.label === "JPEG"
      ? summarizeExifFromJpeg(bytes)
      : {
          hasExif: false,
          hasGps: false,
          segmentKeys: [],
          tagCounts: {},
        };

  const [sha256, imageSize] = await Promise.all([
    sha256Hex(bytes),
    tryImageBitmapSize(bytes, mimeGuess),
  ]);

  let utf8Status: ForensicsReport["utf8Status"] = "empty";
  if (bytes.length > 0) {
    try {
      const dec = new TextDecoder("utf-8", { fatal: true });
      dec.decode(bytes);
      utf8Status = "valid";
    } catch {
      utf8Status = "invalid";
    }
  }

  let printable = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b >= 32 && b <= 126) printable += 1;
  }
  const printableAsciiRatio = bytes.length ? printable / bytes.length : 0;

  return {
    fileName,
    byteLength: bytes.length,
    mimeGuess,
    magic: magic.label,
    sha256Hex: sha256,
    imageSize: imageSize ?? null,
    shannonEntropyBits: shannonEntropyBits(bytes),
    hexHead: hexPrefix(bytes, 48),
    utf8Status,
    printableAsciiRatio,
    exifSummary,
  };
}

/** Scrub metadata (JPEG) / pass-through; same pipeline as vault upload prep. */
export function scrubMediaBytes(bytes: Uint8Array, mimeHint?: string): Uint8Array {
  return runCloutVisionPipeline(bytes, mimeHint);
}
