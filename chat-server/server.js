const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const DB_PATH = process.env.MM_CHAT_DB_PATH || "messages.db";
/** Comma-separated origins, or `*`. Example: `https://mmapp.cloutyskies.org,http://localhost:8081` */
function parseCorsOrigin(raw) {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v || v === "*") return "*";
  const parts = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return "*";
  return parts.length === 1 ? parts[0] : parts;
}
const CORS_ORIGIN = parseCorsOrigin(process.env.MM_CHAT_CORS_ORIGIN || "*");

const GROUP_GLOBAL = "group:global";

const app = express();
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, credentials: true },
});

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function dmChannelId(uid1, uid2) {
  const [a, b] = [String(uid1), String(uid2)].sort();
  return `dm:${a}:${b}`;
}

function parseDmChannel(channelId) {
  if (!channelId || typeof channelId !== "string") return null;
  const m = /^dm:([^:]+):([^:]+)$/.exec(channelId);
  if (!m) return null;
  return { a: m[1], b: m[2] };
}

function userInChannel(userId, channelId) {
  if (channelId === GROUP_GLOBAL) return true;
  const dm = parseDmChannel(channelId);
  if (!dm) return false;
  return dm.a === userId || dm.b === userId;
}

async function initDb() {
  await run(`
    create table if not exists chat_messages (
      id integer primary key autoincrement,
      channel_id text not null,
      channel_type text not null,
      sender_user_id text not null,
      sender_display_name text not null,
      payload_json text not null,
      created_at_ms integer not null
    );
  `);
  await run(`create index if not exists idx_chat_channel_ts on chat_messages(channel_id, created_at_ms);`);

  await run(`
    create table if not exists read_receipts (
      channel_id text not null,
      user_id text not null,
      last_read_message_id text not null,
      updated_at_ms integer not null,
      primary key (channel_id, user_id)
    );
  `);

  await run(`
    create table if not exists messages (
      id integer primary key autoincrement,
      user_id text not null,
      display_name text not null,
      text text not null,
      timestamp integer not null
    );
  `);
  const [{ n: chatCount }] = await all(`select count(*) as n from chat_messages;`);
  if (Number(chatCount) === 0) {
    const legacy = await all(
      `select user_id, display_name, text, timestamp from messages order by id asc limit 5000;`,
    );
    for (const r of legacy) {
      const payload = JSON.stringify({ kind: "text", text: String(r.text) });
      await run(
        `insert into chat_messages(channel_id, channel_type, sender_user_id, sender_display_name, payload_json, created_at_ms)
         values (?, 'group', ?, ?, ?, ?);`,
        [GROUP_GLOBAL, String(r.user_id), String(r.display_name), payload, Number(r.timestamp)],
      );
    }
    if (legacy.length) await run(`drop table if exists messages;`);
  }
}

function rowToEnvelope(row) {
  let payload = {};
  try {
    payload = JSON.parse(String(row.payload_json || "{}"));
  } catch {
    payload = { kind: "text", text: String(row.payload_json || "") };
  }
  return {
    message_id: String(row.id),
    channel_id: String(row.channel_id),
    channel_type: String(row.channel_type),
    sender_user_id: String(row.sender_user_id),
    sender_display_name: String(row.sender_display_name),
    created_at_ms: Number(row.created_at_ms),
    kind: payload.kind || "text",
    text: payload.text != null ? String(payload.text) : "",
    attachment: payload.attachment && typeof payload.attachment === "object" ? payload.attachment : undefined,
    location: payload.location && typeof payload.location === "object" ? payload.location : undefined,
    client_temp_id: payload.client_temp_id,
  };
}

/** In-memory presence: who has an active Socket.IO connection to this server. */
const onlineByUser = new Map();

function presenceAdd(userId, displayName, socketId) {
  const id = String(userId || "");
  if (!id) return;
  const dn = String(displayName || "").trim() || id.slice(0, 8);
  let row = onlineByUser.get(id);
  if (!row) {
    row = { displayName: dn, sockets: new Set() };
    onlineByUser.set(id, row);
  }
  row.sockets.add(String(socketId));
  row.displayName = dn;
}

function presenceRemoveSocket(socketId) {
  const sid = String(socketId);
  for (const [uid, row] of onlineByUser.entries()) {
    if (row.sockets.has(sid)) {
      row.sockets.delete(sid);
      if (row.sockets.size === 0) onlineByUser.delete(uid);
      return;
    }
  }
}

function presencePayload() {
  return {
    users: Array.from(onlineByUser.entries()).map(([user_id, v]) => ({
      user_id,
      display_name: v.displayName,
    })),
  };
}

function broadcastPresenceJoin(io, socket) {
  const payload = presencePayload();
  socket.emit("presence_roster", payload);
  socket.broadcast.emit("presence_roster", payload);
}

function broadcastPresenceAll(io) {
  io.emit("presence_roster", presencePayload());
}

