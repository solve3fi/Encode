#!/usr/bin/env bash
# Fresh Devnet deploy of the STANDARD (7-day epoch, no fast-epochs) build for solve3.fi, run inside WSL from anywhere:
#   bash scripts/devnet/fresh-deploy.sh
# Stops at the first error. Safe to re-run: finished steps are skipped.
# Needs: program/admin keypairs in ~/.solve3-devnet-keys (never in the repo), built binaries in
# deploy-out/std, and about 18.5 Devnet SOL on the admin wallet. DEVNET ONLY.
set -euo pipefail
cd "$(dirname "$0")/../.."
K="$HOME/.solve3-devnet-keys"
R="$K/clean"
export REHEARSAL_DIR=clean
ADMIN="$K/id.json"
URL="devnet"
TREASURY="HRmz8NhLJDXYiSyR6STzBkofJZGb9ZMbbEh3rMHRVXNV"
BIN="deploy-out/std"

echo "== 0. standard build check"
if strings "$BIN/vesolve.so" | grep -q "fast-epochs test build"; then echo "ERROR: fast-epochs string found in vesolve.so, refusing"; exit 1; fi
echo "ok: no fast-epochs marker"
echo "== 1. addresses"
node scripts/devnet/prep-ids.mjs >/dev/null
id() { node -p "require('./deploy-out/ids.json').$1"; }
VESOLVE=$(id vesolve); SOLVE=$(id solve); TOKEN=$(id token)
SOLV3=$(id solv3)
echo "vesolve $VESOLVE"; echo "solve   $SOLVE"; echo "token   $TOKEN"; echo "solv3   $SOLV3"

echo "== 2. balance check"
ADMIN_PUB=$(solana-keygen pubkey "$ADMIN")
BAL=$(solana balance "$ADMIN_PUB" --url $URL | awk '{print $1}')
NEED=0.8
for pair in "token:$TOKEN:1.9" "solve:$SOLVE:7.2" "vesolve:$VESOLVE:8.6"; do
  name=${pair%%:*}; rest=${pair#*:}; pid=${rest%%:*}; cost=${rest##*:}
  if [ "$name" = "solve" ] && [ "${SKIP_SOLVE:-0}" = "1" ]; then continue; fi
  if ! solana program show "$pid" --keypair "$ADMIN" --url $URL >/dev/null 2>&1; then NEED=$(node -p "$NEED + $cost"); fi
done
echo "admin $ADMIN_PUB has $BAL SOL, this run needs about $NEED SOL (SKIP_SOLVE=${SKIP_SOLVE:-0})"
node -e "if (Number('$BAL') < Number('$NEED')) { console.error('not enough SOL, stopping'); process.exit(1); }"

deploy() { # name id
  if solana program show "$2" --keypair "$ADMIN" --url $URL >/dev/null 2>&1; then echo "$1 already deployed"; return; fi
  echo "deploying $1 ..."
  solana program deploy "$BIN/$1.so" --program-id "$R/$1-keypair.json" \
    --keypair "$ADMIN" --upgrade-authority "$ADMIN" --url $URL | tail -2
}
echo "== 3. deploy (admin is the upgrade authority until the timelock handover)"
deploy token "$TOKEN"
if [ "${SKIP_SOLVE:-0}" != "1" ]; then deploy solve "$SOLVE"; else echo "solve skipped (SKIP_SOLVE=1)"; fi
deploy vesolve "$VESOLVE"

echo "== 4. test mints"
mk() { # name decimals
  PUB=$(id "$1")
  if solana account "$PUB" --url $URL >/dev/null 2>&1; then echo "$1 mint exists"; return; fi
  spl-token create-token "$R/$1-mint.json" --decimals "$2" --mint-authority "$ADMIN" \
    --fee-payer "$ADMIN" --url $URL | sed -n "1,4p"
}
mk tusdc 6
mk bribe 6
mk tsol 9

echo "== 5. genesis"
ADMIN_KEYPAIR="$ADMIN" TOKEN="$TOKEN" TREASURY="$TREASURY" node scripts/devnet/genesis-token.mjs
ADMIN_KEYPAIR="$ADMIN" VESOLVE="$VESOLVE" TOKEN="$TOKEN" TREASURY="$TREASURY" EPOCH_SECONDS=604800 \
  node scripts/devnet/genesis-vesolve.mjs

if [ "${SKIP_SOLVE:-0}" = "1" ]; then echo "SKIP_SOLVE=1: stopping before pools; deploy solve and re-run without SKIP_SOLVE"; exit 0; fi
echo "== 6. DEX, pools, gauges"
node scripts/devnet/setup-dex.mjs
node scripts/devnet/setup-gauges.mjs

cat <<MSG

Deploy + genesis + pools + scheduled gauges are done. Next:
  * send ~5,000,000 SOLV3 (mint $SOLV3) from the Treasury wallet to alice (see scripts/devnet/scenarios.mjs)
  * after the next 20 minute epoch starts:  node scripts/devnet/epoch.mjs roll && node scripts/devnet/epoch.mjs configure
  * hand the three programs to the timelock (admin keypair signs):
      NEW=\$(node -e "const {PublicKey}=require('@solana/web3.js');console.log(PublicKey.findProgramAddressSync([Buffer.from('upgrade_authority')], new PublicKey('$VESOLVE'))[0].toBase58())")
      for P in $TOKEN $SOLVE $VESOLVE; do solana program set-upgrade-authority \$P --new-upgrade-authority \$NEW --skip-new-upgrade-authority-signer-check --upgrade-authority $ADMIN --keypair $ADMIN --url devnet; done
  * run readback.mjs, then scenarios.mjs fund/locks/vote/bribe/lp, emissions.mjs, bot.mjs, claims, attacks, pauses, more.mjs (see evidence file for the order)
MSG
