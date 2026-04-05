# Distress webhook setup (`EXPO_PUBLIC_DISTRESS_WEBHOOK_URL`)

When someone **long-presses Panic** (about 3 seconds), MM:

1. Requests location (if allowed).
2. Sends a **POST** request with **JSON** to the URL in `EXPO_PUBLIC_DISTRESS_WEBHOOK_URL` (if set).
3. Runs a **full lock** (clears local keys and session) and returns to the login screen.

If the variable is **empty**, Panic still locks the app; only the HTTP step is skipped.

## 1. Choose a receiver

Use any HTTPS endpoint that accepts `POST` and `application/json`. Examples:

| Provider        | Notes |
|-----------------|--------|
| **Zapier**      | Webhooks → Catch Hook → copy the URL Zapier gives you. |
| **Make (Integromat)** | Webhooks module → custom webhook URL. |
| **Discord**     | Server settings → Integrations → Webhook (message format is generic JSON). |
| **Cloudflare Worker** | Small script that `fetch`es to your backend or stores in KV. |
| **Your API**    | Route that logs to your DB, pages on-call, etc. |

Prefer URLs that include a **long random path** or **token** so they are not guessable.

## 2. Add the variable in MM-APP

In the project root (same folder as `package.json`), create or edit **`.env`**:

```bash
EXPO_PUBLIC_DISTRESS_WEBHOOK_URL=https://hooks.example.com/your-secret-path
```

Do **not** commit real URLs if the repo is public; keep `.env` gitignored.

Reference copy is in [`.env.example`](../.env.example).

## 3. Restart Expo

`EXPO_PUBLIC_*` values are inlined when the JavaScript bundle is built.

- **Dev:** stop the dev server, run `npx expo start` again (use `npx expo start -c` if the value does not update).
- **Production / EAS:** set the same variable in [EAS environment configuration](https://docs.expo.dev/build-reference/variables/) or your CI, then rebuild.

## 4. Payload shape

The client sends:

```json
{
  "t": "mm_distress",
  "u": "<username>",
  "lat": 0,
  "lng": 0,
  "ts": 1730000000000
}
```

`lat` / `lng` may be `0` if location permission was denied or failed.

In **Settings → Emergency & distress**, use **Copy sample JSON payload** to paste into docs or tests.

## 5. Security expectations

- **`EXPO_PUBLIC_`** means the value is **embedded in the client bundle**. Anyone who inspects the app can read the URL.
- Treat the webhook URL like a **shared capability URL**: rotate it if leaked, avoid putting DB passwords in the query string, and validate payloads on the server if you add HMAC or tokens later.

## 6. Verify

1. Open **Settings** and confirm the distress card shows **On** and the masked endpoint.
2. In a **safe test environment**, long-press Panic and confirm your receiver logs the POST (then sign in again).
