#!/usr/bin/env bash
# One-shot: link remote project, push migrations, seed users, set Edge secrets, deploy mm-login.
# Prerequisites: brew install supabase/tap/supabase, supabase login, Node.js
#
# Required in .env (repo root):
#   SUPABASE_PROJECT_REF=your_ref
#   JWT_SECRET=same as Dashboard → Settings → API → JWT Secret
#   EXPO_PUBLIC_* (for the app — already documented in .env.example)
#
# Strongly recommended for non-interactive link + full secrets:
#   SUPABASE_DB_PASSWORD=database password (Settings → Database)
#   SUPABASE_SERVICE_ROLE_KEY=service_role JWT (Settings → API) — never ship to clients
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Install CLI: brew install supabase/tap/supabase"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for seed generation."
  exit 1
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF in .env (hostname segment, e.g. yzunwqzeqfeemyxpkvto)}"
: "${JWT_SECRET:?Set JWT_SECRET in .env (must match Project Settings → API → JWT Secret)}"

echo "==> If this fails with 'not logged in', run: supabase login"
echo "==> Linking project ${SUPABASE_PROJECT_REF}..."
LINK_CMD=(supabase link --project-ref "$SUPABASE_PROJECT_REF")
if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  LINK_CMD+=(-p "$SUPABASE_DB_PASSWORD")
fi
"${LINK_CMD[@]}"

echo "==> Pushing migrations to remote..."
supabase db push --linked --yes

echo "==> Seeding mm_profiles (Argon2 hashes)..."
SEED_FILE="supabase/.generated-seed.sql"
node scripts/seed-mm-users.mjs > "$SEED_FILE"
supabase db query --linked -f "$SEED_FILE"
rm -f "$SEED_FILE"

echo "==> Enabling Realtime on map_markers (ok if this errors if already enabled)..."
set +e
supabase db query --linked -f supabase/sql/enable_map_realtime.sql
RT_EXIT=$?
set -e
if [ "$RT_EXIT" -ne 0 ]; then
  echo "    (Realtime SQL skipped or failed — enable manually: Dashboard → Database → Replication → map_markers)"
fi

echo "==> Writing Edge secrets file (temporary)..."
TMP_SECRETS="supabase/.secrets.env.tmp"
rm -f "$TMP_SECRETS"
{
  echo "JWT_SECRET=${JWT_SECRET}"
  echo "SUPABASE_URL=${SUPABASE_URL:-https://${SUPABASE_PROJECT_REF}.supabase.co}"
  if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    echo "SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}"
  fi
} > "$TMP_SECRETS"

echo "==> Pushing Edge secrets..."
supabase secrets set --env-file "$TMP_SECRETS" --project-ref "$SUPABASE_PROJECT_REF"
rm -f "$TMP_SECRETS"

echo "==> Deploying Edge Function mm-login (--use-api avoids local Docker)..."
supabase functions deploy mm-login --no-verify-jwt --use-api --project-ref "$SUPABASE_PROJECT_REF"

echo ""
echo "Done."
echo "  • App URL:   https://${SUPABASE_PROJECT_REF}.supabase.co"
echo "  • Login fn:  https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/mm-login"
echo "  • Run app:   npx expo start"
