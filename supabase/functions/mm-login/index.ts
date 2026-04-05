/// MM login: verify Argon2id access key (hash-wasm), mint Supabase-compatible JWT (jose).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { argon2Verify } from "https://esm.sh/hash-wasm@4.12.0";
import { SignJWT } from "https://esm.sh/jose@5.9.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
        JSON.stringify({ error: "Server misconfigured" }),
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
    const username = body?.username?.trim()?.toLowerCase();
    const accessKey = body?.accessKey ?? "";
    if (!username || !accessKey) {
      return new Response(
        JSON.stringify({ error: "Invalid request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: profile, error } = await admin
      .from("mm_profiles")
      .select("id, access_key_hash")
      .eq("username", username)
      .maybeSingle();

    if (error || !profile) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let ok = false;
    try {
      ok = await argon2Verify({
        password: accessKey,
        hash: profile.access_key_hash,
      });
    } catch (e) {
      console.error("argon2 verify", e);
      ok = false;
    }
    if (!ok) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const expSeconds = 8 * 60 * 60;
    const secretKey = new TextEncoder().encode(jwtSecret);

    const access_token = await new SignJWT({
      role: "authenticated",
      app_metadata: { provider: "mm-login", providers: ["mm-login"] },
      user_metadata: { username },
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
        profile: { id: profile.id, username },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
