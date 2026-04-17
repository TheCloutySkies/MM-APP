# ProBook hosting: tunnel hostnames and deploy

Use this when **everything should hit your ProBook** (web app, chat, MinIO) through Cloudflare Tunnel.

## DNS / tunnel ingress (example)

| Public hostname | Local service | Typical port |
|-----------------|---------------|--------------|
| `mmapp.cloutyskies.org` | Expo web **or** static `dist` (e.g. `npx expo start --web --port 3000`) | 3000 |
| `chat.cloutyskies.org` | MM chat server (`chat-server/server.js`) | 4000 |
| `storage.cloutyskies.org` | MinIO API | 9000 |

Your `~/.cloudflared/config.yml` ingress should map each hostname to the matching `http://localhost:PORT`. After edits: `sudo systemctl restart cloudflared` (or your equivalent).

## Chat server CORS

Set `MM_CHAT_CORS_ORIGIN` when you lock down the Socket.io API (comma-separated list is supported):

```bash
export MM_CHAT_CORS_ORIGIN="https://mmapp.cloutyskies.org,http://localhost:8081"
```

If unset, the server defaults to `*` (permissive).

## One-command local stack

From the repo root:

```bash
bash scripts/mm-up.sh
```

Ensures MinIO, the Socket.io chat server, and tunnel health checks are in a good state (see script header for env vars).

## Ship a new web build

After `git pull` on the ProBook:

```bash
npm ci   # or npm install
npm run export:web
```

- If **mmapp** uses the tunnel to **localhost:3000**, run `npx expo start --web --port 3000` (or serve `dist` on 3000).
- To update the **Cloudflare Worker** deployment (e.g. `mm.cloutyskies.org`): `npx wrangler deploy` with `CLOUDFLARE_API_TOKEN` set.

## Chat server after schema changes

Restart the Node chat process so `chat-server/server.js` runs the new SQLite schema and handlers:

```bash
# if using pm2
pm2 restart mm-chat
```

If you use a fresh DB, delete `chat-server/messages.db` only when you accept losing history.

## Friends must bust the PWA cache once

The service worker caches the app shell. After major upgrades, ask users to **hard refresh** or **clear site data** for `mmapp.cloutyskies.org` once.

The app bumps `CACHE_NAME` in `public/sw.js` on releases; redeploying the web bundle is required for clients to fetch the new worker.
