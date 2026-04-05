/**
 * Serves Expo static export from ./dist (wrangler.toml [assets]).
 * Injects globalThis.__MM_EXPO_PUBLIC__ / window.__MM_EXPO_PUBLIC__ at the *start* of <head>
 * so config exists before any Expo/RN scripts run.
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

    const json = JSON.stringify(payload).replace(/</g, "\\u003c");
    const script = `<script>(function(){var p=${json};try{globalThis.__MM_EXPO_PUBLIC__=p;}catch(e){}if(typeof window!=="undefined")window.__MM_EXPO_PUBLIC__=p;})();<\/script>`;

    let html = await res.text();
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => `${m}${script}`);
    } else if (html.includes("</head>")) {
      html = html.replace("</head>", `${script}</head>`);
    } else {
      html = `${script}${html}`;
    }

    const headers = new Headers(res.headers);
    headers.delete("content-length");
    return new Response(html, { status: res.status, headers });
  },
};
