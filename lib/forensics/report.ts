import piexif from "piexifjs";

import { bytesToBase64 } from "@/lib/crypto/bytes";
import {
    bmpSize,
    controlCharRatio,
    extDeclared,
    extensionMatchesMagic,
    gifLogicalScreenSize,
    gzipMagic,
    icoImageCount,
    lineCountUtf8,
    pdfHeaderVersion,
    pngChunkTypes,
    pngIhdrSize,
    riffWebpLabel,
    sqlite3Magic,
    utf8TextPreview,
    zipLocalEntryCount,
} from "@/lib/forensics/formatSniff";
import { runCloutVisionPipeline } from "@/lib/media/cloutVision";

export type ForensicsReport = {
  fileName: string;
  byteLength: number;
  mimeGuess: string;
  magic: string;
  sha256Hex: string;
  sha512Hex: string;
  /** Decoder dimensions when the browser can render the blob */
  imageSize: { width: number; height: number } | null;
  /** IHDR/GIF/BMP/etc. without full raster decode */
  structuralImageSize: { width: number; height: number; source: string } | null;
  /** Shannon entropy of raw bytes (0–8); high ≈ compressed/encrypted/random. */
  shannonEntropyBits: number;
  /** First 48 bytes as hex (for manual inspection). */
  hexHead: string;
  utf8Status: "valid" | "invalid" | "empty";
  printableAsciiRatio: number;
  /** Suspicious: declared extension does not match sniffed container. */
  extensionMismatch: boolean;
  declaredExtension: string | null;
  /** Ratio of non-whitespace control bytes in an early sample (binary indicator). */
  controlCharRatio: number;
  /** Human-readable structure notes (ZIP entries, PDF version, …). */
  structureHints: string[];
  pngChunkTypes: string[] | null;
  pdfVersion: string | null;
  textPreview: string | null;
  lineCountEstimate: number | null;
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

function readU32LE(b: Uint8Array, o: number): number {
  return ((b[o + 3]! << 24) | (b[o + 2]! << 16) | (b[o + 1]! << 8) | b[o]!) >>> 0;
}

function readU32BE(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function sniffMagic(bytes: Uint8Array): { label: string; mime: string } {
  if (bytes.length >= 16 && sqlite3Magic(bytes)) {
    return { label: "SQLite", mime: "application/x-sqlite3" };
  }
  if (bytes.length >= 2 && gzipMagic(bytes)) {
    return { label: "GZIP", mime: "application/gzip" };
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07 || bytes[2] === 0x08)
  ) {
    return { label: "ZIP", mime: "application/zip" };
  }
  if (bytes.length >= 6 && gifLogicalScreenSize(bytes)) {
    return { label: "GIF", mime: "image/gif" };
  }
  const riff = riffWebpLabel(bytes);
  if (riff === "WebP") return { label: "WebP", mime: "image/webp" };
  if (riff === "WAVE") return { label: "RIFF/WAVE", mime: "audio/wav" };
  if (riff === "AVI ") return { label: "RIFF/AVI", mime: "video/x-msvideo" };
  if (riff === "other") return { label: "RIFF", mime: "application/octet-stream" };
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
  if (bmpSize(bytes)) return { label: "BMP", mime: "image/bmp" };
  if (icoImageCount(bytes) != null) return { label: "ICO", mime: "image/x-icon" };
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { label: "PDF", mime: "application/pdf" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return { label: "ELF", mime: "application/x-executable" };
  }
  if (bytes.length >= 4) {
    const be = readU32BE(bytes, 0);
    const le = readU32LE(bytes, 0);
    if (
      be === 0xcafebabe ||
      be === 0xfeedface ||
      be === 0xfeedfacf ||
      le === 0xfeedface ||
      le === 0xfeedfacf
    ) {
      return { label: "Mach-O", mime: "application/x-mach-binary" };
    }
  }
  return { label: "Unknown", mime: "application/octet-stream" };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha512Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-512", buf);
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

  const structuralImageSize =
    magic.label === "PNG"
      ? (() => {
          const d = pngIhdrSize(bytes);
          return d ? { width: d.width, height: d.height, source: "PNG IHDR" } : null;
        })()
      : magic.label === "GIF"
        ? (() => {
            const d = gifLogicalScreenSize(bytes);
            return d ? { width: d.width, height: d.height, source: "GIF screen" } : null;
          })()
        : magic.label === "BMP"
          ? (() => {
              const d = bmpSize(bytes);
              return d ? { width: d.width, height: d.height, source: "BMP header" } : null;
            })()
          : null;

  const structureHints: string[] = [];
  if (magic.label === "ZIP") {
    const n = zipLocalEntryCount(bytes);
    structureHints.push(`ZIP: ~${n} local file header(s) detected (heuristic scan).`);
  }
  if (magic.label === "GZIP") {
    structureHints.push("GZIP: deflate stream — extract with gunzip / zlib tools.");
  }
  if (magic.label === "SQLite") {
    structureHints.push("SQLite: embedded database — use sqlite3 or a DB browser for schema inspection.");
  }
  if (magic.label === "PDF") {
    const v = pdfHeaderVersion(bytes);
    if (v) structureHints.push(`PDF declares version ${v}.`);
  }
  if (magic.label === "ICO") {
    const c = icoImageCount(bytes);
    if (c != null) structureHints.push(`ICO: ${c} image entr${c === 1 ? "y" : "ies"} in directory.`);
  }
  if (magic.label === "Mach-O") {
    structureHints.push("Mach-O: Apple/native binary — do not execute untrusted files.");
  }
  if (magic.label === "ELF") {
    structureHints.push("ELF: Unix executable or shared object.");
  }

  const pngChunks = magic.label === "PNG" ? pngChunkTypes(bytes, 28) : null;
  const pdfVer = magic.label === "PDF" ? pdfHeaderVersion(bytes) : null;

  const decl = extDeclared(fileName);
  const extensionMismatch = !extensionMatchesMagic(magic.label, fileName);

  const [sha256, sha512, imageSizeFirst] = await Promise.all([
    sha256Hex(bytes),
    sha512Hex(bytes),
    tryImageBitmapSize(bytes, mimeGuess),
  ]);
  let imageSize = imageSizeFirst;
  if (!imageSize && mimeGuess !== magic.mime) {
    imageSize = await tryImageBitmapSize(bytes, magic.mime);
  }

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
  const ctrlRatio = controlCharRatio(bytes);
  const textPreview = utf8Status === "valid" ? utf8TextPreview(bytes, 720) : null;
  const lineCountEstimate =
    utf8Status === "valid" && bytes.length < 600_000 ? lineCountUtf8(bytes) : null;

  return {
    fileName,
    byteLength: bytes.length,
    mimeGuess,
    magic: magic.label,
    sha256Hex: sha256,
    sha512Hex: sha512,
    imageSize: imageSize ?? null,
    structuralImageSize,
    shannonEntropyBits: shannonEntropyBits(bytes),
    hexHead: hexPrefix(bytes, 48),
    utf8Status,
    printableAsciiRatio,
    extensionMismatch,
    declaredExtension: decl,
    controlCharRatio: ctrlRatio,
    structureHints,
    pngChunkTypes: pngChunks,
    pdfVersion: pdfVer,
    textPreview,
    lineCountEstimate,
    exifSummary,
  };
}

/** Scrub metadata (JPEG) / pass-through; same pipeline as vault upload prep. */
export function scrubMediaBytes(bytes: Uint8Array, mimeHint?: string): Uint8Array {
  return runCloutVisionPipeline(bytes, mimeHint);
}
