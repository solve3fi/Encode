use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{AUTO_VOTE_SEED, BPS_DENOMINATOR, PROTOCOL_SEED, USER_POOL_REWARDS_SEED, VE_LOCK_SEED, VOTE_LOCK_SEED, USER_VOTE_SEED, AUTO_VOTE_FEE_BPS};
use crate::errors::ErrorCode;
use crate::events::RewardClaimed;
use crate::states::{Epoch, Gauge, ClaimedPoolRewards, Lock, PartnerVoter, Protocol, UserVote, VaultData, VoteLockRecord};
use crate::utils::transfer_token_from_vault;

#[derive(Accounts)]
#[instruction(ve_token_id: u64, sides: u8)]
pub struct PoolReward<'info> {
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

  /// See the identical comment in claim_bribe_reward.rs.
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

   #[account(
    mut,
    constraint = token_mint_a.key() == gauge.token_mint_a @ ErrorCode::InvalidMint,
  )]
  pub token_mint_a: Box<InterfaceAccount<'info, Mint>>,

  #[account(
    mut,
    constraint = user_token_account_a.mint == token_mint_a.key() @ ErrorCode::InvalidMint,
    constraint = user_token_account_a.owner == user.key() @ ErrorCode::InvalidOwner,
  )]
  pub user_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

  #[account(
    mut,
    associated_token::mint = token_mint_a.key(),
    associated_token::authority = vault.key(),
    constraint = vault_token_account_a.mint == token_mint_a.key() @ ErrorCode::InvalidMint,
  )]
  pub vault_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

  #[account(
    mut,
    constraint = token_mint_b.key() == gauge.token_mint_b @ ErrorCode::InvalidMint,
  )]
  pub token_mint_b: Box<InterfaceAccount<'info, Mint>>,

  #[account(
    mut,
    constraint = user_token_account_b.mint == token_mint_b.key() @ ErrorCode::InvalidMint,
    constraint = user_token_account_b.owner == user.key() @ ErrorCode::InvalidOwner,
  )]
  pub user_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

  #[account(
    mut,
    associated_token::mint = token_mint_b.key(),
    associated_token::authority = vault.key(),
    constraint = vault_token_account_b.mint == token_mint_b.key() @ ErrorCode::InvalidMint,
  )]
  pub vault_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

  /// Only ever written to when auto_vote_enrollment is populated -- created
  /// lazily since most claims are never for an enrolled lock.
  #[account(
    init_if_needed,
    payer = user,
    associated_token::mint = token_mint_a,
    associated_token::authority = protocol,
  )]
  pub treasury_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

  #[account(
    init_if_needed,
    payer = user,
    associated_token::mint = token_mint_b,
    associated_token::authority = protocol,
  )]
  pub treasury_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

  #[account(
    init_if_needed,
    payer = user,
    space = 8 + ClaimedPoolRewards::INIT_SPACE,
    seeds = [USER_POOL_REWARDS_SEED, lock.key().as_ref(), epoch.key().as_ref(), gauge.key().as_ref()],
    bump
  )]
  pub user_rewards: Box<Account<'info, ClaimedPoolRewards>>,

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

/// Which side(s) of the pool's fees to claim: 1 = token A, 2 = token B, 3 = both.
pub const CLAIM_SIDE_A: u8 = 1;
pub const CLAIM_SIDE_B: u8 = 2;

