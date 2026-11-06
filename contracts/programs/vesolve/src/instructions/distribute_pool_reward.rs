use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{PROTOCOL_SEED, VAULT_SEED};
use crate::errors::ErrorCode;
use crate::events::VaultCreated;
use crate::states::{Gauge, Protocol, VaultData};
use crate::utils::transfer_token_to_vault;

#[derive(Accounts)]
#[instruction(token_a_amount: u64, token_b_amount: u64)]
pub struct DistributePoolReward<'info> {
  #[account(mut)]
  pub admin: Signer<'info>,

  // Admin is the transferable `protocol.admin` (see admin_config.rs).
  #[account(
    mut,
    seeds = [PROTOCOL_SEED],
    bump = protocol.bump,
    constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized,
  )]
  pub protocol: Box<Account<'info, Protocol>>,

  /// CHECK: This is not a signer, but it is required for PDA
  pub gauge: Box<Account<'info, Gauge>>,

  #[account(
    init_if_needed,
    payer = admin,
    space = 8 + VaultData::INIT_SPACE,
    seeds = [VAULT_SEED, protocol.current_epoch.to_le_bytes().as_ref(), gauge.key().as_ref()],
    bump
  )]
  pub vault: Box<Account<'info, VaultData>>,

  #[account(
    mut,
    constraint = token_mint_a.key() == gauge.token_mint_a @ ErrorCode::InvalidMint,
  )]
  pub token_mint_a: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    constraint = user_token_account_a.mint == token_mint_a.key() @ ErrorCode::InvalidMint,
    constraint = user_token_account_a.owner == admin.key() @ ErrorCode::InvalidOwner,
    constraint = user_token_account_a.amount >= token_a_amount @ ErrorCode::InsufficientFunds,
  )]
  pub user_token_account_a: InterfaceAccount<'info, TokenAccount>,

  #[account(
    mut,
    associated_token::mint = token_mint_a.key(),
    associated_token::authority = vault.key(),
    constraint = vault_token_account_a.mint == token_mint_a.key() @ ErrorCode::InvalidMint,
  )]
  pub vault_token_account_a: InterfaceAccount<'info, TokenAccount>,

  #[account(
    mut,
    constraint = token_mint_b.key() == gauge.token_mint_b @ ErrorCode::InvalidMint,
  )]
  pub token_mint_b: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    constraint = user_token_account_b.mint == token_mint_b.key() @ ErrorCode::InvalidMint,
    constraint = user_token_account_b.owner == admin.key() @ ErrorCode::InvalidOwner,
    constraint = user_token_account_b.amount >= token_b_amount @ ErrorCode::InsufficientFunds,
  )]
  pub user_token_account_b: InterfaceAccount<'info, TokenAccount>,

  #[account(
    mut,
    associated_token::mint = token_mint_b.key(),
    associated_token::authority = vault.key(),
    constraint = vault_token_account_b.mint == token_mint_b.key() @ ErrorCode::InvalidMint,
  )]
  pub vault_token_account_b: InterfaceAccount<'info, TokenAccount>,

  pub system_program: Program<'info, System>,
  pub token_program: Interface<'info, TokenInterface>,
  pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn distribute_pool_reward(
  ctx: Context<DistributePoolReward>,
  token_a_amount: u64,
  token_b_amount: u64,
) -> Result<()> {
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;
   
  let gauge = &ctx.accounts.gauge;
  let protocol = &mut ctx.accounts.protocol;
  let vault = &mut ctx.accounts.vault;

  transfer_token_to_vault(
    &ctx.accounts.admin,
    &ctx.accounts.token_mint_a,
    &ctx.accounts.user_token_account_a,
    &ctx.accounts.vault_token_account_a,
    &ctx.accounts.token_program,
    token_a_amount,
  )?;

  emit!(VaultCreated {
    admin: ctx.accounts.admin.key(),
    gauge: gauge.key(),
    token_mint: gauge.token_mint_a,
    epoch: protocol.current_epoch,
    rewards: token_a_amount,
  });


  transfer_token_to_vault(
    &ctx.accounts.admin,
    &ctx.accounts.token_mint_b,
    &ctx.accounts.user_token_account_b,
    &ctx.accounts.vault_token_account_b,
    &ctx.accounts.token_program,
    token_b_amount,
  )?;

  emit!(VaultCreated {
    admin: ctx.accounts.admin.key(),
    gauge: gauge.key(),
    token_mint: gauge.token_mint_b,
    epoch: protocol.current_epoch,
    rewards: token_b_amount,
  });

  vault.admin = ctx.accounts.admin.key();
  vault.gauge = gauge.key();
  vault.epoch = protocol.current_epoch;
  // Pool fees can be swept more than once during an epoch. Accumulate each
  // atomic sweep instead of replacing the previous snapshot, and keep this
  // separate from `vault.rewards` (emissions) so the two never collide.
  vault.pool_rewards_a = vault
    .pool_rewards_a
    .checked_add(token_a_amount)
    .ok_or(ErrorCode::ArithmeticOverflow)?;
  vault.pool_rewards_b = vault
    .pool_rewards_b
    .checked_add(token_b_amount)
    .ok_or(ErrorCode::ArithmeticOverflow)?;
  vault.bump = ctx.bumps.vault;

  protocol.last_emission_time = current_time;

  Ok(())
}
