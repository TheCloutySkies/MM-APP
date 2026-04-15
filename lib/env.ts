import Constants from "expo-constants";

type ExpoPublicPayload = {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?: string;
  EXPO_PUBLIC_DISTRESS_WEBHOOK_URL?: string;
  EXPO_PUBLIC_MM_MAP_SHARED_KEY?: string;
  EXPO_PUBLIC_SUPERMAP_API_URL?: string;
  EXPO_PUBLIC_MM_GEO_PROXY_URL?: string;
  EXPO_PUBLIC_S3_ENDPOINT?: string;
  EXPO_PUBLIC_S3_ACCESS_KEY?: string;
  EXPO_PUBLIC_S3_SECRET_KEY?: string;
  EXPO_PUBLIC_S3_BUCKET?: string;
  EXPO_PUBLIC_S3_REGION?: string;
  EXPO_PUBLIC_S3_FORCE_PATH_STYLE?: string;
  EXPO_PUBLIC_CHAT_ENDPOINT?: string;
};

/** Cloudflare Worker injects this on HTML responses (see worker/index.js). Do not gate on Platform.OS — RN Web can differ from browser during early loads. */
function getInjectedExpoPublic(): ExpoPublicPayload | undefined {
  if (typeof globalThis === "undefined") return undefined;
  const g = globalThis as typeof globalThis & {
    __MM_EXPO_PUBLIC__?: ExpoPublicPayload;
    window?: Window & { __MM_EXPO_PUBLIC__?: ExpoPublicPayload };
  };
  if (g.__MM_EXPO_PUBLIC__) return g.__MM_EXPO_PUBLIC__;
  if (typeof g.window !== "undefined" && g.window?.__MM_EXPO_PUBLIC__) {
    return g.window.__MM_EXPO_PUBLIC__;
  }
  return undefined;
}

function readWebInjected(key: keyof ExpoPublicPayload): string | undefined {
  const inj = getInjectedExpoPublic();
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

/**
 * S3-compatible API base URL (no trailing slash).
 * For Cloudflare R2 use `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (see R2 dashboard → S3 API).
 */
export function getS3Endpoint(): string {
  return (
    readWebInjected("EXPO_PUBLIC_S3_ENDPOINT") ??
    readExtra("EXPO_PUBLIC_S3_ENDPOINT") ??
    process.env.EXPO_PUBLIC_S3_ENDPOINT ??
    ""
  ).trim();
}

function isCloudflareR2NativeApiHost(endpoint: string): boolean {
  try {
    return /\.r2\.cloudflarestorage\.com$/i.test(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

/**
 * R2 requires `auto` per Cloudflare docs. Other S3-compatible servers often use `us-east-1`.
 * If unset, inferred from endpoint hostname (`.r2.cloudflarestorage.com` → `auto`, else `us-east-1`).
 */
export function getS3Region(): string {
  const raw = (
    readWebInjected("EXPO_PUBLIC_S3_REGION") ??
    readExtra("EXPO_PUBLIC_S3_REGION") ??
    process.env.EXPO_PUBLIC_S3_REGION ??
    ""
  ).trim();
  if (raw) return raw;
  const ep = getS3Endpoint();
  if (isCloudflareR2NativeApiHost(ep)) return "auto";
  return "us-east-1";
}

/**
 * R2 defaults to virtual-hosted-style requests (omit path-style). MinIO and some proxies need path-style.
 * If unset: `false` for native R2 API hosts, `true` otherwise. Override with `true` / `false` / `1` / `0`.
 */
export function getS3ForcePathStyle(): boolean {
  const raw = (
    readWebInjected("EXPO_PUBLIC_S3_FORCE_PATH_STYLE") ??
    readExtra("EXPO_PUBLIC_S3_FORCE_PATH_STYLE") ??
    process.env.EXPO_PUBLIC_S3_FORCE_PATH_STYLE ??
    ""
  )
    .trim()
    .toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  const ep = getS3Endpoint();
  if (isCloudflareR2NativeApiHost(ep)) return false;
  return true;
}

export function getS3AccessKey(): string {
  return (
    readWebInjected("EXPO_PUBLIC_S3_ACCESS_KEY") ??
    readExtra("EXPO_PUBLIC_S3_ACCESS_KEY") ??
    process.env.EXPO_PUBLIC_S3_ACCESS_KEY ??
    ""
  ).trim();
}

export function getS3SecretKey(): string {
  return (
    readWebInjected("EXPO_PUBLIC_S3_SECRET_KEY") ??
    readExtra("EXPO_PUBLIC_S3_SECRET_KEY") ??
    process.env.EXPO_PUBLIC_S3_SECRET_KEY ??
    ""
  ).trim();
}

export function getS3Bucket(): string {
  return (
    readWebInjected("EXPO_PUBLIC_S3_BUCKET") ??
    readExtra("EXPO_PUBLIC_S3_BUCKET") ??
    process.env.EXPO_PUBLIC_S3_BUCKET ??
    ""
  ).trim();
}

/** Socket.io chat server base URL (no trailing slash). */
export function getChatEndpoint(): string {
  const raw =
    readWebInjected("EXPO_PUBLIC_CHAT_ENDPOINT") ??
    readExtra("EXPO_PUBLIC_CHAT_ENDPOINT") ??
    process.env.EXPO_PUBLIC_CHAT_ENDPOINT ??
    "";
  return raw.trim().replace(/\/$/, "");
}
