/** Lightweight binary structure helpers (browser-safe, no deps). */

function readU32BE(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function readU32LE(b: Uint8Array, o: number): number {
  return ((b[o + 3]! << 24) | (b[o + 2]! << 16) | (b[o + 1]! << 8) | b[o]!) >>> 0;
}

function readU16LE(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8)) >>> 0;
}

export function extDeclared(fileName: string): string | null {
  const i = fileName.lastIndexOf(".");
  if (i <= 0 || i === fileName.length - 1) return null;
  return fileName.slice(i + 1).toLowerCase();
}

const EXT_FOR_MAGIC: Record<string, string[]> = {
  JPEG: ["jpg", "jpeg", "jpe"],
  PNG: ["png"],
  GIF: ["gif"],
  WebP: ["webp"],
  BMP: ["bmp", "dib"],
  ICO: ["ico"],
  PDF: ["pdf"],
  ZIP: ["zip", "jar", "apk", "docx", "pptx", "xlsx", "epub", "cbz"],
  GZIP: ["gz", "tgz"],
  SQLite: ["db", "sqlite", "sqlite3"],
  "RIFF/WAVE": ["wav"],
  "RIFF/AVI": ["avi"],
  ELF: ["so", "o", "elf", "bin"],
  "Mach-O": ["dylib", "bundle", "macho"],
};

export function extensionMatchesMagic(magicLabel: string, fileName: string): boolean {
  const ext = extDeclared(fileName);
  if (!ext) return true;
  const ok = EXT_FOR_MAGIC[magicLabel];
  if (!ok) return true;
  return ok.includes(ext);
}

/** PNG dimensions from IHDR without full decode. */
export function pngIhdrSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return null;
  }
  const t = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (t !== "IHDR") return null;
  const w = readU32BE(bytes, 16);
  const h = readU32BE(bytes, 20);
  if (!w || !h) return null;
  return { width: w, height: h };
}

/** List PNG chunk types in order (cap list length). */
export function pngChunkTypes(bytes: Uint8Array, maxChunks = 24): string[] {
  const out: string[] = [];
  if (bytes.length < 32) return out;
  let o = 8;
  for (let n = 0; n < maxChunks && o + 12 <= bytes.length; n++) {
    const len = readU32BE(bytes, o);
    const type = String.fromCharCode(
      bytes[o + 4]!,
      bytes[o + 5]!,
      bytes[o + 6]!,
      bytes[o + 7]!,
    );
    out.push(type);
    if (type === "IEND") break;
    o += 12 + len;
    if (o > bytes.length || len > bytes.length) break;
  }
  return out;
}

export function gifLogicalScreenSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null;
  const sig = String.fromCharCode(...bytes.slice(0, 6));
  if (sig !== "GIF87a" && sig !== "GIF89a") return null;
  return { width: readU16LE(bytes, 6), height: readU16LE(bytes, 8) };
}

export function bmpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 26) return null;
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const w = readU32LE(bytes, 18);
  const h = Math.abs(readU32LE(bytes, 22) | 0);
  if (!w || !h) return null;
  return { width: w, height: h };
}

export function zipLocalEntryCount(bytes: Uint8Array): number {
  let n = 0;
  const sig = 0x04034b50;
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (readU32LE(bytes, i) === sig) n += 1;
  }
  return n;
}

export function riffWebpLabel(bytes: Uint8Array): "WebP" | "WAVE" | "AVI " | "other" | null {
  if (bytes.length < 12) return null;
  if (
    bytes[0] !== 0x52 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50
  ) {
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      const form = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
      if (form === "WAVE") return "WAVE";
      if (form === "AVI ") return "AVI ";
      return "other";
    }
    return null;
  }
  return "WebP";
}

export function sqlite3Magic(bytes: Uint8Array): boolean {
  const head = "SQLite format 3\x00";
  if (bytes.length < head.length) return false;
  for (let i = 0; i < head.length; i++) {
    if (bytes[i] !== head.charCodeAt(i)) return false;
  }
  return true;
}

export function icoImageCount(bytes: Uint8Array): number | null {
  if (bytes.length < 6) return null;
  if (bytes[0] !== 0 || bytes[1] !== 0) return null;
  if (bytes[2] !== 1 && bytes[2] !== 2) return null;
  return readU16LE(bytes, 4);
}

export function pdfHeaderVersion(bytes: Uint8Array): string | null {
  if (bytes.length < 8) return null;
  if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) return null;
  const s = new TextDecoder("latin1").decode(bytes.slice(0, 12));
  const m = s.match(/%PDF-(\d\.\d)/);
  return m?.[1] ?? "unknown";
}

export function gzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Simple control-char ratio for “binary vs text”. */
export function controlCharRatio(bytes: Uint8Array, sampleMax = 50000): number {
  const n = Math.min(bytes.length, sampleMax);
  if (!n) return 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) c++;
  }
  return c / n;
}

export function utf8TextPreview(bytes: Uint8Array, maxChars = 600): string | null {
  if (bytes.length === 0) return null;
  try {
    const dec = new TextDecoder("utf-8", { fatal: true });
    const t = dec.decode(bytes.slice(0, Math.min(bytes.length, 200_000)));
    if (controlCharRatio(bytes, 8000) > 0.02) return null;
    return t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
  } catch {
    return null;
  }
}

export function lineCountUtf8(bytes: Uint8Array): number | null {
  try {
    const dec = new TextDecoder("utf-8", { fatal: true });
    const t = dec.decode(bytes.slice(0, Math.min(bytes.length, 512_000)));
    if (controlCharRatio(bytes, 8000) > 0.02) return null;
    return t.split(/\r\n|\r|\n/).length;
  } catch {
    return null;
  }
}
