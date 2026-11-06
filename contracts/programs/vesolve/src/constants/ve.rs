// Seeds for PDAs
pub const PROTOCOL_SEED: &[u8] = b"protocol";
pub const VE_LOCK_SEED: &[u8] = b"ve_lock";
pub const VE_TOKEN_SEED: &[u8] = b"ve_token";
pub const GAUGE_SEED: &[u8] = b"gauge";
pub const VAULT_SEED: &[u8] = b"vault";
pub const USER_VOTE_SEED: &[u8] = b"user_vote";
pub const BRIBE_SEED: &[u8] = b"bribe";
pub const EPOCH_DATA_SEED: &[u8] = b"epoch_data";
pub const USER_REWARDS_SEED: &[u8] = b"user_rewards";
pub const USER_POOL_REWARDS_SEED: &[u8] = b"user_pool_rewards";
pub const USER_BRIBE_REWARDS_SEED: &[u8] = b"user_bribe_rewards";
pub const GAUGE_REWARD_SEED: &[u8] = b"gauge_reward";
pub const GAUGE_STAKE_SEED: &[u8] = b"gauge_stake";
pub const EPOCH_EMISSION_SEED: &[u8] = b"epoch_emission";
pub const EXIT_CONFIG_SEED: &[u8] = b"exit_config";
pub const POOL_FEE_VAULT_SEED: &[u8] = b"pool_fee_vault";
pub const POOL_FEE_POSITION_SEED: &[u8] = b"pool_fee_position";
pub const AUTO_VOTE_SEED: &[u8] = b"auto_vote";
// DEV-12: wallets registered to vote enrolled locks, and a lock owner's choice among them.
pub const AUTO_VOTER_SEED: &[u8] = b"auto_voter";
pub const AUTO_VOTE_DELEGATE_SEED: &[u8] = b"auto_vote_delegate";
pub const VOTE_LOCK_SEED: &[u8] = b"vote_lock";
pub const BRIBE_TOKEN_SEED: &[u8] = b"bribe_token";
pub const ADMIN_CONFIG_SEED: &[u8] = b"admin_config";
pub const TREASURY_CHANGE_SEED: &[u8] = b"treasury_change";
pub const KEEPER_CONFIG_SEED: &[u8] = b"keeper_config";
/// Marks a voter wallet as a partner: locks it votes for pay no auto-vote fee.
pub const PARTNER_VOTER_SEED: &[u8] = b"partner_voter";

// Time constants
#[cfg(not(feature = "fast-epochs"))]
pub const WEEK: i64 = 7 * 24 * 60 * 60; // 1 week in seconds
/// TEST BUILDS ONLY (Devnet rehearsal): a 20 minute "week". Never enabled in a
/// release build; `initialize` logs when it is on so evidence shows which build ran.
#[cfg(feature = "fast-epochs")]
pub const WEEK: i64 = 20 * 60;
#[cfg(feature = "fast-epochs")]
pub const FAST_EPOCHS: bool = true;
#[cfg(not(feature = "fast-epochs"))]
pub const FAST_EPOCHS: bool = false;
pub const MIN_LOCK_TIME: i64 = 50 * 365 * 24 * 60 * 60; // Minimum 50 years lock
pub const MAX_LOCK_TIME: i64 = 100 * 365 * 24 * 60 * 60; // Maximum 100 years lock (for 100% voting power)
// Voting and bribe deposits close 5 minutes before rollover: Wednesday 23:55 UTC
// (Full Launch rule A5). Weekly epochs roll over Thursday 00:00 UTC.
/// A Treasury change waits this long before it can be applied (review H-1), so a stolen Admin key cannot
/// redirect fee withdrawals at once and the change is visible on chain first.
#[cfg(not(feature = "fast-epochs"))]
pub const TREASURY_CHANGE_DELAY_SECONDS: i64 = 24 * 60 * 60;
#[cfg(feature = "fast-epochs")]
pub const TREASURY_CHANGE_DELAY_SECONDS: i64 = 60;
/// The exit price may move at most this share per update and at most once per interval (review L-3), for
/// the Admin and the price keeper alike, once a first price is set.
pub const MAX_EXIT_PRICE_STEP_BPS: u64 = 2_500;
#[cfg(not(feature = "fast-epochs"))]
pub const MIN_EXIT_PRICE_UPDATE_INTERVAL: i64 = 60 * 60;
#[cfg(feature = "fast-epochs")]
pub const MIN_EXIT_PRICE_UPDATE_INTERVAL: i64 = 30;
#[cfg(not(feature = "fast-epochs"))]
pub const VOTE_REVOCATION_DEADLINE: i64 = 5 * 60;
#[cfg(feature = "fast-epochs")]
pub const VOTE_REVOCATION_DEADLINE: i64 = 20;

