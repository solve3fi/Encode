#!/usr/bin/env bash
# One-time (idempotent) host setup for the Devnet swap source: creates the two database logins,
# writes their secrets to root-only files (never printed), applies the grants, seeds the campaign
# at the DEX program's first transaction, and appends the backend switches. Run as root after the
# backend image containing swap-worker.mjs has been built and tagged solve3-quest-backend:local.
set -euo pipefail
umask 077
dir=/etc/solve3/quest
program="${QUEST_SWAP_PROGRAM_ID:?set QUEST_SWAP_PROGRAM_ID to the DEX program id}"
campaign="${QUEST_SWAP_CAMPAIGN_ID:-solve3-devnet-swaps}"
image=solve3-quest-backend:local
db=solve3-quest-quest-db-1
grab() { grep -h "^$1=" $dir/backend.env $dir/public.env $dir/tools.env 2>/dev/null | head -1 | cut -d= -f2-; }
rpc=$(grab QUEST_DEVNET_RPC_URL); envid=$(grab QUEST_ENVIRONMENT_ID)
[ -n "$rpc" ] && [ -n "$envid" ] || { echo "QUEST_DEVNET_RPC_URL / QUEST_ENVIRONMENT_ID not found"; exit 1; }

if [ ! -f $dir/swap.env ]; then
  idx_pw=$(openssl rand -hex 24); rdr_pw=$(openssl rand -hex 24)
  docker exec -i "$db" psql -U postgres -d quest_devnet -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='quest_indexer') THEN CREATE ROLE quest_indexer LOGIN PASSWORD '$idx_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='quest_source_reader') THEN CREATE ROLE quest_source_reader LOGIN PASSWORD '$rdr_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
END \$\$;
GRANT CONNECT ON DATABASE quest_devnet TO quest_indexer, quest_source_reader;
SQL
  cat > $dir/swap.env <<ENV
QUEST_INDEXER_DB_URL=postgres://quest_indexer:$idx_pw@quest-db:5432/quest_devnet
QUEST_DEVNET_RPC_URL=$rpc
QUEST_SWAP_PROGRAM_ID=$program
QUEST_SWAP_CAMPAIGN_ID=$campaign
QUEST_ENVIRONMENT_ID=$envid
QUEST_SWAP_INTERVAL_SECONDS=60
ENV
  cp -n $dir/backend.env $dir/backend.env.before-swap-source
  {
    echo "QUEST_SWAP_PROGRESS_ENABLED=true"
    echo "QUEST_SWAP_CAMPAIGN_ID=$campaign"
    echo "QUEST_SOURCE_READER_DB_URL=postgres://quest_source_reader:$rdr_pw@quest-db:5432/quest_devnet"
  } >> $dir/backend.env
  chmod 600 $dir/swap.env $dir/backend.env
  echo "roles and env written (contents not shown)"
fi

net=solve3-quest_internal
docker run --rm --network $net --env-file $dir/tools.env -e QUEST_INDEXER_ROLE=quest_indexer -e QUEST_SOURCE_READER_ROLE=quest_source_reader $image bun server/apply-schema.mjs
docker run --rm --network $net --env-file $dir/tools.env --env-file $dir/swap.env $image bun server/swap-seed.mjs
echo "swap source seeded"
