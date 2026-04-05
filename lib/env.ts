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
