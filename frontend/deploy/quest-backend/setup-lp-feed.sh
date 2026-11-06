#!/usr/bin/env bash
# Root-only Devnet host provisioning. Generate a separate publisher login and
# keep its connection private. No baseline, inventory admission or XP writes.
set -euo pipefail
umask 077
dir=/etc/solve3/quest
image=${QUEST_LP_SETUP_IMAGE:-solve3-quest-backend:local}
db=solve3-quest-quest-db-1
grab(){ grep -h "^$1=" "$dir/tools.env" "$dir/swap.env" 2>/dev/null | head -1 | cut -d= -f2-; }
envid=$(grab QUEST_ENVIRONMENT_ID)
manifest=$(grab QUEST_MANIFEST_SHA256)
campaign=$(grab QUEST_SWAP_CAMPAIGN_ID)
rpc=$(grab QUEST_DEVNET_RPC_URL)
[ -n "$envid" ] && [ -n "$manifest" ] && [ -n "$campaign" ] && [ -n "$rpc" ] || { echo 'LP feed identity/RPC settings missing'; exit 1; }
docker image inspect "$image" >/dev/null
if [ ! -f "$dir/lp-feed.env" ]; then
 exists=$(docker exec "$db" psql -U postgres -d quest_devnet -Atc "SELECT count(*) FROM pg_roles WHERE rolname='quest_lp_timeline'")
 [ "$exists" = 0 ] || { echo 'Existing publisher role has no protected environment; operator repair required'; exit 1; }
 pw=$(openssl rand -hex 24)
 docker exec -i "$db" psql -U postgres -d quest_devnet -v ON_ERROR_STOP=1 -q <<SQL
CREATE ROLE quest_lp_timeline LOGIN PASSWORD '$pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE quest_devnet TO quest_lp_timeline;
SQL
 cat > "$dir/lp-feed.env" <<ENV
QUEST_LP_TIMELINE_DB_URL=postgres://quest_lp_timeline:$pw@quest-db:5432/quest_devnet
QUEST_LP_RPC_URL=$rpc
QUEST_SWAP_CAMPAIGN_ID=$campaign
QUEST_ENVIRONMENT_ID=$envid
QUEST_MANIFEST_SHA256=$manifest
QUEST_LP_FEED_INTERVAL_SECONDS=30
QUEST_LP_MAX_RANGES=4
QUEST_LP_SLOTS_PER_RANGE=256
ENV
 chmod 600 "$dir/lp-feed.env"
 unset pw
fi
docker run --rm --network solve3-quest_internal --env-file "$dir/tools.env" "$image" bun -e '
 const pg=await import("pg");const {timelinePublisherGrants}=await import("./server/swap-grants.mjs");
 const client=new pg.default.Client({connectionString:process.env.QUEST_OWNER_DB_URL});
 try{await client.connect();for(const sql of timelinePublisherGrants("\"quest_lp_timeline\""))await client.query(sql);}
 finally{await client.end();}'
printf 'LP publisher role/environment provisioned; no inventory or XP changed\n'
