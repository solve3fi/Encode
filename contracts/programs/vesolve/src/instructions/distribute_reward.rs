use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{PROTOCOL_SEED, VAULT_SEED};
use crate::errors::ErrorCode;
use crate::events::VaultCreated;
use crate::states::{Gauge, Protocol, VaultData};
use crate::utils::transfer_token_to_vault;

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct DistributeReward<'info> {
  #[account(mut)]
  pub admin: Signer<'info>,

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
    constraint = token_mint.key() == protocol.token_mint @ ErrorCode::InvalidMint,
  )]
  pub token_mint: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    constraint = user_token_account.mint == token_mint.key() @ ErrorCode::InvalidMint,
    constraint = user_token_account.owner == admin.key() @ ErrorCode::InvalidOwner,
    constraint = user_token_account.amount >= amount @ ErrorCode::InsufficientFunds,
  )]
  pub user_token_account: InterfaceAccount<'info, TokenAccount>,

  #[account(
    mut,
    associated_token::mint = token_mint.key(),
    associated_token::authority = vault.key(),
    constraint = vault_token_account.mint == token_mint.key() @ ErrorCode::InvalidMint,
  )]
  pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

  pub system_program: Program<'info, System>,
  pub token_program: Interface<'info, TokenInterface>,
  pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn distribute_reward(
  ctx: Context<DistributeReward>,
  amount: u64,
) -> Result<()> {
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;
   
  let gauge = &ctx.accounts.gauge;
  let protocol = &mut ctx.accounts.protocol;
  let vault = &mut ctx.accounts.vault;

  transfer_token_to_vault(
    &ctx.accounts.admin,
    &ctx.accounts.token_mint,
    &ctx.accounts.user_token_account,
    &ctx.accounts.vault_token_account,
    &ctx.accounts.token_program,
    amount,
  )?;

  vault.admin = ctx.accounts.admin.key();
  vault.gauge = gauge.key();
  vault.epoch = protocol.current_epoch;
  vault.rewards = vault.rewards.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)?;
  vault.bump = ctx.bumps.vault;

  emit!(VaultCreated {
    admin: ctx.accounts.admin.key(),
    gauge: gauge.key(),
    token_mint: ctx.accounts.token_mint.key(),
    epoch: protocol.current_epoch,
    rewards: amount,
  });

  protocol.last_emission_time = current_time;

  Ok(())
}
