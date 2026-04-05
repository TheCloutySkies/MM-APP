/**
 * Serves Expo static export from ./dist (wrangler.toml [assets]).
 * Injects window.__MM_EXPO_PUBLIC__ into HTML so the client bundle gets Supabase URL/key
 * from Cloudflare Worker vars — static export does not read your laptop's .env.
 *
 * Set EXPO_PUBLIC_* in wrangler.toml [vars] or Dashboard → Workers → Settings → Variables.
 */
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) {
      return res;
    }

    const payload = {
      EXPO_PUBLIC_SUPABASE_URL: env.EXPO_PUBLIC_SUPABASE_URL ?? "",
      EXPO_PUBLIC_SUPABASE_ANON_KEY:
        env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? "",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY:
        env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? "",
      EXPO_PUBLIC_DISTRESS_WEBHOOK_URL: env.EXPO_PUBLIC_DISTRESS_WEBHOOK_URL ?? "",
      EXPO_PUBLIC_MM_MAP_SHARED_KEY: env.EXPO_PUBLIC_MM_MAP_SHARED_KEY ?? "",
      EXPO_PUBLIC_SUPERMAP_API_URL: env.EXPO_PUBLIC_SUPERMAP_API_URL ?? "",
      EXPO_PUBLIC_MM_GEO_PROXY_URL: env.EXPO_PUBLIC_MM_GEO_PROXY_URL ?? "",
    };
    const script = `<script>window.__MM_EXPO_PUBLIC__=${JSON.stringify(payload)};<\/script>`;

    let html = await res.text();
    if (html.includes("</head>")) {
      html = html.replace("</head>", `${script}</head>`);
    } else {
      html = `${script}${html}`;
    }

    const headers = new Headers(res.headers);
    headers.delete("content-length");
    return new Response(html, { status: res.status, headers });
  },
};
