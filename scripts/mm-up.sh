#!/usr/bin/env bash
set -euo pipefail

# One-click “bring everything up” for the ProBook.
# Starts (or verifies) MinIO + mm-chat + cloudflared tunnel health.
#
# Safe to run repeatedly: it won't start duplicates if already running.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CHAT_DIR_DEFAULT="$ROOT_DIR/chat-server"
MINIO_DATA_DIR_DEFAULT="/home/bb8/mm-vault-data"

CHAT_PORT="${MM_CHAT_PORT:-4000}"
MINIO_PORT="${MM_MINIO_PORT:-9000}"
MINIO_CONSOLE_PORT="${MM_MINIO_CONSOLE_PORT:-9001}"

CHAT_DIR="${MM_CHAT_DIR:-$CHAT_DIR_DEFAULT}"
MINIO_DATA_DIR="${MM_MINIO_DATA_DIR:-$MINIO_DATA_DIR_DEFAULT}"

log() { printf "\n[%s] %s\n" "$(date +'%H:%M:%S')" "$*"; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

is_listening_tcp() {
  local port="$1"
  if has_cmd ss; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "(^|:)${port}$"
    return $?
  fi
  if has_cmd netstat; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE "(^|:)${port}$"
    return $?
  fi
  return 1
}

ensure_cloudflared() {
  if has_cmd systemctl; then
    if systemctl is-active --quiet cloudflared; then
      log "cloudflared: running"
      return 0
    fi
    log "cloudflared: NOT running (system service)"
    log "Run: sudo systemctl start cloudflared"
    return 0
  fi
  log "cloudflared: systemctl not available; skipping"
}

ensure_minio() {
  if is_listening_tcp "$MINIO_PORT"; then
    log "minio: already listening on :$MINIO_PORT"
    return 0
  fi

if ! has_cmd minio; then
    log "minio: binary not found in PATH. Install minio first."
    return 1
  fi

  mkdir -p "$MINIO_DATA_DIR"

  # Expect credentials via environment (recommended) or MinIO will refuse to start on newer versions.
  if [[ -z "${MINIO_ROOT_USER:-}" || -z "${MINIO_ROOT_PASSWORD:-}" ]]; then
    log "minio: MINIO_ROOT_USER / MINIO_ROOT_PASSWORD not set."
    log "Set them in your shell profile or export them before launching."
    log "Example:"
    log "  export MINIO_ROOT_USER='admin'"
    log "  export MINIO_ROOT_PASSWORD='...'"
    return 1
  fi

  log "minio: starting (ports :$MINIO_PORT api, :$MINIO_CONSOLE_PORT console)"
  nohup minio server "$MINIO_DATA_DIR" --address ":$MINIO_PORT" --console-address ":$MINIO_CONSOLE_PORT" >"$ROOT_DIR/minio.log" 2>&1 &
  sleep 1
  if is_listening_tcp "$MINIO_PORT"; then
    log "minio: started OK"
  else
    log "minio: failed to start (see $ROOT_DIR/minio.log)"
    return 1
  fi
}

ensure_chat_server() {
  if is_listening_tcp "$CHAT_PORT"; then
    log "mm-chat: already listening on :$CHAT_PORT"
    return 0
  fi

  if [[ ! -f "$CHAT_DIR/server.js" ]]; then
    log "mm-chat: server.js not found at $CHAT_DIR/server.js"
    log "Set MM_CHAT_DIR to the folder containing chat-server."
    return 1
  fi

  log "mm-chat: starting on :$CHAT_PORT"
  (cd "$CHAT_DIR" && nohup env PORT="$CHAT_PORT" node server.js >"$ROOT_DIR/mm-chat.log" 2>&1 &)
  sleep 1
  if is_listening_tcp "$CHAT_PORT"; then
    log "mm-chat: started OK"
  else
    log "mm-chat: failed to start (see $ROOT_DIR/mm-chat.log)"
    return 1
  fi
}

log "MM bring-up starting…"
ensure_cloudflared
ensure_minio
ensure_chat_server

log "All done."
log "MinIO API:        http://localhost:$MINIO_PORT"
log "MinIO console:    http://localhost:$MINIO_CONSOLE_PORT"
log "Chat health:      http://localhost:$CHAT_PORT/health"
log "Logs:"
log "  $ROOT_DIR/minio.log"
log "  $ROOT_DIR/mm-chat.log"