async function lastMessagesForChannel(channelId, limit = 100) {
  const rows = await all(
    `select id, channel_id, channel_type, sender_user_id, sender_display_name, payload_json, created_at_ms
     from chat_messages
     where channel_id = ?
     order by created_at_ms desc, id desc
     limit ?;`,
    [channelId, limit],
  );
  return rows.reverse().map(rowToEnvelope);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  const auth = socket.handshake.auth || {};
  const userId = typeof auth.userId === "string" ? auth.userId : "";
  const displayName = typeof auth.displayName === "string" ? auth.displayName : "member";

  if (userId) {
    presenceAdd(userId, displayName, socket.id);
    broadcastPresenceJoin(io, socket);
  }

  socket.on("disconnect", () => {
    presenceRemoveSocket(socket.id);
    broadcastPresenceAll(io);
  });

  socket.on("join_channel", async (payload, ack) => {
    const channelId = payload && typeof payload.channel_id === "string" ? payload.channel_id.trim() : "";
    const channelType = payload && payload.channel_type === "dm" ? "dm" : "group";
    if (!channelId || !userId) {
      if (typeof ack === "function") ack({ ok: false, error: "missing channel or user" });
      return;
    }
    if (!userInChannel(userId, channelId)) {
      if (typeof ack === "function") ack({ ok: false, error: "forbidden" });
      return;
    }
    try {
      await socket.join(channelId);
      const history = await lastMessagesForChannel(channelId, 100);
      socket.emit("history", { channel_id: channelId, messages: history });
      if (typeof ack === "function") ack({ ok: true, channel_id: channelId });
    } catch (e) {
      socket.emit("error_message", { message: "DB error loading channel" });
      if (typeof ack === "function") ack({ ok: false, error: String(e && e.message) });
    }
  });

  socket.on("send_message", async (payload, ack) => {
    const clientTempId =
      payload && typeof payload.client_temp_id === "string" ? payload.client_temp_id : null;
    const channelId = payload && typeof payload.channel_id === "string" ? payload.channel_id.trim() : "";
    const channelType = payload && payload.channel_type === "dm" ? "dm" : "group";
    const kind = payload && typeof payload.kind === "string" ? payload.kind : "text";

    if (!channelId || !userId) {
      if (typeof ack === "function") ack({ ok: false, error: "missing channel" });
      return;
    }
    if (!userInChannel(userId, channelId)) {
      if (typeof ack === "function") ack({ ok: false, error: "forbidden" });
      return;
    }

    const text = payload && typeof payload.text === "string" ? payload.text : "";
    const attachment = payload && payload.attachment && typeof payload.attachment === "object" ? payload.attachment : null;
    const location = payload && payload.location && typeof payload.location === "object" ? payload.location : null;

    if (kind === "text" && !text.trim()) {
      if (typeof ack === "function") ack({ ok: false, error: "empty" });
      return;
    }
    if ((kind === "image" || kind === "file") && !attachment) {
      if (typeof ack === "function") ack({ ok: false, error: "attachment required" });
      return;
    }
    if (kind === "location" && (!location || typeof location.lat !== "number" || typeof location.lng !== "number")) {
      if (typeof ack === "function") ack({ ok: false, error: "location required" });
      return;
    }

    const body = {
      kind,
      text: text.trim(),
      client_temp_id: clientTempId || undefined,
      attachment: attachment || undefined,
      location: location || undefined,
    };
    const payloadJson = JSON.stringify(body);
    const ts = Date.now();
    const name = (displayName || "member").trim() || userId.slice(0, 8);

    try {
      const result = await run(
        `insert into chat_messages(channel_id, channel_type, sender_user_id, sender_display_name, payload_json, created_at_ms)
         values (?, ?, ?, ?, ?, ?);`,
        [channelId, channelType, userId, name, payloadJson, ts],
      );
      const id = result.lastID;
      const envelope = rowToEnvelope({
        id,
        channel_id: channelId,
        channel_type: channelType,
        sender_user_id: userId,
        sender_display_name: name,
        payload_json: payloadJson,
        created_at_ms: ts,
      });
      io.to(channelId).emit("receive_message", envelope);
      io.to(channelId).emit("new_message", envelope);
      if (typeof ack === "function") {
        ack({
          ok: true,
          server_message_id: String(id),
          status: "delivered",
          created_at_ms: ts,
          client_temp_id: clientTempId,
        });
      }
    } catch (e) {
      socket.emit("error_message", { message: "DB error saving message" });
      if (typeof ack === "function") ack({ ok: false, error: "db" });
    }
  });

  socket.on("mark_read", async (payload) => {
    const channelId = payload && typeof payload.channel_id === "string" ? payload.channel_id.trim() : "";
    const lastId = payload && typeof payload.last_read_message_id === "string" ? payload.last_read_message_id : "";
    if (!channelId || !lastId || !userId) return;
    if (!userInChannel(userId, channelId)) return;
    const ts = Date.now();
    try {
      await run(
        `insert into read_receipts(channel_id, user_id, last_read_message_id, updated_at_ms)
         values (?, ?, ?, ?)
         on conflict(channel_id, user_id) do update set
           last_read_message_id = excluded.last_read_message_id,
           updated_at_ms = excluded.updated_at_ms;`,
        [channelId, userId, lastId, ts],
      );
      io.to(channelId).emit("read_receipt", {
        channel_id: channelId,
        user_id: userId,
        last_read_message_id: lastId,
        updated_at_ms: ts,
      });
    } catch {
      /* ignore */
    }
  });

  /** Default: join global group and send history */
  void (async () => {
    if (!userId) return;
    try {
      await socket.join(GROUP_GLOBAL);
      const history = await lastMessagesForChannel(GROUP_GLOBAL, 100);
      socket.emit("history", { channel_id: GROUP_GLOBAL, messages: history });
    } catch {
      socket.emit("error_message", { message: "DB error loading history" });
    }
  })();
});

initDb()
  .then(() => {
    server.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`mm-chat server listening on :${PORT}, db=${DB_PATH}`);
    });
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error("mm-chat init failed:", e);
    process.exit(1);
  });

module.exports = { dmChannelId, GROUP_GLOBAL };
