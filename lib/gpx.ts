import type { TacticalMapPayload } from "@/lib/mapMarkers";
import { tacCategoryLabel } from "@/lib/mapMarkers";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

export type GpxCounts = { pointCount: number; routeCount: number; zoneCount: number };

/**
 * Build GPX 1.1 from decrypted tactical payloads (one DB row each).
 * Points → waypoints; routes → tracks; zones → closed-loop tracks named "(zone)".
 */
export function buildGpxFromTacticalPayloads(opts: {
  gpxName: string;
  creatorLabel: string;
  payloads: TacticalMapPayload[];
}): { xml: string; counts: GpxCounts } {
  const { gpxName, creatorLabel, payloads } = opts;
  let pointCount = 0;
  let routeCount = 0;
  let zoneCount = 0;

  const wpts: string[] = [];
  const trks: string[] = [];

  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i];
    const baseName =
      p.title?.trim() || tacCategoryLabel(p.category);
    const desc = [`${tacCategoryLabel(p.category)}`, `By ${p.createdBy}`, p.notes?.trim() && `Notes: ${p.notes.trim()}`]
      .filter(Boolean)
      .join(" · ");

    if (p.geom === "point") {
      pointCount += 1;
      const c = p.coordinates[0];
      wpts.push(
        `<wpt lat="${c.lat}" lon="${c.lng}"><name>${escapeXml(baseName)}</name><desc>${escapeXml(desc)}</desc><type>MM tactical point</type><time>${isoTime(p.droppedAt)}</time></wpt>`,
      );
      continue;
    }

    if (p.geom === "route") {
      routeCount += 1;
      const pts = p.coordinates
        .map(
          (c) =>
            `<trkpt lat="${c.lat}" lon="${c.lng}"><time>${isoTime(p.droppedAt)}</time></trkpt>`,
        )
        .join("");
      trks.push(
        `<trk><name>${escapeXml(baseName)}</name><desc>${escapeXml(desc)}</desc><type>MM route</type><trkseg>${pts}</trkseg></trk>`,
      );
      continue;
    }

    if (p.geom === "zone") {
      zoneCount += 1;
      const coords = [...p.coordinates];
      if (coords.length >= 2) {
        const a = coords[0];
        const b = coords[coords.length - 1];
        if (a.lat !== b.lat || a.lng !== b.lng) coords.push({ lat: a.lat, lng: a.lng });
      }
      const pts = coords
        .map(
          (c) =>
            `<trkpt lat="${c.lat}" lon="${c.lng}"><time>${isoTime(p.droppedAt)}</time></trkpt>`,
        )
        .join("");
      trks.push(
        `<trk><name>${escapeXml(`${baseName} (zone)`)}</name><desc>${escapeXml(desc)}</desc><type>MM zone (closed polygon as track)</type><trkseg>${pts}</trkseg></trk>`,
      );
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MM-APP ${escapeXml(creatorLabel)}" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(gpxName)}</name>
    <desc>Exported from MM tactical map — ${escapeXml(creatorLabel)}</desc>
    <time>${isoTime(Date.now())}</time>
  </metadata>
  ${wpts.join("\n  ")}
  ${trks.join("\n  ")}
</gpx>`;

  return { xml, counts: { pointCount, routeCount, zoneCount } };
}
