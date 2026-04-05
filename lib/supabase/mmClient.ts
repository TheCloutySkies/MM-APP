import {
    FunctionsFetchError,
    FunctionsHttpError,
    createClient,
    type SupabaseClient,
} from "@supabase/supabase-js";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

const MM_LOGIN_TIMEOUT_MS = 30_000;

export class MMLoginError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MMLoginError";
    this.code = code;
  }
}

export function isMMLoginError(e: unknown): e is MMLoginError {
  return (
    e instanceof MMLoginError ||
    (typeof e === "object" &&
      e !== null &&
      (e as { name?: string }).name === "MMLoginError" &&
      "code" in e &&
      "message" in e)
  );
}

export function mmLoginErrorMessage(e: unknown): string {
  if (isMMLoginError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong. Try again.";
}

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

type MmLoginJson = {
  error?: string;
  code?: string;
  access_token?: string;
  profile?: { id: string; username: string };
};

function mapMmLoginFailure(body: MmLoginJson | null, httpStatus: number): MMLoginError {
  const code =
    body?.code ??
    (httpStatus === 401 ? "BAD_KEY" : httpStatus === 400 ? "INVALID_REQUEST" : "UNKNOWN");
  switch (code) {
    case "NO_PROFILE":
      return new MMLoginError(
        code,
        "That username is not on the roster. Use lowercase kebab-case (example: charlie-sierra).",
      );
    case "BAD_KEY":
      return new MMLoginError(code, "Access key did not match. Check caps lock and re-enter the key.");
    case "INVALID_REQUEST":
      return new MMLoginError(code, "Enter both username and access key.");
    case "SERVER_MISCONFIGURED":
      return new MMLoginError(
        code,
        "Server configuration error (JWT secret). Ask an admin to set JWT_SECRET on the mm-login function.",
      );
    case "INTERNAL":
      return new MMLoginError(code, "Server error while signing in. Try again in a minute.");
    default:
      if (body?.error && typeof body.error === "string" && body.error.length < 400) {
        return new MMLoginError(code, body.error);
      }
      return new MMLoginError(
        code,
        httpStatus >= 500
          ? "Server error while signing in. Try again in a minute."
          : "Sign-in was rejected. Try again.",
      );
  }
}

function isFunctionsHttpError(e: unknown): e is FunctionsHttpError {
  return e instanceof FunctionsHttpError || (typeof e === "object" && e !== null && (e as { name?: string }).name === "FunctionsHttpError");
}

function isFunctionsFetchError(e: unknown): e is FunctionsFetchError {
  return e instanceof FunctionsFetchError || (typeof e === "object" && e !== null && (e as { name?: string }).name === "FunctionsFetchError");
}

/**
 * Uses `supabase.functions.invoke` so headers, JSON body, and timeouts match what Supabase expects on mobile.
 */
export async function invokeMmLogin(username: string, accessKey: string): Promise<{
  access_token: string;
  profile: { id: string; username: string };
}> {
  const url = getSupabaseUrl().trim();
  const anon = getSupabaseAnonKey().trim();
  if (!url || !anon) {
    throw new MMLoginError(
      "ENV_MISSING",
      "This build is missing Supabase settings. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env, restart Expo with a clean cache (npx expo start -c), and rebuild native apps if you use a dev client.",
    );
  }

  const supabase = createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.functions.invoke<MmLoginJson>("mm-login", {
    body: { username, accessKey },
    timeout: MM_LOGIN_TIMEOUT_MS,
  });

  if (!error && data?.access_token && data?.profile) {
    return { access_token: data.access_token, profile: data.profile };
  }

  if (isFunctionsHttpError(error)) {
    const res = error.context as Response | undefined;
    let body: MmLoginJson | null = null;
    if (res && typeof res.json === "function") {
      try {
        body = (await res.json()) as MmLoginJson;
      } catch {
        body = null;
      }
    }
    const status = res?.status ?? 401;
    throw mapMmLoginFailure(body, status);
  }

  if (isFunctionsFetchError(error)) {
    const ctx = error.context;
    const aborted =
      ctx?.name === "AbortError" ||
      (typeof ctx === "object" && ctx !== null && "cause" in ctx && (ctx as { cause?: { name?: string } }).cause?.name === "AbortError");
    if (aborted) {
      throw new MMLoginError(
        "TIMEOUT",
        "No response from the server (timed out). Check Wi‑Fi or cell data and try again.",
      );
    }
    const msg = ctx instanceof Error ? ctx.message : String(ctx ?? error.message);
    throw new MMLoginError(
      "NETWORK",
      msg.toLowerCase().includes("network") || msg.toLowerCase().includes("failed to fetch")
        ? "Network error — check connection and try again."
        : `Could not reach sign-in service: ${msg}`,
    );
  }

  if (error) {
    throw new MMLoginError("UNKNOWN", error instanceof Error ? error.message : "Sign-in failed.");
  }

  throw new MMLoginError("UNKNOWN", "Unexpected empty response from sign-in.");
}
