#!/usr/bin/env bash
# Installs and enables the public Auto-Vote keeper. Run as root on the server AFTER the owner has
# placed the AUTO_VOTE_KEEPER key at /etc/solve3/public-auto-vote-keeper.json (root, 0600).
# Nothing secret is printed, and nothing is enabled unless the key is exactly the program's keeper.
#
#   bash setup.sh /path/to/a/checkout/with/scripts   (a fresh git archive of the release)
set -euo pipefail
umask 077
src="${1:?path to the release checkout (contains scripts/ and deploy/public-auto-vote/)}"
key=/etc/solve3/public-auto-vote-keeper.json
expected=2wW8zBanRBtSt8iHXPCbTi3ZXSDdaRXQc9kSUC7rbwYN   # AUTO_VOTE_KEEPER in programs/vesolve/src/auth/admin.rs
[ -f "$key" ] || { echo "Place the keeper key at $key (root, mode 0600) first. Expected address: $expected"; exit 1; }
chmod 600 "$key"
actual=$(docker run --rm -v "$key":/k.json:ro --entrypoint /usr/local/bin/bun solve3-frontend:local -e '
const { Keypair } = require("@solana/web3.js");
const raw = JSON.parse(require("fs").readFileSync("/k.json", "utf8"));
console.log(Keypair.fromSecretKey(Uint8Array.from(raw)).publicKey.toBase58());')
[ "$actual" = "$expected" ] || { echo "That key is not the program's keeper (got $actual). Nothing was changed."; exit 1; }
echo "keeper key verified: $actual"

# The scripts the live keeper units bind-mount.
install -d /srv/solve3/scripts/lib
install -m 0644 "$src/scripts/public-auto-vote-keeper.mjs" /srv/solve3/scripts/public-auto-vote-keeper.mjs
install -m 0644 "$src/scripts/auto-vote-keeper.mjs" /srv/solve3/scripts/auto-vote-keeper.mjs
install -m 0644 "$src/scripts/lib/partner-vote-targets.mjs" /srv/solve3/scripts/lib/partner-vote-targets.mjs

# Only the RPC setting is shared with the admin keeper; its wallet-encryption secret is not copied.
grep -h '^SOLVE3_RPC_URL=\|^SOLVE3_DEVNET_RPC=' /etc/solve3/auto-vote-keeper.env > /etc/solve3/public-auto-vote-keeper.env || true
chmod 600 /etc/solve3/public-auto-vote-keeper.env

install -m 0644 "$src/deploy/public-auto-vote/solve3-public-auto-vote-keeper.service" /etc/systemd/system/
install -m 0644 "$src/deploy/public-auto-vote/solve3-public-auto-vote-keeper.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now solve3-public-auto-vote-keeper.timer
systemctl list-timers solve3-public-auto-vote-keeper.timer --no-pager | head -3
echo "public auto-vote keeper enabled"
