import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

/** Single client: GoTrue session persistence (email/password). Use this for sign-in/up and post-auth API calls. */
let _authClient: SupabaseClient | null = null;

export function getAuthSupabase(): SupabaseClient {
  if (!_authClient) {
    const url = getSupabaseUrl().trim();
    const key = getSupabaseAnonKey().trim();
    if (!url || !key) {
      throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY");
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
