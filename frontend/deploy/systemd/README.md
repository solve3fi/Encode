# Solve3 epoch keeper

The keeper reconciles pool fee policy and checks Solana's confirmed block time
every five minutes. It only calls
`update_epoch` after the on-chain epoch end, then initializes the new emission and
funds each configured gauge once. Repeated runs are safe and repair a partially
completed settlement.

The current `update_epoch` instruction requires the protocol admin signature, so
the timer must run with that signer until the program is upgraded to make rollover
permissionless.

## Trading-fee policy

This source requires the coordinated native-emissions upgrade described in
[the rollout guide](../../docs/native-gauge-emissions-rollout.md). Do not install
this keeper against the previous contracts. The September 14 devnet 80/20
configuration is historical, not the target policy below.

Without an active gauge, LPs earn 100% of trading fees and no new emissions.
With an active native gauge, 100% of trading fees go to that gauge's voter reward
vault; LPs share its entire weekly emission allocation by eligible in-range
liquidity over time. Pausing atomically sweeps accrued gauge fees, stops the
emission stream, and returns future trading fees to LPs. Earned claims survive.

The keeper reads every DEX pool and every gauge account, validates each gauge's
protocol PDA and pool membership, and reconciles all pools in this DEX config.
RPC or validation failures abort instead of treating missing data as "no gauge".
It rechecks gauge state before each pool update, verifies writes, and repairs
a detected gauge-creation race. Admin creation/activation/pause changes status,
fees and emission checkpoints in one transaction. A bare create instruction
now creates an inactive gauge until native configuration succeeds.

Fee routing and emission funding now discover all active gauges by default.
`SOLVE3_ACTIVE_GAUGES`, when set, is an explicit allowlist for **routing and funding
only**. It does not narrow fee-policy reconciliation. Gauges omitted from an
allowlist retain their post-creation fee policy, but their protocol fees remain
in the pool until routing is enabled. Review any existing allowlist when adding
a new gauge.

To apply or preview only fee settings, append `--fee-policy-only` to the keeper
command below. With `--dry-run --fee-policy-only`, it sends no transactions. With
`--fee-policy-only` alone, it updates fee rates and exits **before fee collection,
transfers, epoch rollover or emission initialization/funding**. Repeated runs are
idempotent. The script verifies the devnet genesis hash before reconciliation.
Rates apply prospectively: existing protocol-fee counters are not returned to
LPs or redistributed by this mode.

The keeper fails closed if any active gauge has not migrated to native rewards.
The new accounting uses liquidity and tick-range growth, independent of LP fee
growth, so a 100% protocol fee share does not zero the LP emission weight.

Normal routing calls `route_pool_fees`: it creates missing gauge token accounts
and collects exact live counters directly into the epoch vault atomically.
There is no keeper staging balance or stale off-chain fee amount. A failed sweep
blocks rollover; `--fee-policy-only` does not collect fees or migrate rewards.

## VPS installation

1. Put the admin keypair at `/etc/solve3/admin-keypair.json` with mode `0600` and
   ownership `root:root`. Never commit it to this repository.
2. Copy `epoch-keeper.env.example` to `/etc/solve3/epoch-keeper.env` and set the
   RPC URL. The keypair path in this file is the container path and should not be
   changed.
3. Copy the service and timer to `/etc/systemd/system/`.
4. Run a safe check first:

   ```sh
   docker run --rm --read-only --network host \
     --env-file /etc/solve3/epoch-keeper.env \
     -v /srv/solve3/scripts:/app/scripts:ro \
     -v /srv/solve3/src/configs/vesolve.json:/app/src/configs/vesolve.json:ro \
     -v /etc/solve3/admin-keypair.json:/run/secrets/solve3-admin-keypair.json:ro \
     --entrypoint /usr/local/bin/bun solve3-frontend:local \
     /app/scripts/finalize-devnet-epoch.mjs --dry-run
   ```

5. Enable it with `systemctl enable --now solve3-epoch-keeper.timer`.

Review runs with `journalctl -u solve3-epoch-keeper.service` and the next scheduled
check with `systemctl list-timers solve3-epoch-keeper.timer`.

## Admin auto-vote wallets keeper

Votes the pool allocation set in the Admin page's "Admin Auto-Vote Wallets"
section on behalf of each wallet configured there, every five minutes, so
they always have a vote in before the epoch's cutoff. It's a separate timer
from the epoch keeper above since it has nothing to do with settlement.

The wallets' secret keys are pasted into the Admin UI and stored encrypted
in `admin-auto-vote-wallets.json` inside the app's `/app/data` — a named
Docker volume (`solve3-production_solve3_data`, per compose.yml's `app`
service; run `docker volume ls` to confirm the name if the compose project
is ever renamed), not a host directory — this keeper decrypts them with
`WALLET_CONFIG_ENCRYPTION_KEY`, which **must be the same value** the main
app container has, since that's what encrypted them in the first place. Add
it to both:

