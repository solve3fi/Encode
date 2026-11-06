use anchor_lang::prelude::*;

#[event]
pub struct ProtocolInitialized {
  pub admin: Pubkey,
  pub token_mint: Pubkey,
  pub next_nft_token_id: u64,
  pub total_supply: u64,
  pub total_locked: u64,
  pub current_epoch: u64,
  pub epoch_start_time: i64,
  pub epoch_reset_time: i64,
}

#[event]
pub struct LockCreated {
  pub owner: Pubkey,
  pub nft_token_id: u64,
  pub token_mint: Pubkey,
  pub amount: u64,
  pub unlock_time: i64,
  pub voting_power: u64,
  pub last_vote_epoch: u64,
}

#[event]
pub struct LockExtended {
  pub owner: Pubkey,
  pub nft_token_id: u64,
  pub old_unlock_time: i64,
  pub new_unlock_time: i64,
}

#[event]
pub struct LockUpdated {
  pub owner: Pubkey,
  pub nft_token_id: u64,
  pub old_amount: u64,
  pub new_amount: u64,
  pub old_voting_power: u64,
  pub new_voting_power: u64,
}


#[event]
pub struct LockBurned {
  pub owner: Pubkey,
  pub nft_token_id: u64,
}

#[event]
pub struct LockTransferred {
  pub from: Pubkey,
  pub to: Pubkey,
  pub nft_token_id: u64,
}

#[event]
pub struct LockExited {
  pub owner: Pubkey,
  pub nft_token_id: u64,
  /// SOLV3 base units returned to the owner — the full principal.
  pub amount: u64,
  /// SOL paid to the protocol treasury for the exit.
  pub fee_lamports: u64,
  /// The rate the fee was priced at, for auditability.
  pub lamports_per_solv3: u64,
  /// The fee percentage (basis points) in force for this exit.
  pub fee_bps: u64,
  /// SOLV3 base units still locked after this exit (0 for a full exit).
  pub remaining_amount: u64,
}

#[event]
pub struct ExitFeeScheduled {
  pub updated_by: Pubkey,
  /// The percentage in force now.
  pub current_bps: u64,
  /// The percentage that applies from `effective_epoch`.
  pub new_bps: u64,
  pub effective_epoch: u64,
}

#[event]
pub struct ExitPriceUpdated {
  pub updated_by: Pubkey,
  pub lamports_per_solv3: u64,
  pub updated_at: i64,
}

#[event]
pub struct ExitFeesWithdrawn {
  pub admin: Pubkey,
  pub destination: Pubkey,
  pub amount: u64,
}

#[event]
pub struct GaugeCreated {
  pub pool_address: Pubkey,
  pub token_mint_a: Pubkey,
  pub token_mint_b: Pubkey,
  pub fee_tier: u16,
  pub is_active: bool,
}

/// kind: 0 = activation scheduled, 1 = removal requested, 2 = migration scheduled.
#[event]
pub struct GaugeScheduled {
  pub gauge: Pubkey,
  pub pool: Pubkey,
  pub kind: u8,
  pub effective_epoch: u64,
}

/// Emitted when a scheduled change is executed. status uses the GAUGE_* values.
#[event]
pub struct GaugeStatusChanged {
  pub gauge: Pubkey,
  pub pool: Pubkey,
  pub status: u8,
  pub epoch: u64,
}

#[event]
pub struct EpochUpdated {
  pub epoch: u64,
  pub start_time: i64,
  pub end_time: i64
}

#[event]
pub struct VaultCreated {
  pub admin: Pubkey,
  pub gauge: Pubkey,
  pub token_mint: Pubkey,
  pub epoch: u64,
  pub rewards: u64,
}

#[event]
pub struct RewardClaimed {
  pub user: Pubkey,
  pub gauge: Pubkey,
  pub token_mint: Pubkey,
  pub epoch: u64,
  pub amount: u64,
  pub claim_time: i64,
}

#[event]
pub struct AutoVoteEnrolled {
  pub lock: Pubkey,
  pub owner: Pubkey,
  pub enrolled_at: i64,
}

