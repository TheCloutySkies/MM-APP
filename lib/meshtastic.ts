/**
 * Optional hook to a Meshtastic node over HTTP (WiFi) — firmware exposes JSON on many builds.
 * Bluetooth is handled by the official Meshtastic app; this is for LAN / advanced setups.
 *
 * @see https://meshtastic.org/docs/software/integrations/
 */

export type MeshtasticProbeResult = {
  ok: boolean;
  /** Short status for UI */
  message: string;
};

/** Try common HTTP endpoints (firmware-dependent). */
export async function probeMeshtasticHttp(baseUrl: string): Promise<MeshtasticProbeResult> {
  const root = baseUrl.replace(/\/$/, "");
  const paths = ["/json", "/api/v1/status", "/hotspot-detect.html"];
  let lastErr = "";
  for (const path of paths) {
    try {
      const r = await fetch(`${root}${path}`, { method: "GET" });
      const text = await r.text();
      if (r.ok) {
        return {
          ok: true,
          message: `${path} → ${text.slice(0, 280)}${text.length > 280 ? "…" : ""}`,
        };
      }
      lastErr = `${path}: HTTP ${r.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    ok: false,
    message: lastErr || "No response — check WiFi, URL, and CORS (web may block local IPs).",
  };
}
