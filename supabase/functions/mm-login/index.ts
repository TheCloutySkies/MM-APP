/// MM login: verify Argon2id access key (hash-wasm), mint Supabase-compatible JWT (jose).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { argon2Verify } from "https://esm.sh/hash-wasm@4.12.0";
import { SignJWT } from "https://esm.sh/jose@5.9.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Shared initial access key for all roster users (must match deployed Edge function). */
const UNIVERSAL_ACCESS_KEY = "Becomeungovernable";

type ProfileRow = {
  id: string;
  username: string;
  access_key_hash: string | null;
};

function rosterInitials(username: string): string {
  return username
    .split("-")
    .filter((s) => s.length > 0)
    .map((s) => s[0] ?? "")
    .join("")
    .toLowerCase();
}

async function findProfileForLogin(
  admin: ReturnType<typeof createClient>,
  rawUsername: string,
): Promise<
  | { ok: true; profile: ProfileRow }
  | { ok: false; code: "NO_PROFILE" | "AMBIGUOUS_ALIAS"; error: string }
> {
  const u = rawUsername.trim().toLowerCase();
  if (!u) {
    return { ok: false, code: "NO_PROFILE", error: "Username is required." };
  }

  const { data: exact } = await admin
    .from("mm_profiles")
    .select("id, username, access_key_hash")
    .eq("username", u)
    .maybeSingle();

  if (exact?.id) {
    return { ok: true, profile: exact as ProfileRow };
  }

  const looksLikeInitials = !u.includes("-") && /^[a-z0-9]{2,8}$/.test(u);
  if (!looksLikeInitials) {
    return {
      ok: false,
      code: "NO_PROFILE",
      error:
        "Username not found on this server. Use full kebab-case (alpha-kilo) or initials (AK).",
    };
  }

  const { data: rows, error } = await admin
    .from("mm_profiles")
    .select("id, username, access_key_hash");
  if (error || !rows?.length) {
    return { ok: false, code: "NO_PROFILE", error: "Could not load roster." };
  }

  const list = rows as ProfileRow[];
  const matches = list.filter((r) => rosterInitials(r.username) === u);
  if (matches.length === 0) {
    return {
      ok: false,
      code: "NO_PROFILE",
      error:
        "No roster user matches those initials. Use the full handle (e.g. alpha-kilo).",
    };
  }
  if (matches.length > 1) {
    const names = matches.map((m) => m.username).sort().join(", ");
    return {
      ok: false,
      code: "AMBIGUOUS_ALIAS",
      error:
        `Several accounts share those initials (${names}). Sign in with the full username.`,
    };
  }

  return { ok: true, profile: matches[0]! };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const jwtSecret = Deno.env.get("JWT_SECRET") ??
      Deno.env.get("SUPABASE_JWT_SECRET");
    if (!jwtSecret) {
      console.error("Missing JWT_SECRET or SUPABASE_JWT_SECRET");
      return new Response(
        JSON.stringify({
          error: "Server misconfigured",
          code: "SERVER_MISCONFIGURED",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole);

    const body = await req.json().catch(() => null) as {
      username?: string;
      accessKey?: string;
    } | null;
    const usernameInput = body?.username?.trim() ?? "";
    const accessKey = body?.accessKey ?? "";
    if (!usernameInput || !accessKey) {
      return new Response(
        JSON.stringify({
          error: "Username and access key are required.",
          code: "INVALID_REQUEST",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resolved = await findProfileForLogin(admin, usernameInput);
    if (!resolved.ok) {
      const status = resolved.code === "AMBIGUOUS_ALIAS" ? 400 : 401;
      return new Response(
        JSON.stringify({
          error: resolved.error,
          code: resolved.code,
        }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const profile = resolved.profile;
    const canonicalUsername = profile.username;

    let ok = false;
    if (accessKey === UNIVERSAL_ACCESS_KEY) {
      ok = true;
    } else if (profile.access_key_hash) {
      try {
        ok = await argon2Verify({
          password: accessKey,
          hash: profile.access_key_hash,
        });
      } catch (e) {
        console.error("argon2 verify", e);
        ok = false;
      }
    }
    if (!ok) {
      return new Response(
        JSON.stringify({
          error: "Access key does not match this username.",
          code: "BAD_KEY",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const expSeconds = 8 * 60 * 60;
    const secretKey = new TextEncoder().encode(jwtSecret);

    const access_token = await new SignJWT({
      role: "authenticated",
      app_metadata: { provider: "mm-login", providers: ["mm-login"] },
      user_metadata: { username: canonicalUsername },
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(profile.id)
      .setAudience("authenticated")
      .setIssuedAt(now)
      .setExpirationTime(now + expSeconds)
      .sign(secretKey);

    return new Response(
      JSON.stringify({
        access_token,
        token_type: "bearer",
        expires_in: expSeconds,
        profile: { id: profile.id, username: canonicalUsername },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: "Server error", code: "INTERNAL" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
