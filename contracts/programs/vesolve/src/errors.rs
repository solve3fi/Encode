use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
  #[msg("Unauthorized")]  
  Unauthorized,

  #[msg("Gauge already exists")]  
  GaugeAlreadyExists,

  #[msg("Invalid mint")]  
  InvalidMint,

  #[msg("Invalid owner")]  
  InvalidOwner,

  #[msg("Invalid amount")]  
  InvalidAmount,

  #[msg("Invalid unlock time")]  
  InvalidUnlockTime,

  #[msg("Invalid token account")]  
  InvalidTokenAccount,

  #[msg("Insufficient funds")]  
  InsufficientFunds,

  #[msg("Invalid ve token id")]  
  InvalidVeTokenId,

  #[msg("Lock expired")]  
  LockExpired,

  #[msg("Cannot decrease lock time")]  
  CannotDecreaseLockTime,

  #[msg("Invalid lock")]  
  InvalidLock,

  #[msg("Invalid epoch")]  
  InvalidEpoch,

  #[msg("Lock not expired")]  
  LockNotExpired,

  #[msg("Arithmetic overflow")]  
  ArithmeticOverflow,

  #[msg("Invalid voting power")]  
  InvalidVotingPower,

  #[msg("Invalid gauge votes")]  
  InvalidGaugeVotes,

  #[msg("Vote expired")]  
  VoteExpired,

  #[msg("Invalid gauge")]  
  InvalidGauge,

  #[msg("Already claimed")]  
  AlreadyClaimed,

  #[msg("Lock has active votes")]
  LockHasActiveVotes,

  #[msg("Epoch has not ended")]
  EpochNotEnded,

  #[msg("Voting rewards become claimable after one complete additional epoch")]
  VotingRewardsNotClaimableYet,

  #[msg("Emission for this gauge and epoch has already been funded")]
  EmissionAlreadyFunded,

  #[msg("This position is not staked by the signer")]
  InvalidStakeOwner,

  #[msg("Position has no liquidity")]
  PositionHasNoLiquidity,

  #[msg("Gauge reward period is not initialized")]
  RewardPeriodNotInitialized,

  #[msg("The exit price has not been published yet")]
  ExitPriceNotSet,

  #[msg("Withdrawing this amount would leave the protocol account below rent exemption")]
  InsufficientTreasuryBalance,

  #[msg("Gauge is not active")]
  GaugeInactive,

  #[msg("Epoch has not been finalized yet")]
  EpochNotFinalized,

  #[msg("Position is out of range and does not qualify for gauge rewards")]
  PositionOutOfRange,

  #[msg("Maximum number of bribes for this gauge has been reached for this epoch")]
  MaxBribesPerGaugeReached,

  #[msg("No position is registered for this pool's fee vault yet")]
  PoolFeeVaultHasNoRegisteredWeight,

  #[msg("Use native range-aware LP emissions; legacy funding/staking is disabled")]
  NativeGaugeRequired,
  #[msg("Collect this pool's accrued protocol fees under its current routing before switching its gauge")]
  GaugeFeesMustBeSwept,
  #[msg("Legacy stake must be migrated after its gauge reward stream is frozen")]
  LegacyStakeMigrationRequired,
  #[msg("Gauge fee routing currently supports classic SPL pool tokens only")]
  UnsupportedGaugeTokenProgram,

  #[msg("This lock did not cast the vote being claimed against")]
  LockDidNotCastVote,
  #[msg("Exit is disabled until the fourth week after launch has ended")]
  ExitDisabled,
  #[msg("Bribe deposits for this epoch are closed")]
  BribeWindowClosed,
  #[msg("This token is not an approved bribe reward token")]
  BribeTokenNotAllowed,
  #[msg("This reward token is paused")]
  BribeTokenPaused,
  #[msg("This system is paused")]
  SystemPaused,
  #[msg("Gauge pools need a valid tick spacing")]
  PoolRangeTooNarrow,
  #[msg("Gate threshold is out of range")]
  InvalidGateThreshold,
  #[msg("Treasury has not been set")]
  TreasuryNotSet,
  #[msg("This gauge received votes, so its bribes belong to its voters")]
  GaugeHasVotes,
  #[msg("Only pools on the ungauged fee rate can be swept to the Treasury")]
  PoolNotUngauged,
  #[msg("Exit fee must be between 0 and 10,000 basis points")]
  InvalidExitFee,
  #[msg("Exit fees can only be withdrawn to the Treasury")]
  InvalidTreasury,
  #[msg("A partial exit must leave part of the lock; use exit_lock to exit all of it")]
  PartialExitMustLeaveRemainder,
  #[msg("The gauge is not in the right state for this change")]
  GaugeStateInvalid,
  #[msg("This change is scheduled for a later epoch")]
  GaugeTransitionNotDue,
  #[msg("This token pair already has a gauge-eligible pool")]
  PairHasGauge,
  #[msg("The pair accounts do not match the gauge")]
  InvalidPair,
  #[msg("This upgrade is still inside its 24 hour timelock")]
  UpgradeNotDue,
  #[msg("The upgrade buffer is invalid or is not controlled by the upgrade authority")]
  InvalidUpgradeBuffer,
  #[msg("The program's upgrade authority is not the timelock PDA")]
  UpgradeAuthorityMismatch,
  #[msg("This allocation vote was already applied for the current epoch")]
  AllocationAlreadyApplied,
  #[msg("None of the stored allocation gauges can take votes right now")]
  NoVotableAllocation,
  #[msg("The gauge has no votes in this epoch, so its fees would be unclaimable")]
  GaugeHasNoVotes,
  #[msg("The owner chose a different auto-voter for this lock")]
  AutoVoterNotChosen,
  #[msg("No Treasury change is pending, or its delay has not passed yet")]
  TreasuryChangeNotDue,
  #[msg("Only fees collected on top of the locked principal can be withdrawn")]
  WithdrawalExceedsFees,
  #[msg("The exit price can move at most 25% per update and once per interval")]
  ExitPriceStepTooLarge,
  #[msg("This lock has been fully exited or merged and holds nothing")]
  LockIsEmpty,
  #[msg("The pool's protocol fee rate already matches its gauge status")]
  FeeRateAlreadySynced,
}
