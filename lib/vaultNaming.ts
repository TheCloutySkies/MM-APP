/**
 * Drive-friendly labels for roster / callsign naming:
 * - kebab-case: `charlie-sierra` → title "Charlie Sierra", subtitle initials "CS"
 * - short tokens: `CS` (all caps) → shown as-is
 */

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export type VaultNameDisplay = {
  title: string;
  /** e.g. CS for charlie-sierra */
  subtitle?: string;
};

function initialsFromKebabParts(parts: string[]): string {
  return parts
    .map((p) => p.replace(/[^a-zA-Z0-9]/g, "").charAt(0))
    .filter(Boolean)
    .join("")
    .toUpperCase();
}

/** Strip `.enc` and path noise; return last segment if path-like */
export function vaultFilenameBase(storagePathOrName: string): string {
  const last = storagePathOrName.split("/").pop() ?? storagePathOrName;
  return last.replace(/\.enc$/i, "");
}

/**
 * Turn a filename or display string into primary + optional callsign line.
 */
export function vaultItemDisplayName(raw: string): VaultNameDisplay {
  const base = vaultFilenameBase(raw).trim();
  if (!base) return { title: "Untitled" };

  if (UUID_PREFIX.test(base)) {
    return { title: "Encrypted file", subtitle: `${base.slice(0, 8)}…` };
  }

  if (/^[A-Z]{2,6}$/.test(base)) {
    return { title: base };
  }

  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(base)) {
    const parts = base.split("-").filter(Boolean);
    const title = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
    const initials = initialsFromKebabParts(parts);
    return {
      title,
      subtitle: initials.length >= 2 ? initials : undefined,
    };
  }

  return { title: base };
}

/**
 * For ops report preview strings: only rewrite obvious kebab / ALLCAPS short titles.
 */
export function formatOpsVaultHeadline(raw: string): VaultNameDisplay {
  const t = raw.trim();
  if (!t || t === "(payload)") return { title: "Untitled" };
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(t)) {
    return vaultItemDisplayName(t);
  }
  if (/^[A-Z]{2,6}$/.test(t)) {
    return { title: t };
  }
  return { title: t };
}

export function formatVaultListDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
