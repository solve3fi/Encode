use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{AUTO_VOTE_SEED, BPS_DENOMINATOR, PROTOCOL_SEED, USER_BRIBE_REWARDS_SEED, VE_LOCK_SEED, VOTE_LOCK_SEED, USER_VOTE_SEED, AUTO_VOTE_FEE_BPS};
use crate::errors::ErrorCode;
use crate::events::RewardClaimed;
use crate::states::{BribeToken, Epoch, Gauge, ClaimedRewards, Lock, PartnerVoter, Protocol, UserVote, VaultData, VoteLockRecord};
use crate::utils::transfer_token_from_vault;

#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct BribesReward<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()],
    bump = lock.bump,
    constraint = lock.owner == user.key() @ ErrorCode::InvalidOwner,
  )]
  pub lock: Box<Account<'info, Lock>>,

  /// Whether this exists (owned by this program) is what determines the
  /// AUTO_VOTE_FEE_BPS split applies -- checked as raw account state in the
  /// handler rather than trusting a client-declared flag, since "not
  /// enrolled" must not be something a caller can simply assert to dodge
  /// the fee.
  #[account(
    seeds = [AUTO_VOTE_SEED, lock.key().as_ref()],
    bump,
  )]
  /// CHECK: see comment above
  pub auto_vote_enrollment: UncheckedAccount<'info>,

  /// CHECK: This is not a signer, but it is required for PDA
  pub gauge: Box<Account<'info, Gauge>>,

  #[account(mut)]
  pub epoch: Box<Account<'info, Epoch>>,

  #[account(
    mut,
    constraint = vault.gauge == gauge.key() && vault.epoch == epoch.epoch @ ErrorCode::InvalidGauge,
  )]
  pub vault: Box<Account<'info, VaultData>>,

  #[account(mut)]
  pub token_mint: Box<InterfaceAccount<'info, Mint>>,

  /// Per-token pause switch. May be an empty, system-owned account for a token
  /// that was never configured (claims then stay open); the handler checks it
  /// is the canonical PDA for `token_mint`.
  /// CHECK: validated in `BribeToken::is_paused_for_claims`
  pub bribe_token: UncheckedAccount<'info>,

  /// Created on first claim, so a voter who never held the bribe token can still claim it.
  #[account(
    init_if_needed,
    payer = user,
    associated_token::mint = token_mint,
    associated_token::authority = user,
  )]
  pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

  #[account(
    mut,
    associated_token::mint = token_mint.key(),
    associated_token::authority = vault.key(),
    constraint = bribe_vault_token_account.mint == token_mint.key() @ ErrorCode::InvalidMint,
  )]
  pub bribe_vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

  /// Only ever written to when auto_vote_enrollment is populated -- created
  /// lazily since most claims are never for an enrolled lock.
  #[account(
    init_if_needed,
    payer = user,
    associated_token::mint = token_mint,
    associated_token::authority = protocol,
  )]
  pub treasury_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

  #[account(
    init_if_needed,
    payer = user,
    space = 8 + ClaimedRewards::INIT_SPACE,
    seeds = [USER_BRIBE_REWARDS_SEED, lock.key().as_ref(), epoch.key().as_ref(), gauge.key().as_ref(), token_mint.key().as_ref()],
    bump
  )]
  pub user_rewards: Box<Account<'info, ClaimedRewards>>,

  // One vote record per lock and epoch. The claimer is the lock's current
  // owner (checked on `lock`), so a position's vote follows the position.
  #[account(
    mut,
    seeds = [USER_VOTE_SEED, lock.key().as_ref(), epoch.epoch.to_le_bytes().as_ref()],
    bump = user_vote.bump,
    constraint = user_vote.epoch == epoch.epoch @ ErrorCode::Unauthorized,
  )]
  pub user_vote: Box<Account<'info, UserVote>>,

  // Binds the auto-vote fee check to the lock that actually cast the vote
  // user_vote holds, rather than trusting the ve_token_id the claimer
  // supplies -- see the comment on VoteLockRecord.
  #[account(
    seeds = [VOTE_LOCK_SEED, lock.key().as_ref(), epoch.epoch.to_le_bytes().as_ref()],
    bump = vote_lock_record.bump,
    constraint = vote_lock_record.ve_token_id == ve_token_id @ ErrorCode::LockDidNotCastVote,
  )]
  pub vote_lock_record: Box<Account<'info, VoteLockRecord>>,

  pub system_program: Program<'info, System>,
  pub token_program: Interface<'info, TokenInterface>,
  pub associated_token_program: Program<'info, AssociatedToken>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn claim_bribe_reward(
  ctx: Context<BribesReward>,
  _ve_token_id: u64,
) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Claims)?;
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;

  require!(
    !BribeToken::is_paused_for_claims(
      &ctx.accounts.bribe_token.to_account_info(),
      &ctx.accounts.token_mint.key(),
      ctx.program_id,
    )?,
    ErrorCode::BribeTokenPaused
  );

  let user_rewards = &mut ctx.accounts.user_rewards;
  
  // Check if already claimed
  if user_rewards.user != Pubkey::default() {
    return Err(ErrorCode::AlreadyClaimed.into());
  }

  let epoch = &ctx.accounts.epoch;

  require!(
    epoch.voting_rewards_claimable(ctx.accounts.protocol.current_epoch),
    ErrorCode::VotingRewardsNotClaimableYet
  );

  let user_vote = &ctx.accounts.user_vote;
  let gauge = &ctx.accounts.gauge;

  // Bribes can only be claimed once the epoch has ended and voting weights
  // are final — otherwise the first/early voter could claim against a
  // still-growing `total_gauge_vote` and drain the entire bribe before
  // later voters' shares are accounted for.
  require!(current_time >= epoch.end_time, ErrorCode::EpochNotFinalized);

  // Safe lookups with proper error handling
  let bribe_data = epoch.bribes
    .iter()
    .find(|bribe| bribe.gauge == gauge.key() && bribe.token_mint == ctx.accounts.token_mint.key())
    .ok_or(ErrorCode::InvalidGauge)?;

  let gauge_weight = epoch.gauge_weights
    .iter()
    .find(|gw| gw.gauge == gauge.key())
    .ok_or(ErrorCode::InvalidGauge)?;

  let user_gauge_vote = user_vote.votes
    .iter()
    .find(|vote| vote.gauge == gauge.key())
    .ok_or(ErrorCode::InvalidGaugeVotes)?;

  let rewards = bribe_data.amount;
  let total_gauge_vote = gauge_weight.weight;
  let total_user_vote = user_gauge_vote.weight;

  require!(rewards > 0, ErrorCode::InsufficientFunds);
  require!(total_gauge_vote > 0, ErrorCode::InvalidGaugeVotes);
  require!(total_user_vote > 0, ErrorCode::InvalidVotingPower);

  // Distribute this gauge's bribe purely by each voter's share of that
  // gauge's own vote total (see audit finding H-02).
  let claimable_fees = (rewards as u128)
    .checked_mul(total_user_vote as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)?
    .checked_div(total_gauge_vote as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)? as u64;
  require!(claimable_fees > 0, ErrorCode::InsufficientFunds);
  require!(
    ctx.accounts.bribe_vault_token_account.amount >= claimable_fees,
    ErrorCode::InsufficientFunds
  );

  // A lock enrolled in the public Auto-Vote program pays AUTO_VOTE_FEE_BPS
  // of its voting rewards to the protocol treasury -- checked from the
  // enrollment account's actual on-chain ownership, not a client-supplied
  // flag, since the caller must not be able to simply assert "not
  // enrolled" to dodge the fee.
  // Charged when an auto-voter cast this lock's vote, as recorded at vote time (review M-3); the enrollment
  // account is no longer consulted, so revoking before claiming does not skip the fee.
  // A partner voter (flagged by the Admin) charges no fee: its PartnerVoter PDA is the first remaining account.
  let partner_exempt = PartnerVoter::is_exempt(ctx.remaining_accounts, &ctx.accounts.vote_lock_record.user, ctx.program_id)?;
  let is_auto_voted = ctx.accounts.vote_lock_record.user != ctx.accounts.user_vote.user && !partner_exempt;
  let auto_vote_fee = if is_auto_voted {
    (claimable_fees as u128)
      .checked_mul(AUTO_VOTE_FEE_BPS as u128)
      .ok_or(ErrorCode::ArithmeticOverflow)?
      .checked_div(BPS_DENOMINATOR as u128)
      .ok_or(ErrorCode::ArithmeticOverflow)? as u64
  } else {
    0
  };
  let payout = claimable_fees
    .checked_sub(auto_vote_fee)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  if payout > 0 {
    transfer_token_from_vault(
      &ctx.accounts.vault,
      &ctx.accounts.token_mint,
      &ctx.accounts.bribe_vault_token_account,
      &ctx.accounts.user_token_account,
      &ctx.accounts.token_program,
      payout,
    )?;
  }
  if auto_vote_fee > 0 {
    transfer_token_from_vault(
      &ctx.accounts.vault,
      &ctx.accounts.token_mint,
      &ctx.accounts.bribe_vault_token_account,
      &ctx.accounts.treasury_token_account,
      &ctx.accounts.token_program,
      auto_vote_fee,
    )?;
  }

  user_rewards.user = ctx.accounts.user.key();
  user_rewards.gauge = gauge.key();
  user_rewards.epoch = epoch.epoch;
  user_rewards.amount = claimable_fees;
  user_rewards.last_claim_time = current_time;

  emit!(RewardClaimed {
    user: ctx.accounts.user.key(),
    gauge: gauge.key(),
    token_mint: ctx.accounts.token_mint.key(),
    epoch: epoch.epoch,
    amount: claimable_fees,
    claim_time: current_time,
  });
  
  Ok(())
}
