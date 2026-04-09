/**
 * Opt-in decoy email when the client still has connectivity but secure sync was rejected (RLS/JWT).
 * Uses mundane rotating subjects; body matches the subject generically. No operational wording.
 *
 * Secrets: RESEND_API_KEY, optional RESEND_FROM_EMAIL (e.g. "Acme Updates <updates@yourdomain.com>").
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DECOY_SUBJECTS: readonly string[] = [
  "Get 50% off your next subscription period",
  "Your verification code is inside",
  "Updates to our Privacy Policy",
  "Your weekly account summary",
  "You have new rewards available",
  "Reminder: confirm your email preferences",
  "A quick note about your recent activity",
];

function pickDecoySubject(): string {
  const i = Math.floor(Math.random() * DECOY_SUBJECTS.length);
  return DECOY_SUBJECTS[i] ?? DECOY_SUBJECTS[0]!;
}

function decoyBodyForSubject(subject: string): string {
  const s = subject.toLowerCase();
  if (s.includes("50%") || s.includes("subscription")) {
    return "Thanks for being a customer. This message is for your records. No action is required unless you want to review your plan options in your account area.";
  }
  if (s.includes("verification")) {
    return "Hello — this is an automated message regarding your account. If you did not expect this, you can ignore it.";
  }
  if (s.includes("privacy")) {
    return "We posted routine policy housekeeping updates. You can review the summary in your account portal when convenient.";
  }
  if (s.includes("summary") || s.includes("weekly")) {
    return "Here is a short activity roundup for your account. View details anytime by signing in to your account.";
  }
  if (s.includes("reward")) {
    return "You may have unused benefits available. Sign in to your account to see what applies to you.";
  }
  if (s.includes("preferences") || s.includes("confirm")) {
    return "Manage notification and marketing preferences from your account settings whenever you like.";
  }
  return "This is a routine account notification. Sign in to your account for more information.";
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
    const uid = userData.user?.id;
    if (userErr || !uid) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const { data: row, error: rowErr } = await admin
      .from("mm_profiles")
      .select("decoy_alerts_enabled")
      .eq("id", uid)
      .maybeSingle();

    if (rowErr || !row?.decoy_alerts_enabled) {
      return new Response(JSON.stringify({ error: "Decoy alerts not enabled" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: authUser, error: adminUserErr } = await admin.auth.admin.getUserById(uid);
    if (adminUserErr || !authUser.user?.email) {
      return new Response(JSON.stringify({ error: "No email on file" }), {
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

    const subject = pickDecoySubject();
    const text = decoyBodyForSubject(subject);

    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [authUser.user.email],
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