pub fn claim_pool_reward(
  ctx: Context<PoolReward>,
  _ve_token_id: u64,
  sides: u8,
) -> Result<()> {
  require!(sides >= 1 && sides <= 3, ErrorCode::InvalidAmount);
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Claims)?;
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;

  let user_rewards = &mut ctx.accounts.user_rewards;
  
  // Each side can be claimed once; a side already claimed is skipped.
  let want_a = sides & CLAIM_SIDE_A != 0 && !user_rewards.claimed_a;
  let want_b = sides & CLAIM_SIDE_B != 0 && !user_rewards.claimed_b;
  if !want_a && !want_b {
    return Err(ErrorCode::AlreadyClaimed.into());
  }

  let epoch = &ctx.accounts.epoch;

  require!(
    epoch.voting_rewards_claimable(ctx.accounts.protocol.current_epoch),
    ErrorCode::VotingRewardsNotClaimableYet
  );

  let user_vote = &ctx.accounts.user_vote;
  let gauge = &ctx.accounts.gauge;
  let vault = &ctx.accounts.vault;

  // Pool-reward claims must wait until the epoch's votes are finalized,
  // otherwise an early claimer could drain the vault before other voters'
  // shares are locked in.
  require!(current_time >= epoch.end_time, ErrorCode::EpochNotFinalized);

  // Size payouts from the fixed snapshot taken at distribute time, not the
  // live (depleting) vault balance, so claims aren't order-dependent
  // (see audit finding M-02).
  let rewards_a = vault.pool_rewards_a;
  let rewards_b = vault.pool_rewards_b;

  // Safe lookups with proper error handling
  let gauge_weight = epoch.gauge_weights
    .iter()
    .find(|gw| gw.gauge == gauge.key())
    .ok_or(ErrorCode::InvalidGauge)?;

  let user_gauge_vote = user_vote.votes
    .iter()
    .find(|vote| vote.gauge == gauge.key())
    .ok_or(ErrorCode::InvalidGaugeVotes)?;

  let total_gauge_vote = gauge_weight.weight;
  let total_user_vote = user_gauge_vote.weight;

  require!(total_gauge_vote > 0, ErrorCode::InvalidGaugeVotes);
  require!(total_user_vote > 0, ErrorCode::InvalidVotingPower);

  // Distribute this gauge's vault purely by each voter's share of that
  // gauge's own vote total (see audit finding H-02).
  //
  // Single-sided trading activity (all swaps in one direction, or the
  // other side's fee share rounding to zero for a small voter) is normal,
  // not an error -- a gauge sitting at rewards_a == 0 must not block every
  // voter from claiming their real, nonzero rewards_b share (and vice
  // versa). Only require that this claim carries at least one nonzero
  // side; transfer and emit per side independently.
  let claimable_fees_a = (rewards_a as u128)
    .checked_mul(total_user_vote as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)?
    .checked_div(total_gauge_vote as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)? as u64;

  let claimable_fees_b = (rewards_b as u128)
    .checked_mul(total_user_vote as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)?
    .checked_div(total_gauge_vote as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)? as u64;
  require!(
    (want_a && claimable_fees_a > 0) || (want_b && claimable_fees_b > 0),
    ErrorCode::InsufficientFunds
  );

  // A lock enrolled in the public Auto-Vote program pays AUTO_VOTE_FEE_BPS
  // of its voting rewards to the protocol treasury -- checked from the
  // enrollment account's actual on-chain ownership, not a client-supplied
  // flag, since the caller must not be able to simply assert "not
  // enrolled" to dodge the fee. See the identical comment in
  // claim_bribe_reward.rs.
  // Charged when an auto-voter cast this lock's vote, as recorded at vote time (review M-3); the enrollment
  // account is no longer consulted, so revoking before claiming does not skip the fee.
  // A partner voter (flagged by the Admin) charges no fee: its PartnerVoter PDA is the first remaining account.
  let partner_exempt = PartnerVoter::is_exempt(ctx.remaining_accounts, &ctx.accounts.vote_lock_record.user, ctx.program_id)?;
  let is_auto_voted = ctx.accounts.vote_lock_record.user != ctx.accounts.user_vote.user && !partner_exempt;
  let split = |claimable: u64| -> Result<(u64, u64)> {
    if !is_auto_voted || claimable == 0 {
      return Ok((claimable, 0));
    }
    let fee = (claimable as u128)
      .checked_mul(AUTO_VOTE_FEE_BPS as u128)
      .ok_or(ErrorCode::ArithmeticOverflow)?
      .checked_div(BPS_DENOMINATOR as u128)
      .ok_or(ErrorCode::ArithmeticOverflow)? as u64;
    let payout = claimable.checked_sub(fee).ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((payout, fee))
  };

  if want_a && claimable_fees_a > 0 {
    require!(
      ctx.accounts.vault_token_account_a.amount >= claimable_fees_a,
      ErrorCode::InsufficientFunds
    );
    let (payout_a, fee_a) = split(claimable_fees_a)?;
    if payout_a > 0 {
      transfer_token_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.token_mint_a,
        &ctx.accounts.vault_token_account_a,
        &ctx.accounts.user_token_account_a,
        &ctx.accounts.token_program,
        payout_a,
      )?;
    }
    if fee_a > 0 {
      transfer_token_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.token_mint_a,
        &ctx.accounts.vault_token_account_a,
        &ctx.accounts.treasury_token_account_a,
        &ctx.accounts.token_program,
        fee_a,
      )?;
    }

    emit!(RewardClaimed {
      user: ctx.accounts.user.key(),
      gauge: gauge.key(),
      token_mint: ctx.accounts.token_mint_a.key(),
      epoch: epoch.epoch,
      amount: claimable_fees_a,
      claim_time: current_time,
    });
  }

  if want_b && claimable_fees_b > 0 {
    require!(
      ctx.accounts.vault_token_account_b.amount >= claimable_fees_b,
      ErrorCode::InsufficientFunds
    );
    let (payout_b, fee_b) = split(claimable_fees_b)?;
    if payout_b > 0 {
      transfer_token_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.token_mint_b,
        &ctx.accounts.vault_token_account_b,
        &ctx.accounts.user_token_account_b,
        &ctx.accounts.token_program,
        payout_b,
      )?;
    }
    if fee_b > 0 {
      transfer_token_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.token_mint_b,
        &ctx.accounts.vault_token_account_b,
        &ctx.accounts.treasury_token_account_b,
        &ctx.accounts.token_program,
        fee_b,
      )?;
    }

    emit!(RewardClaimed {
      user: ctx.accounts.user.key(),
      gauge: gauge.key(),
      token_mint: ctx.accounts.token_mint_b.key(),
      epoch: epoch.epoch,
      amount: claimable_fees_b,
      claim_time: current_time,
    });
  }

  user_rewards.user = ctx.accounts.user.key();
  user_rewards.gauge = gauge.key();
  user_rewards.epoch = epoch.epoch;
  if want_a {
    user_rewards.amount_a = claimable_fees_a;
    user_rewards.claimed_a = true;
  }
  if want_b {
    user_rewards.amount_b = claimable_fees_b;
    user_rewards.claimed_b = true;
  }
  user_rewards.last_claim_time = current_time;

  
  Ok(())
}
