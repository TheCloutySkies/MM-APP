import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

/**
 * First read of GoTrue session for routing / hydration.
 * On web, `getSession()` can briefly disagree with storage until `INITIAL_SESSION` fires
 * (supabase-js hydration). Native uses a single `getSession()` read.
 */
export async function getInitialAuthSession(): Promise<Session | null> {
  const client = getAuthSupabase();
  if (Platform.OS !== "web") {
    const { data } = await client.auth.getSession();
    return data.session ?? null;
  }
  return await new Promise<Session | null>((resolve) => {
    let finished = false;
    let unsubscribe: (() => void) | null = null;
    const timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;
      try {
        unsubscribe?.();
      } catch {
        /* noop */
      }
      void client.auth.getSession().then(({ data }) => resolve(data.session ?? null));
    }, 10_000);
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event !== "INITIAL_SESSION") return;
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      try {
        data.subscription.unsubscribe();
      } catch {
        /* noop */
      }
      resolve(session);
    });
    unsubscribe = () => data.subscription.unsubscribe();
  });
}

/** Single client: GoTrue session persistence (email/password). Use this for sign-in/up and post-auth API calls. */
let _authClient: SupabaseClient | null = null;

export function getAuthSupabase(): SupabaseClient {
  if (!_authClient) {
    const url = getSupabaseUrl().trim();
    const key = getSupabaseAnonKey().trim();
    if (!url || !key) {
      throw new Error(
        "Missing Supabase URL or anon/publishable key. Set EXPO_PUBLIC_SUPABASE_URL and " +
          "EXPO_PUBLIC_SUPABASE_ANON_KEY in a root .env (see .env.example), or for web deploy set Worker variables in " +
          "the Cloudflare Dashboard. Restart Expo with: npx expo start -c",
      );
    }
    _authClient = createClient(url, key, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === "web",
      },
    });
  }
  return _authClient;
}