#[event]
pub struct AutoVoteRevoked {
  pub lock: Pubkey,
  pub owner: Pubkey,
}

#[event]
pub struct AutoVoterRegistered {
  pub authority: Pubkey,
}

#[event]
pub struct AutoVoterDeregistered {
  pub authority: Pubkey,
}

#[event]
pub struct AutoVoterSet {
  pub lock: Pubkey,
  pub owner: Pubkey,
  pub voter: Pubkey,
}

#[event]
pub struct AutoVoterCleared {
  pub lock: Pubkey,
  pub owner: Pubkey,
}

#[event]
pub struct PoolFeesSwept {
  pub gauge: Pubkey,
  pub epoch: u64,
  pub token_mint_a: Pubkey,
  pub amount_a: u64,
  pub token_mint_b: Pubkey,
  pub amount_b: u64,
  pub treasury: Pubkey,
}

#[event]
pub struct AutoVoteFeesWithdrawn {
  pub admin: Pubkey,
  pub token_mint: Pubkey,
  pub destination: Pubkey,
  pub amount: u64,
}

#[event]
pub struct BribeTokenUpdated {
  pub admin: Pubkey,
  pub mint: Pubkey,
  pub allowed: bool,
  pub paused: bool,
  pub updated_at: i64,
}

#[event]
pub struct PausesUpdated {
  pub admin: Pubkey,
  pub paused_global: bool,
  pub paused_voting: bool,
  pub paused_bribes: bool,
  pub paused_claims: bool,
  pub paused_exit: bool,
  pub paused_gauge_activation: bool,
  pub paused_emissions: bool,
  pub updated_at: i64,
}

#[event]
pub struct AdminTransferProposed {
  pub admin: Pubkey,
  pub pending_admin: Pubkey,
}

#[event]
pub struct AdminTransferred {
  pub old_admin: Pubkey,
  pub new_admin: Pubkey,
}

#[event]
pub struct AdminParamsUpdated {
  pub admin: Pubkey,
  pub gate_phi_set: bool,
  pub gate_phi_ppm: u32,
  pub treasury: Pubkey,
  pub updated_at: i64,
}

#[event]
pub struct BribeSwept {
  pub gauge: Pubkey,
  pub token_mint: Pubkey,
  pub epoch: u64,
  pub amount: u64,
  pub treasury: Pubkey,
}

#[event]
pub struct UngaugedFeesSwept {
  pub pool: Pubkey,
  pub amount_a: u64,
  pub amount_b: u64,
  pub treasury: Pubkey,
}

#[event]
pub struct UpgradeScheduled {
  pub program: Pubkey,
  pub buffer: Pubkey,
  pub executable_at: i64,
}

#[event]
pub struct UpgradeCancelled {
  pub program: Pubkey,
  pub buffer: Pubkey,
}

#[event]
pub struct UpgradeExecuted {
  pub program: Pubkey,
  pub buffer: Pubkey,
}

#[event]
pub struct AllocationVoterSet {
  pub lock: Pubkey,
  pub owner: Pubkey,
  pub registered: bool,
}

#[event]
pub struct AllocationVotesSet {
  pub lock: Pubkey,
  pub version: u32,
  pub gauge_count: u32,
}

#[event]
pub struct AllocationVoteApplied {
  pub lock: Pubkey,
  pub epoch: u64,
  pub version: u32,
}

#[event]
pub struct TreasuryChangeScheduled {
  pub admin: Pubkey,
  pub treasury: Pubkey,
  pub executable_at: i64,
}

#[event]
pub struct TreasuryChanged {
  pub treasury: Pubkey,
}

#[event]
pub struct KeeperSet {
  pub admin: Pubkey,
  pub keeper: Pubkey,
}

#[event]
pub struct PoolFeeRateSynced {
  pub pool: Pubkey,
  pub protocol_fee_rate: u16,
}

#[event]
pub struct PartnerVoterSet {
  pub admin: Pubkey,
  pub voter: Pubkey,
}

#[event]
pub struct PartnerVoterRemoved {
  pub admin: Pubkey,
  pub voter: Pubkey,
}
