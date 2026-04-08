/* Bakes EXPO_PUBLIC_* into Constants.expoConfig.extra for native/dev client (Hermes may not expose process.env). */
const fs = require("fs");
const path = require("path");

const appJson = require("./app.json");

/** When .env is missing, mirror wrangler.toml [vars] so Expo dev / export match Worker-injected web. */
function readExpoPublicFromWrangler() {
  try {
    const wranglerPath = path.join(__dirname, "wrangler.toml");
    const raw = fs.readFileSync(wranglerPath, "utf8");
    const url = raw.match(/^\s*EXPO_PUBLIC_SUPABASE_URL\s*=\s*"([^"]*)"/m)?.[1]?.trim() ?? "";
    const anon =
      raw.match(/^\s*EXPO_PUBLIC_SUPABASE_ANON_KEY\s*=\s*"([^"]*)"/m)?.[1]?.trim() ?? "";
    const mapKey =
      raw.match(/^\s*EXPO_PUBLIC_MM_MAP_SHARED_KEY\s*=\s*"([^"]*)"/m)?.[1]?.trim() ?? "";
    return { url, anon, mapKey };
  } catch {
    return { url: "", anon: "", mapKey: "" };
  }
}

const wranglerPublic = readExpoPublicFromWrangler();
const envUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const envAnon =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim();
const envMapKey = process.env.EXPO_PUBLIC_MM_MAP_SHARED_KEY?.trim();

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      EXPO_PUBLIC_SUPABASE_URL: envUrl || wranglerPublic.url || "",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: envAnon || wranglerPublic.anon || "",
      EXPO_PUBLIC_DISTRESS_WEBHOOK_URL: process.env.EXPO_PUBLIC_DISTRESS_WEBHOOK_URL ?? "",
      EXPO_PUBLIC_MM_MAP_SHARED_KEY: envMapKey || wranglerPublic.mapKey || "",
      EXPO_PUBLIC_SUPERMAP_API_URL: process.env.EXPO_PUBLIC_SUPERMAP_API_URL ?? "",
      EXPO_PUBLIC_MM_GEO_PROXY_URL: process.env.EXPO_PUBLIC_MM_GEO_PROXY_URL ?? "",
    },
  },
};
