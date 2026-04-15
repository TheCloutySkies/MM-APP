const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const DB_PATH = process.env.MM_CHAT_DB_PATH || "messages.db";
const CORS_ORIGIN = process.env.MM_CHAT_CORS_ORIGIN || "*";

const app = express();
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, credentials: true },
});

const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(
    `create table if not exists messages (
      id integer primary key autoincrement,
      user_id text not null,
      display_name text not null,
      text text not null,
      timestamp integer not null
    );`,
  );
  db.run(`create index if not exists idx_messages_ts on messages(timestamp);`);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

function last50(cb) {
  db.all(
    `select id, user_id, display_name, text, timestamp
     from messages
     order by timestamp desc
     limit 50;`,
    (err, rows) => {
      if (err) return cb(err);
      cb(
        null,
        (rows || [])
          .map((r) => ({
            id: String(r.id),
            user_id: String(r.user_id),
            display_name: String(r.display_name),
            text: String(r.text),
            timestamp: Number(r.timestamp),
          }))
          .reverse(),
      );
    },
  );
}

io.on("connection", (socket) => {
  const auth = socket.handshake.auth || {};
  const userId = typeof auth.userId === "string" ? auth.userId : "";
  const displayName = typeof auth.displayName === "string" ? auth.displayName : "member";

  last50((err, rows) => {
    if (err) {
      socket.emit("error_message", { message: "DB error loading history" });
      return;
    }
    socket.emit("history", rows);
  });

  socket.on("send_message", (payload) => {
    const text = payload && typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) return;
    const ts = Date.now();
    const uid = userId || "unknown";
    const name = displayName || "member";
    db.run(
      `insert into messages(user_id, display_name, text, timestamp) values (?, ?, ?, ?);`,
      [uid, name, text, ts],
      function (err) {
        if (err) {
          socket.emit("error_message", { message: "DB error saving message" });
          return;
        }
        const row = {
          id: String(this.lastID),
          user_id: uid,
          display_name: name,
          text,
          timestamp: ts,
        };
        io.emit("new_message", row);
      },
    );
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`mm-chat server listening on :${PORT}, db=${DB_PATH}`);
});

