use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{PROTOCOL_SEED, USER_REWARDS_SEED, USER_VOTE_SEED, VE_LOCK_SEED};
use crate::errors::ErrorCode;
use crate::events::RewardClaimed;
use crate::states::{Epoch, Gauge, ClaimedRewards, Lock, Protocol, UserVote, VaultData};
use crate::utils::transfer_token_from_vault;

#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct Reward<'info> {
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
    constraint = token_mint.key() == protocol.token_mint @ ErrorCode::InvalidMint,
  )]
  pub token_mint: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    associated_token::mint = token_mint.key(),
    associated_token::authority = user,
  )]
  pub user_token_account: InterfaceAccount<'info, TokenAccount>,

  #[account(
    mut,
    associated_token::mint = token_mint.key(),
    associated_token::authority = vault.key(),
    constraint = vault_token_account.mint == token_mint.key() @ ErrorCode::InvalidMint,
  )]
  pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

  #[account(
    init_if_needed,
    payer = user,
    space = 8 + ClaimedRewards::INIT_SPACE,
    seeds = [USER_REWARDS_SEED, lock.key().as_ref(), epoch.key().as_ref(), gauge.key().as_ref()],
    bump
  )]
  pub user_rewards: Box<Account<'info, ClaimedRewards>>,

  #[account(
    mut,
    seeds = [USER_VOTE_SEED, lock.key().as_ref(), epoch.epoch.to_le_bytes().as_ref()],
    bump = user_vote.bump,
    constraint = user_vote.epoch == epoch.epoch @ ErrorCode::Unauthorized,
  )]
  pub user_vote: Box<Account<'info, UserVote>>,

  pub system_program: Program<'info, System>,
  pub token_program: Interface<'info, TokenInterface>,
  pub associated_token_program: Program<'info, AssociatedToken>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn claim_reward(
  ctx: Context<Reward>,
  _ve_token_id: u64,
) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Claims)?;
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;

  let user_rewards = &mut ctx.accounts.user_rewards;
  
  // Check if already claimed (account exists and has data)
  if user_rewards.user != Pubkey::default() {
    return Err(ErrorCode::AlreadyClaimed.into());
  }

  let epoch = &ctx.accounts.epoch;
  let user_vote = &ctx.accounts.user_vote;
  let gauge = &ctx.accounts.gauge;
  let vault = &ctx.accounts.vault;

  // Voting rewards for epoch N aren't claimable until epoch N+1 begins, i.e. the earning epoch has ended and its
  // reward pot (bribes and routed fees are tied to the current epoch) can no longer change. The hold used to be
  // N+2; it was shortened to N+1 on 2026-10-13.
  require!(
    epoch.voting_rewards_claimable(ctx.accounts.protocol.current_epoch),
    ErrorCode::VotingRewardsNotClaimableYet
  );

  let vault_amount = ctx.accounts.vault_token_account.amount;
  let rewards = vault.rewards;

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

  require!(rewards > 0, ErrorCode::InsufficientFunds);
  require!(total_gauge_vote > 0, ErrorCode::InvalidGaugeVotes);
  require!(total_user_vote > 0, ErrorCode::InvalidVotingPower);

  // Distribute this gauge's vault purely by each voter's share of that
  // gauge's own vote total. (Previously also divided by the *global*
  // total_voting_power via pool_vote_share, which meant only a gauge's
  // fraction of the whole protocol's vault was ever claimable, stranding
  // the rest permanently. See audit finding H-02.)
  let claimable_fees = (rewards as u128)
    .checked_mul(total_user_vote as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)?
    .checked_div(total_gauge_vote as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)? as u64;
  require!(claimable_fees > 0, ErrorCode::InsufficientFunds);
  require!(vault_amount >= claimable_fees, ErrorCode::InsufficientFunds);

  user_rewards.user = ctx.accounts.user.key();
  user_rewards.gauge = gauge.key();
  user_rewards.epoch = epoch.epoch;
  user_rewards.amount = claimable_fees;
  user_rewards.last_claim_time = current_time;

  transfer_token_from_vault(
    &ctx.accounts.vault,
    &ctx.accounts.token_mint,
    &ctx.accounts.vault_token_account,
    &ctx.accounts.user_token_account,
    &ctx.accounts.token_program,
    claimable_fees,
  )?;

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
