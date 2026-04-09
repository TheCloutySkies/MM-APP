/**
 * Sends a visible operational email to another member (profile id = auth user id).
 * Optional: RESEND_API_KEY + RESEND_FROM_EMAIL (same as decoy alert function).
 *
 * Body JSON: { target_profile_id: string (uuid), excerpt: string }
 * Auth: Bearer user JWT (caller must be authenticated).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function clip(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const callerId = userData.user?.id;
    if (userErr || !callerId) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: { target_profile_id?: string; excerpt?: string };
    try {
      body = (await req.json()) as { target_profile_id?: string; excerpt?: string };
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const target = String(body.target_profile_id ?? "").trim();
    const excerpt = clip(String(body.excerpt ?? ""), 1200);
    if (!target || !excerpt) {
      return new Response(JSON.stringify({ error: "target_profile_id and excerpt required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (target === callerId) {
      return new Response(JSON.stringify({ error: "Cannot email yourself" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const { data: callerRow } = await admin
      .from("mm_profiles")
      .select("username")
      .eq("id", callerId)
      .maybeSingle();
    const callerName =
      typeof callerRow?.username === "string" && callerRow.username.trim()
        ? callerRow.username.trim()
        : callerId.slice(0, 8);

    const { data: tgtUser, error: tgtErr } = await admin.auth.admin.getUserById(target);
    const email = tgtUser.user?.email?.trim();
    if (tgtErr || !email) {
      return new Response(JSON.stringify({ error: "Target has no account email on file" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("Missing RESEND_API_KEY");
      return new Response(JSON.stringify({ error: "Mail not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const from =
      Deno.env.get("RESEND_FROM_EMAIL")?.trim() ??
      "Notifications <onboarding@resend.dev>";

    const subject = `[PRIORITY] Message from ${callerName}`;
    const text = `${callerName} flagged a priority note in MM secure chat.\n\n---\n${excerpt}\n---\n\nThis is an automated delivery. Reply in MM when you can.`;

    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        text,
      }),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error("Resend error", sendRes.status, errText);
      return new Response(JSON.stringify({ error: "Send failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "Internal" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
