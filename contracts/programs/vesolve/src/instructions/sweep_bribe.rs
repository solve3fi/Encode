use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{EPOCH_DATA_SEED, PROTOCOL_SEED};
use crate::errors::ErrorCode;
use crate::events::{BribeSwept, PoolFeesSwept};
use crate::states::{AdminConfig, Epoch, Gauge, Protocol, VaultData};
use crate::utils::transfer_token_from_vault;

/// Sends a gauge's bribe of one token to the Treasury when nobody voted for the
/// gauge in that epoch (Full Launch A12). Permissionless once the epoch has
/// ended and votes are final. Only the recorded bribe amount moves, and the
/// record is zeroed so it cannot be swept twice.
#[derive(Accounts)]
pub struct SweepUnvotedBribe<'info> {
  #[account(mut)]
  pub caller: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  pub gauge: Box<Account<'info, Gauge>>,

  #[account(mut, seeds = [EPOCH_DATA_SEED, epoch.epoch.to_le_bytes().as_ref()], bump = epoch.bump)]
  pub epoch: Box<Account<'info, Epoch>>,

  #[account(
    constraint = vault.gauge == gauge.key() && vault.epoch == epoch.epoch @ ErrorCode::InvalidGauge,
  )]
  pub vault: Box<Account<'info, VaultData>>,

  pub token_mint: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    associated_token::mint = token_mint,
    associated_token::authority = vault,
  )]
  pub bribe_vault_token_account: InterfaceAccount<'info, TokenAccount>,

  /// CHECK: must equal the Treasury configured in AdminConfig (checked in the handler).
  pub treasury: UncheckedAccount<'info>,

  #[account(
    init_if_needed,
    payer = caller,
    associated_token::mint = token_mint,
    associated_token::authority = treasury,
  )]
  pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,

  /// CHECK: canonical AdminConfig PDA, read in the handler.
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,

  pub system_program: Program<'info, System>,
  pub token_program: Interface<'info, TokenInterface>,
  pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn sweep_unvoted_bribe(ctx: Context<SweepUnvotedBribe>) -> Result<()> {
  let config = AdminConfig::read(&ctx.accounts.admin_config.to_account_info(), ctx.program_id)?;
  let treasury = config.map(|c| c.treasury).unwrap_or_default();
  require!(treasury != Pubkey::default(), ErrorCode::TreasuryNotSet);
  require_keys_eq!(ctx.accounts.treasury.key(), treasury, ErrorCode::InvalidOwner);

  let now = Clock::get()?.unix_timestamp;
  require!(now >= ctx.accounts.epoch.end_time, ErrorCode::EpochNotFinalized);

  let gauge_key = ctx.accounts.gauge.key();
  let mint_key = ctx.accounts.token_mint.key();
  let voted = ctx.accounts.epoch.gauge_weights.iter().any(|gw| gw.gauge == gauge_key && gw.weight > 0);
  require!(!voted, ErrorCode::GaugeHasVotes);

  let entry = ctx.accounts.epoch.bribes.iter_mut()
    .find(|b| b.gauge == gauge_key && b.token_mint == mint_key)
    .ok_or(ErrorCode::InvalidGauge)?;
  let amount = entry.amount;
  require!(amount > 0, ErrorCode::InsufficientFunds);
  require!(ctx.accounts.bribe_vault_token_account.amount >= amount, ErrorCode::InsufficientFunds);
  entry.amount = 0;

  transfer_token_from_vault(
    &ctx.accounts.vault,
    &ctx.accounts.token_mint,
    &ctx.accounts.bribe_vault_token_account,
    &ctx.accounts.treasury_token_account,
    &ctx.accounts.token_program,
    amount,
  )?;

  emit!(BribeSwept { gauge: gauge_key, token_mint: mint_key, epoch: ctx.accounts.epoch.epoch, amount, treasury });
  Ok(())
}