// Published SOLV3 tokenomics. Amounts use the SOLV3 mint's 9 decimals.
pub const INITIAL_WEEKLY_EMISSION: u64 = 1_300_000_000_000_000;
pub const EMISSION_DECAY_NUMERATOR: u128 = 98;
pub const EMISSION_DECAY_DENOMINATOR: u128 = 100;
pub const DEVELOPER_ALLOCATION_BPS: u64 = 400;
pub const BPS_DENOMINATOR: u64 = 10_000;

// Exiting a permanent lock costs 40% of the position's market value, paid in
// SOL, and returns the full SOLV3 principal (published in the protocol
// charter). The SOLV3-per-SOL rate the percentage applies to is not derivable
// on-chain — see states/exit_config.rs.
pub const EXIT_FEE_BPS: u64 = 4_000; // initial value; Admin can change it, effective next epoch
pub const MAX_EXIT_FEE_BPS: u64 = 10_000;
pub const EXIT_FEE_CONFIG_SEED: &[u8] = b"exit_fee_config";

// Exit is completely disabled through the first four weeks after launch
// (Full Launch handoff D2). Epoch 0 is launch week, so epochs 0-3 are weeks
// 1-4 and Exit may open no earlier than epoch 4. Opening it after that is
// still gated on an approved manipulation-resistant oracle (D4); this
// constant is a floor, not an enablement decision.
pub const EXIT_DISABLED_UNTIL_EPOCH: u64 = 4;

// One whole SOLV3 in base units; the exit rate is quoted per whole token.
pub const SOLV3_UNITS_PER_TOKEN: u128 = 1_000_000_000;

// Vote constants
pub const MAX_GAUGE_VOTES: u64 = 50;
pub const MAX_VOTE_WEIGHT: u64 = 100;
// Bribe entries per epoch across all gauges (Epoch.bribes capacity; the account stays under the 10,240-byte
// creation limit) and per gauge, so dust bribes on many pairs cannot fill the epoch (review M-2). Epoch
// accounts created before this release keep their old capacity of 20.
pub const MAX_BRIBE_WEIGHT: u64 = 64;
pub const MAX_BRIBES_PER_GAUGE: u64 = 8;
pub const VOTE_WEIGHT_PRECISION: u64 = 100; // 100.00% = 100

// Math constants
pub const PRECISION: u128 = 1_000_000;

// Public Auto-Vote: a lock enrolled here has its voting rewards charged this
// rate to the protocol treasury (see claim_bribe_reward.rs / claim_pool_reward.rs)
// in exchange for the keeper voting the highest-return pools on its behalf.
pub const AUTO_VOTE_FEE_BPS: u64 = 1_500; // 15%

/// Smallest tick spacing a gauge-eligible pool may use. Seth chose on
/// 2026-10-01 to allow every fee tier (spacing 1 and up) so stablecoin pairs
/// can earn emissions; this replaces the earlier floor of 64 (about 0.64%).
pub const MIN_GAUGE_TICK_SPACING: u16 = 1;

/// Protocol share (of 10,000) on pools without an active gauge: 5% to the Treasury, 95% to LPs.
pub const UNGAUGED_PROTOCOL_FEE_RATE: u16 = 500;
/// Protocol share on gauged pools: all fees go to voters.
pub const GAUGED_PROTOCOL_FEE_RATE: u16 = 10_000;

/// Program upgrades wait this long between being scheduled and executed (F3).
pub const UPGRADE_DELAY_SECONDS: i64 = 24 * 60 * 60;
pub const UPGRADE_SCHEDULE_SEED: &[u8] = b"upgrade";
/// PDA that must hold each program's upgrade authority (and the authority of
/// any buffer scheduled for deployment) for the timelock to bind.
pub const UPGRADE_AUTHORITY_SEED: &[u8] = b"upgrade_authority";

pub const ALLOCATION_VOTER_SEED: &[u8] = b"allocation";
