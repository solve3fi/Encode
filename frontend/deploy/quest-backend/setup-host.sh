#!/usr/bin/env bash
# One-time host setup for the isolated Devnet Quest test stack. Run as root on the server.
# Generates every secret locally (never printed, never committed) under /etc/solve3/quest.
# Idempotent: refuses to regenerate if secrets already exist.
set -euo pipefail
umask 077
dir=/etc/solve3/quest
mkdir -p "$dir"
chmod 700 "$dir"
if [ -f "$dir/secrets.env" ]; then
  echo "secrets already exist in $dir; not regenerating"
  exit 0
fi

web_origin="${QUEST_WEB_ORIGIN:-https://solve3.fi}"
backend_origin="${QUEST_BACKEND_ORIGIN:?set QUEST_BACKEND_ORIGIN, e.g. https://quest-89-233-104-147.sslip.io}"
campaign="${QUEST_CAMPAIGN_ID:-solve3-devnet-test-2026}"
manifest_sha=$(sha256sum /srv/solve3/deploy/quest-backend/devnet-manifest.json | cut -d' ' -f1)
env_id=$(cat /proc/sys/kernel/random/uuid)
rand() { openssl rand -hex 24; }
pg_pw=$(rand); owner_pw=$(rand); runtime_pw=$(rand); operator_pw=$(rand)
rate_secret=$(openssl rand -base64 32)

cat > "$dir/secrets.env" <<EOF
PG_SUPERUSER_PASSWORD=$pg_pw
QUEST_OWNER_PASSWORD=$owner_pw
QUEST_RUNTIME_PASSWORD=$runtime_pw
QUEST_OPERATOR_PASSWORD=$operator_pw
EOF

cat > "$dir/db.env" <<EOF
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$pg_pw
POSTGRES_DB=postgres
EOF

cat > "$dir/backend.env" <<EOF
PORT=8080
QUEST_DB_URL=postgres://quest_runtime:$runtime_pw@quest-db:5432/quest_devnet
QUEST_WEB_ORIGIN=$web_origin
QUEST_ENVIRONMENT_ID=$env_id
QUEST_MANIFEST_SHA256=$manifest_sha
QUEST_RATE_KEY_SECRET=$rate_secret
QUEST_DB_POOL_MAX=5
QUEST_SQL_TIMEOUT_MS=5000
EOF

cat > "$dir/tools.env" <<EOF
QUEST_OWNER_DB_URL=postgres://quest_owner:$owner_pw@quest-db:5432/quest_devnet
QUEST_OPERATOR_DB_URL=postgres://quest_operator:$operator_pw@quest-db:5432/quest_devnet
QUEST_RUNTIME_ROLE=quest_runtime
QUEST_OPERATOR_ROLE=quest_operator
QUEST_WEB_ORIGIN=$web_origin
QUEST_ENVIRONMENT_ID=$env_id
QUEST_MANIFEST_SHA256=$manifest_sha
QUEST_RATE_KEY_SECRET=$rate_secret
QUEST_CAMPAIGN_ID=$campaign
EOF

# Public (non-secret) values the website build and gateway need.
cat > "$dir/public.env" <<EOF
QUEST_TEST_UI_ENABLED=true
QUEST_TEST_WEB_ORIGIN=$web_origin
QUEST_TEST_BACKEND_ORIGIN=$backend_origin
NEXT_PUBLIC_QUEST_TEST_CAMPAIGN=$campaign
EOF
chmod 600 "$dir"/*.env
echo "wrote $dir/{secrets,db,backend,tools,public}.env (contents not shown)"
