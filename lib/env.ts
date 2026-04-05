import Constants from "expo-constants";
import { Platform } from "react-native";

type ExpoPublicPayload = {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?: string;
  EXPO_PUBLIC_DISTRESS_WEBHOOK_URL?: string;
  EXPO_PUBLIC_MM_MAP_SHARED_KEY?: string;
  EXPO_PUBLIC_SUPERMAP_API_URL?: string;
  EXPO_PUBLIC_MM_GEO_PROXY_URL?: string;
};

function readWebInjected(key: keyof ExpoPublicPayload): string | undefined {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  const inj = (window as Window & { __MM_EXPO_PUBLIC__?: ExpoPublicPayload }).__MM_EXPO_PUBLIC__;
  const v = inj?.[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function readExtra(key: string): string | undefined {
  const extra = Constants.expoConfig?.extra as Record<string, string> | undefined;
  return extra?.[key] ?? process.env[key];
}

export function getSupabaseUrl(): string {
  return (
    readWebInjected("EXPO_PUBLIC_SUPABASE_URL") ??
    readExtra("EXPO_PUBLIC_SUPABASE_URL") ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    ""
  );
}

/**
 * Public Supabase key for the client + `mm-login` calls.
 * Use the **anon** JWT or the dashboard **publishable** key — both work with `createClient` for this app.
 */
export function getSupabaseAnonKey(): string {
  return (
    readWebInjected("EXPO_PUBLIC_SUPABASE_ANON_KEY") ??
    readWebInjected("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY") ??
    readExtra("EXPO_PUBLIC_SUPABASE_ANON_KEY") ??
    readExtra("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY") ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    ""
  );
}

export function getDistressWebhookUrl(): string {
  return (
    readWebInjected("EXPO_PUBLIC_DISTRESS_WEBHOOK_URL") ??
    readExtra("EXPO_PUBLIC_DISTRESS_WEBHOOK_URL") ??
    process.env.EXPO_PUBLIC_DISTRESS_WEBHOOK_URL ??
    ""
  );
}

/** Optional 64-char hex (32-byte) AES key for shared marker encryption. */
export function getMapSharedKeyHex(): string | undefined {
  const raw =
    readWebInjected("EXPO_PUBLIC_MM_MAP_SHARED_KEY") ??
    readExtra("EXPO_PUBLIC_MM_MAP_SHARED_KEY") ??
    process.env.EXPO_PUBLIC_MM_MAP_SHARED_KEY ??
    "";
  if (!raw || raw.length !== 64) return undefined;
  return raw;
}

/** Optional: self-hosted SuperMap API base (no trailing slash). */
export function getSupermapApiUrl(): string {
  return (
    readWebInjected("EXPO_PUBLIC_SUPERMAP_API_URL") ??
    readExtra("EXPO_PUBLIC_SUPERMAP_API_URL") ??
    process.env.EXPO_PUBLIC_SUPERMAP_API_URL ??
    ""
  );
}

/**
 * Optional MM Cloudflare Worker base for geo proxy (no trailing slash).
 */
export function getMmGeoProxyUrl(): string | undefined {
  const raw =
    readWebInjected("EXPO_PUBLIC_MM_GEO_PROXY_URL") ??
    readExtra("EXPO_PUBLIC_MM_GEO_PROXY_URL") ??
    process.env.EXPO_PUBLIC_MM_GEO_PROXY_URL ??
    "";
  if (!raw?.trim()) return undefined;
  return raw.replace(/\/$/, "");
}
