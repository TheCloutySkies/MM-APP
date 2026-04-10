/**
 * Browser-only: resize raster images to a small WebP blob for encrypted vault thumbnails.
 */
export function isRasterImageMime(mime: string): boolean {
  if (!mime || !/^image\//i.test(mime)) return false;
  const m = mime.toLowerCase();
  if (m.includes("svg")) return false;
  return true;
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("thumbnail image load failed"));
    img.src = url;
  });
}

/** Max dimension 200px, WebP ~quality 0.82. Returns null if unsupported or decode fails. */
export async function rasterFileToWebPThumbnail200(file: File): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(url);
    const maxSide = 200;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.82));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Tiny preview for queued rows (JPEG data URL, ~120px). */
export async function rasterFileToJpegDataUrlPreview120(file: File): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(url);
    const maxSide = 120;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.65);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
