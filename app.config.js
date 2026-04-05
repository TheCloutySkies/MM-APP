/* Bakes EXPO_PUBLIC_* into Constants.expoConfig.extra for native/dev client (Hermes may not expose process.env). */
const appJson = require("./app.json");

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
      EXPO_PUBLIC_SUPABASE_ANON_KEY:
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
        process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
        "",
      EXPO_PUBLIC_DISTRESS_WEBHOOK_URL: process.env.EXPO_PUBLIC_DISTRESS_WEBHOOK_URL ?? "",
      EXPO_PUBLIC_MM_MAP_SHARED_KEY: process.env.EXPO_PUBLIC_MM_MAP_SHARED_KEY ?? "",
      EXPO_PUBLIC_SUPERMAP_API_URL: process.env.EXPO_PUBLIC_SUPERMAP_API_URL ?? "",
      EXPO_PUBLIC_MM_GEO_PROXY_URL: process.env.EXPO_PUBLIC_MM_GEO_PROXY_URL ?? "",
    },
  },
};
