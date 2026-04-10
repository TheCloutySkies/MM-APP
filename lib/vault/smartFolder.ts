import type { VaultOutboxRecord } from "@/lib/e2ee/localStore";
import type { VaultMetaPlainV1 } from "@/lib/vault/vaultConstants";

/** Structural match for `PrivateListItem` in the vault screen (kept local to avoid circular imports). */
export type SmartPrivateListItem =
  | { kind: "queued"; rec: VaultOutboxRecord }
  | { kind: "remote"; row: { id: string } };

export type VaultSmartTab = "all" | "photos" | "documents" | "reports";

export function smartTabLabel(t: VaultSmartTab): string {
  switch (t) {
    case "all":
      return "All files";
    case "photos":
      return "Photos";
    case "documents":
      return "Documents";
    case "reports":
      return "Reports";
    default:
      return t;
  }
}

function extOf(name: string): string {
  const base = name.split("/").pop() ?? name;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

/** MIME + filename heuristics for virtual folders (decrypted metadata when available). */
export function getPrivateItemMime(
  item: SmartPrivateListItem,
  remoteMetaById: Map<string, VaultMetaPlainV1 | null>,
): string {
  if (item.kind === "queued") return item.rec.local_mime || "application/octet-stream";
  return remoteMetaById.get(item.row.id)?.mimeType ?? "application/octet-stream";
}

export function getPrivateItemFilename(
  item: SmartPrivateListItem,
  remoteMetaById: Map<string, VaultMetaPlainV1 | null>,
  fallbackTitle: string,
): string {
  if (item.kind === "queued") return item.rec.local_label || "file";
  return remoteMetaById.get(item.row.id)?.filename ?? fallbackTitle;
}

export function matchesVaultSmartTab(tab: VaultSmartTab, mime: string, filename: string): boolean {
  if (tab === "all") return true;
  const m = (mime || "").toLowerCase();
  const ext = extOf(filename);

  const isPhoto =
    (m.startsWith("image/") && !m.includes("svg")) ||
    ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp"].includes(ext);

  const isOfficeDoc =
    m === "application/pdf" ||
    m === "application/msword" ||
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    m === "application/vnd.ms-excel" ||
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    m === "application/vnd.ms-powerpoint" ||
    m === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    m === "text/csv" ||
    m === "application/rtf" ||
    m === "application/vnd.oasis.opendocument.text" ||
    m === "application/vnd.oasis.opendocument.spreadsheet";

  const isReportish =
    m.startsWith("text/") ||
    m === "application/json" ||
    m.includes("gpx") ||
    m.includes("kml+xml") ||
    m.includes("geo+json") ||
    ["txt", "md", "markdown", "json", "gpx", "kml", "html", "htm", "log"].includes(ext);

  if (tab === "photos") return isPhoto;
  if (tab === "documents") {
    if (isPhoto) return false;
    if (m.startsWith("text/") && !isOfficeDoc) {
      // Narrative text files land under Reports, not Documents.
      return false;
    }
    return isOfficeDoc;
  }
  if (tab === "reports") {
    if (isPhoto) return false;
    if (isOfficeDoc) return false;
    return isReportish;
  }
  return false;
}
