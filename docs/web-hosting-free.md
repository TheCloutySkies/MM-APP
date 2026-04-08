# Free static web hosting (no Vercel)

Your app is already configured for **static web** export (`app.json` → `"web": { "output": "static" }`). One build produces HTML + JS in **`dist/`** that any static host can serve. iPhone and Android users open your URL in **Safari / Chrome** and get the same features as desktop web (maps, vault, missions, etc.), with the usual web vs native caveats (SecureStore uses fallbacks on web, etc.).

## Best pick: **Cloudflare Pages** (free)

- Does not use your Vercel project slots.
- Generous free tier (bandwidth + build minutes for hobby use).
- You can connect **Git** (auto-deploy on push) or **upload the `dist` folder** manually.

### One-time: build on your machine

From the repo root (with `.env` or exported env vars set):

```bash
npm install
npm run export:web
```

This writes to **`dist/`**. Deploy **the contents of `dist`**, not the whole repo.

### Cloudflare Pages (Git)

1. Push this repo to GitHub/GitLab.
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → Connect to Git.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm run export:web` (optional: `npm install && npm run export:web` if your project needs it)
   - **Build output directory:** `dist`
   - **Root directory:** `/` means repo root in the Cloudflare UI — not the same as “deploy command”
   - **Deploy command:** leave **blank**. Do not enter `/`, `.`, or `npx wrangler pages deploy` unless you fully configure wrangler (project name + API token). A lone `/` causes: `Executing user deploy command: /` → `Permission denied`.
4. **Environment variables** (Production + Preview): add every `EXPO_PUBLIC_*` you use locally (see below). Redeploy after changing them.
5. **Node version:** set **20** (or 22) in Pages → Settings → Environment variables as `NODE_VERSION=20` if builds fail on default Node.

If the build log shows **Success: Build command completed** and **Exported: dist**, but deploy fails, the problem is almost always a non-empty **Deploy command**. Delete it and redeploy.

### Cloudflare **Workers** (Git) — not Pages

If you created a **Worker** (e.g. `*.workers.dev`) instead of **Pages**, the build must upload **`dist/`** as [static assets](https://developers.cloudflare.com/workers/static-assets/). This repo includes **`wrangler.toml`**: it sets `assets.directory` to `./dist` and `not_found_handling = "single-page-application"` so deep links (e.g. `/login`) work.

[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) run a **build command**, then a **deploy command**. The deploy step must run Wrangler — default is **`npx wrangler deploy`**. If you set **Deploy command** to **`true`** (a trick that only applies to some **Pages** setups), **Wrangler never runs**: Cloudflare keeps the starter script (`return new Response("Hello world")`) and never uploads `dist/`.

Use these Worker build settings:

| Field | Value |
|--------|--------|
| **Root directory** | Repo root (empty / `.`) — where `package.json`, `wrangler.toml`, `worker/` live — **not** `dist` |
| **Build command** | `npm install && npm run export:web` |
| **Deploy command** | `npx wrangler deploy` — **not** `true` |

For **preview / non-production branches**, Cloudflare may use `npx wrangler versions upload` by default; production **main** should still use a real Wrangler deploy that reads `wrangler.toml`.

- The inline editor may still show “Hello world” until a successful **`wrangler deploy`** replaces the script with `worker/index.js` + assets from the repo.
- **`name` in `wrangler.toml`** is `mm-app`; change it if your Worker uses a different name in the dashboard.
- **Runtime injection:** This Worker also injects `EXPO_PUBLIC_*` into HTML from **Worker variables** (Dashboard → Settings → Variables). Keep real URLs and keys out of git — use Dashboard or local `.dev.vars` (see `.dev.vars.example`).

### Cloudflare Pages (no Git)

1. Run `npm run export:web` locally.
2. Pages → **Create** → **Direct Upload** → upload the **`dist`** zip/folder.

## Alternative: **Netlify** (also free)

- **Build command:** `npm run export:web`
- **Publish directory:** `dist`
- Add the same `EXPO_PUBLIC_*` variables under **Site settings → Environment variables**.

## Environment variables (required at **build** time)

`EXPO_PUBLIC_*` values are **baked into the JS bundle** when you run `export:web`. Set them in the host’s CI env, not only on your laptop.

| Variable | Required | Notes |
|---------|----------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Your Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Anon key only — never service role |
| `EXPO_PUBLIC_MM_MAP_SHARED_KEY` | Optional | 64-char hex so the whole team decrypts the same map/ops ciphertext |
| `EXPO_PUBLIC_SUPERMAP_API_URL` | Optional | Self-hosted [SuperMap](https://github.com/TheCloutySkies/SuperMap) API base (no `/` tail) to proxy earthquakes and other feeds without baking third-party keys into the PWA |
| `EXPO_PUBLIC_DISTRESS_WEBHOOK_URL` | Optional | Webhook URL is visible in bundle — insecure endpoint |

Mirror whatever you already use in local `.env` (see `.env.example`).

### Forensics (in-app)

The **Forensics** screen runs **only in the browser/client**: SHA-256, JPEG EXIF segment summary (GPS presence without printing coordinates), optional image dimensions, and metadata scrub for JPEGs (same pipeline as vault upload prep). It is **not** a full port of desktop CloutVision (OpenCV, YOLO, Tesseract, MediaPipe, etc.).

### Supabase RLS (CLI only)

Schema changes and RLS policies live under `supabase/migrations/`. Apply remotely with:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --linked --yes
```

Hybrid model: **vault + storage** are owner-strict; **map_markers** and **ops_reports** allow `SELECT` for any authenticated member (E2EE ciphertext). See `supabase/migrations/20260407000000_rls_hardening.sql` for documentation and UPDATE policies.

## After deploy

- Open the `*.pages.dev` (or Netlify) URL on a phone; add **HTTPS** bookmark for your team.
- If something works locally but not on the hosted URL, compare **env vars** and hard-refresh (cache).

## Custom domain (optional, still free)

Point a domain’s DNS to Cloudflare (or Netlify). No paid tier required for basic HTTPS on their subdomains.