/// Sends a gauge's routed trading fees for an epoch to the Treasury when nobody voted for the gauge in that
/// epoch (DEV-10: such fees can never be claimed; spec 5.2 sends zero-vote fees to the Treasury). Permissionless
/// once the epoch has ended. Only the recorded pool-fee amounts move (never emissions or bribes held in the same
/// vault accounts), and the records are zeroed so they cannot be swept twice.
#[derive(Accounts)]
pub struct SweepUnvotedPoolFees<'info> {
  #[account(mut)]
  pub caller: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  pub gauge: Box<Account<'info, Gauge>>,

  #[account(seeds = [EPOCH_DATA_SEED, epoch.epoch.to_le_bytes().as_ref()], bump = epoch.bump)]
  pub epoch: Box<Account<'info, Epoch>>,

  #[account(
    mut,
    constraint = vault.gauge == gauge.key() && vault.epoch == epoch.epoch @ ErrorCode::InvalidGauge,
  )]
  pub vault: Box<Account<'info, VaultData>>,

  #[account(address = gauge.token_mint_a @ ErrorCode::InvalidMint)]
  pub token_mint_a: Box<InterfaceAccount<'info, Mint>>,

  #[account(address = gauge.token_mint_b @ ErrorCode::InvalidMint)]
  pub token_mint_b: Box<InterfaceAccount<'info, Mint>>,

  #[account(mut, associated_token::mint = token_mint_a, associated_token::authority = vault, associated_token::token_program = token_program)]
  pub vault_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

  #[account(mut, associated_token::mint = token_mint_b, associated_token::authority = vault, associated_token::token_program = token_program)]
  pub vault_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

  /// CHECK: must equal the Treasury configured in AdminConfig (checked in the handler).
  pub treasury: UncheckedAccount<'info>,

  #[account(init_if_needed, payer = caller, associated_token::mint = token_mint_a, associated_token::authority = treasury, associated_token::token_program = token_program)]
  pub treasury_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

  #[account(init_if_needed, payer = caller, associated_token::mint = token_mint_b, associated_token::authority = treasury, associated_token::token_program = token_program)]
  pub treasury_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

  /// CHECK: canonical AdminConfig PDA, read in the handler.
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,

  pub system_program: Program<'info, System>,
  pub token_program: Interface<'info, TokenInterface>,
  pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn sweep_unvoted_pool_fees(ctx: Context<SweepUnvotedPoolFees>) -> Result<()> {
  let config = AdminConfig::read(&ctx.accounts.admin_config.to_account_info(), ctx.program_id)?;
  let treasury = config.map(|c| c.treasury).unwrap_or_default();
  require!(treasury != Pubkey::default(), ErrorCode::TreasuryNotSet);
  require_keys_eq!(ctx.accounts.treasury.key(), treasury, ErrorCode::InvalidOwner);

  let now = Clock::get()?.unix_timestamp;
  require!(now >= ctx.accounts.epoch.end_time, ErrorCode::EpochNotFinalized);
  let gauge_key = ctx.accounts.gauge.key();
  require!(!crate::instructions::route_pool_fees::gauge_has_votes(&ctx.accounts.epoch, &gauge_key), ErrorCode::GaugeHasVotes);

  let amount_a = ctx.accounts.vault.pool_rewards_a;
  let amount_b = ctx.accounts.vault.pool_rewards_b;
  require!(amount_a > 0 || amount_b > 0, ErrorCode::InsufficientFunds);
  require!(ctx.accounts.vault_token_account_a.amount >= amount_a, ErrorCode::InsufficientFunds);
  require!(ctx.accounts.vault_token_account_b.amount >= amount_b, ErrorCode::InsufficientFunds);
  ctx.accounts.vault.pool_rewards_a = 0;
  ctx.accounts.vault.pool_rewards_b = 0;

  for (mint, from, to, amount) in [
    (&ctx.accounts.token_mint_a, &ctx.accounts.vault_token_account_a, &ctx.accounts.treasury_token_account_a, amount_a),
    (&ctx.accounts.token_mint_b, &ctx.accounts.vault_token_account_b, &ctx.accounts.treasury_token_account_b, amount_b),
  ] {
    if amount > 0 {
      transfer_token_from_vault(&ctx.accounts.vault, mint, from, to, &ctx.accounts.token_program, amount)?;
    }
  }

  emit!(PoolFeesSwept {
    gauge: gauge_key,
    epoch: ctx.accounts.epoch.epoch,
    token_mint_a: ctx.accounts.token_mint_a.key(),
    amount_a,
    token_mint_b: ctx.accounts.token_mint_b.key(),
    amount_b,
    treasury,
  });
  Ok(())
}
