import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

/**
 * MM uses custom JWTs (mm-login) where sub = mm_profiles.id, not auth.users.id.
 * Do NOT call auth.setSession — GoTrue will error ("User from sub claim does not exist").
 * Send the access token on every request + Realtime instead.
 */
export async function createMMSupabase(
  accessToken: string | null,
): Promise<SupabaseClient> {
  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  if (!url || !anon) {
    throw new Error("Configure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY");
  }

  const client = createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : {},
  });

  if (accessToken) {
    client.realtime.setAuth(accessToken);
  }

  return client;
}

export async function invokeMmLogin(username: string, accessKey: string): Promise<{
  access_token: string;
  profile: { id: string; username: string };
}> {
  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  if (!url || !anon) throw new Error("Supabase env missing");

  const res = await fetch(`${url}/functions/v1/mm-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anon}`,
      apikey: anon,
    },
    body: JSON.stringify({ username, accessKey }),
  });

  const json = (await res.json().catch(() => null)) as
    | { error?: string; access_token?: string; profile?: { id: string; username: string } }
    | null;

  if (!res.ok || !json?.access_token || !json.profile) {
    throw new Error(json?.error ?? "Login failed");
  }

  return { access_token: json.access_token, profile: json.profile };
}
