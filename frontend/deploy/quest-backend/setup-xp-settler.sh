#!/usr/bin/env bash
# One-time (idempotent) host setup for the Devnet test-XP settler: creates its database login,
# writes the secret to a root-only file (never printed), applies migration 018 and the settler
# grants, and provisions the TEST-ONLY weekly XP ceilings. Run as root after the backend image
# containing xp-settler.mjs has been built and tagged solve3-quest-backend:local, and after
# setup-swap-source.sh (the swap source must exist).
set -euo pipefail
umask 077
dir=/etc/solve3/quest
image=solve3-quest-backend:local
db=solve3-quest-quest-db-1
grab() { grep -h "^$1=" $dir/backend.env $dir/tools.env $dir/swap.env 2>/dev/null | head -1 | cut -d= -f2-; }
envid=$(grab QUEST_ENVIRONMENT_ID); manifest=$(grab QUEST_MANIFEST_SHA256)
campaign=$(grab QUEST_CAMPAIGN_ID); swapcamp=$(grab QUEST_SWAP_CAMPAIGN_ID)
[ -n "$envid" ] && [ -n "$manifest" ] && [ -n "$campaign" ] && [ -n "$swapcamp" ] || { echo "missing identity or campaign settings"; exit 1; }

if [ ! -f $dir/settler.env ]; then
  pw=$(openssl rand -hex 24)
  docker exec -i "$db" psql -U postgres -d quest_devnet -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='quest_xp_writer') THEN CREATE ROLE quest_xp_writer LOGIN PASSWORD '$pw' NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
END \$\$;
GRANT CONNECT ON DATABASE quest_devnet TO quest_xp_writer;
SQL
  cat > $dir/settler.env <<ENV
QUEST_XP_WRITER_DB_URL=postgres://quest_xp_writer:$pw@quest-db:5432/quest_devnet
QUEST_SWAP_CAMPAIGN_ID=$swapcamp
QUEST_CALENDAR_CAMPAIGN_ID=$campaign
QUEST_ENVIRONMENT_ID=$envid
QUEST_MANIFEST_SHA256=$manifest
QUEST_SETTLER_INTERVAL_SECONDS=60
ENV
  chmod 600 $dir/settler.env
  echo "settler role and env written (contents not shown)"
fi

net=solve3-quest_internal
docker run --rm --network $net --env-file $dir/tools.env \
  -e QUEST_INDEXER_ROLE=quest_indexer -e QUEST_SOURCE_READER_ROLE=quest_source_reader -e QUEST_XP_WRITER_ROLE=quest_xp_writer \
  $image bun server/apply-schema.mjs
docker run --rm --network $net --env-file $dir/tools.env -e QUEST_CALENDAR_CAMPAIGN_ID=$campaign $image bun server/provision-weekly-policy.mjs
echo "settler grants applied and weekly policy provisioned"
