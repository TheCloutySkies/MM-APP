import Constants from "expo-constants";

function readExtra(key: string): string | undefined {
  const extra = Constants.expoConfig?.extra as Record<string, string> | undefined;
  return extra?.[key] ?? process.env[key];
}

export function getSupabaseUrl(): string {
  return (
    readExtra("EXPO_PUBLIC_SUPABASE_URL") ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    ""
  );
}

export function getSupabaseAnonKey(): string {
  return (
    readExtra("EXPO_PUBLIC_SUPABASE_ANON_KEY") ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  );
}

export function getDistressWebhookUrl(): string {
  return (
    readExtra("EXPO_PUBLIC_DISTRESS_WEBHOOK_URL") ??
    process.env.EXPO_PUBLIC_DISTRESS_WEBHOOK_URL ??
    ""
  );
}

/** Optional 64-char hex (32-byte) AES key for shared marker encryption. */
export function getMapSharedKeyHex(): string | undefined {
  const raw =
    readExtra("EXPO_PUBLIC_MM_MAP_SHARED_KEY") ??
    process.env.EXPO_PUBLIC_MM_MAP_SHARED_KEY ??
    "";
  if (!raw || raw.length !== 64) return undefined;
  return raw;
}

/** Optional self-hosted SuperMap situational-awareness-api base (no trailing slash). */
export function getSupermapApiUrl(): string {
  return (
    readExtra("EXPO_PUBLIC_SUPERMAP_API_URL") ??
    process.env.EXPO_PUBLIC_SUPERMAP_API_URL ??
    ""
  );
}

/**
 * Optional MM Cloudflare Worker (or other proxy) base — weather / geo calls can be routed so the
 * external service sees the proxy IP, not the client (see OpSec note in docs).
 * Example: `https://mm-geo.example.workers.dev`
 */
export function getMmGeoProxyUrl(): string | undefined {
  const raw =
    readExtra("EXPO_PUBLIC_MM_GEO_PROXY_URL") ?? process.env.EXPO_PUBLIC_MM_GEO_PROXY_URL ?? "";
  if (!raw?.trim()) return undefined;
  return raw.replace(/\/$/, "");
}