- the deploy compose `.env`, **and** `compose.yml` itself — the `app`
  service only passes through env vars explicitly listed under its
  `environment:` block (currently just `FAUCET_AUTHORITY_SECRET_KEY`), so
  add a `WALLET_CONFIG_ENCRYPTION_KEY: ${WALLET_CONFIG_ENCRYPTION_KEY}`
  line there too, then recreate the app container for it to take effect
  (no rebuild needed — it's a runtime env var, not a `NEXT_PUBLIC_` build
  arg):
  ```sh
  docker compose -f /srv/solve3-deploy/compose.yml up -d --no-build --force-recreate app
  ```
- `/etc/solve3/auto-vote-keeper.env` (so this keeper can decrypt them).

### VPS installation

1. Generate a key and set it in both places above:
   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Copy `auto-vote-keeper.env.example` to `/etc/solve3/auto-vote-keeper.env`
   and fill in the encryption key.
3. Copy `solve3-auto-vote-keeper.service` and `.timer` to
   `/etc/systemd/system/`.
4. Dry-run first — this only prints what it *would* vote, no transaction is
   sent and the data volume isn't touched:
   ```sh
   docker run --rm --read-only --network host \
     --env-file /etc/solve3/auto-vote-keeper.env \
     -v /srv/solve3/scripts:/app/scripts:ro \
     -v /srv/solve3/src/configs/vesolve.json:/app/src/configs/vesolve.json:ro \
     -v solve3-production_solve3_data:/app/data:rw \
     --entrypoint /usr/local/bin/bun solve3-frontend:local \
     /app/scripts/auto-vote-keeper.mjs --dry-run
   ```
5. Enable it with `systemctl enable --now solve3-auto-vote-keeper.timer`.

Each wallet's last vote status (epoch voted, signature, or the last error)
shows directly in the Admin UI's wallet table — no separate log check needed
day-to-day, though `journalctl -u solve3-auto-vote-keeper.service` has the
full run history.

## Public auto-vote keeper

Votes every lock enrolled in **Public Auto-Vote** (the `/lock/auto-vote`
page — a lock owner delegates voting rather than handing over custody, see
`programs/vesolve/src/instructions/auto_vote.rs`) toward whichever gauges
look like the best return this epoch, ranked by the heuristic in
`scripts/public-auto-vote-keeper.mjs`'s header comment: devnet has no price
oracle, so it only prices reward tokens denominated in devUSDC (pegged to
$1, same as the rest of the app) and skips anything it can't value. Mainnet
should replace that heuristic with a real Pyth-priced ranking before this
keeper ever runs against it.

Unlike the admin wallets keeper above, enrollment and prior votes are read
straight from on-chain state — there's no local file to encrypt or restore,
and no data volume mount. What this keeper's own key custody does need,
before it's trusted with real value: move it off a plain keyfile onto the
same encrypted-at-rest scheme as the admin wallets keeper
(`src/lib/server/secretEncryption.ts`) rather than a `0600` file on disk.

The keeper pays every vote's transaction fee and any `user_vote` PDA rent
itself (not the enrolled lock's owner), so its own wallet needs a real SOL
balance, separate from the protocol admin key — check it with
`solana balance <pubkey> --url <rpc>` and top it up the same way you would
any other devnet wallet.

### VPS installation

1. Generate a keypair for the keeper if it doesn't have one yet:
   ```sh
   solana-keygen new --no-bip39-passphrase -o public-auto-vote-keeper.json
   ```
   Its pubkey must match `AUTO_VOTE_KEEPER` in
   `programs/vesolve/src/auth/admin.rs` — that constant is compiled into the
   program, so changing which key this is requires a program upgrade.
2. Put the keypair at `/etc/solve3/public-auto-vote-keeper.json` with mode
   `0600` and ownership `root:root`. Never commit it to this repository.
3. Fund it with enough devnet SOL to cover vote transactions/rent for
   however many locks are enrolled.
4. Copy `public-auto-vote-keeper.env.example` to
   `/etc/solve3/public-auto-vote-keeper.env`.
5. Copy `public-auto-vote-keeper.service` and `.timer` to
   `/etc/systemd/system/`.
6. Dry-run first — this only prints the ranking and what it *would* vote, no
   transaction is sent:
   ```sh
   docker run --rm --read-only --network host \
     --env-file /etc/solve3/public-auto-vote-keeper.env \
     -v /srv/solve3/scripts:/app/scripts:ro \
     -v /srv/solve3/src/configs/vesolve.json:/app/src/configs/vesolve.json:ro \
     -v /etc/solve3/public-auto-vote-keeper.json:/run/secrets/solve3-public-auto-vote-keeper.json:ro \
     --entrypoint /usr/local/bin/bun solve3-frontend:local \
     /app/scripts/public-auto-vote-keeper.mjs --dry-run
   ```
7. Enable it with `systemctl enable --now public-auto-vote-keeper.timer`.

`journalctl -u public-auto-vote-keeper.service` has the full run history,
including the gauge ranking computed each run.
