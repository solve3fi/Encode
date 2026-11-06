use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use solve::state::{Solve, SolvesConfig};

use crate::constants::{PROTOCOL_SEED, UNGAUGED_PROTOCOL_FEE_RATE};
use crate::errors::ErrorCode;
use crate::events::UngaugedFeesSwept;
use crate::states::{AdminConfig, Protocol};

/// Sends the protocol's share of an ungauged pool's trading fees (5% under the
/// frozen 95/5 routing) to the Treasury (Full Launch A2). Permissionless (review
/// H-2): the protocol PDA is the DEX's collect-fees authority and the fees can
/// only go to the configured Treasury. Only pools on the
/// ungauged rate can be swept this way, so a gauged pool's fees can never be
/// diverted to the Treasury, and `configure_native_gauge` refuses to flip a
/// pool while fees are uncollected, so fees are always settled under the
/// routing they accrued under.
#[derive(Accounts)]
pub struct SweepUngaugedPoolFees<'info> {
  #[account(mut)]
  pub caller: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(constraint = solves_config.collect_protocol_fees_authority == protocol.key() @ ErrorCode::Unauthorized)]
  pub solves_config: Box<Account<'info, SolvesConfig>>,

  #[account(mut, has_one = solves_config,
    constraint = pool.protocol_fee_rate == UNGAUGED_PROTOCOL_FEE_RATE @ ErrorCode::PoolNotUngauged)]
  pub pool: Box<Account<'info, Solve>>,

  #[account(address = pool.token_mint_a)]
  pub token_mint_a: Account<'info, Mint>,
  #[account(address = pool.token_mint_b)]
  pub token_mint_b: Account<'info, Mint>,

  #[account(mut, address = pool.token_vault_a)]
  pub token_vault_a: Box<Account<'info, TokenAccount>>,
  #[account(mut, address = pool.token_vault_b)]
  pub token_vault_b: Box<Account<'info, TokenAccount>>,

  /// CHECK: must equal the Treasury configured in AdminConfig (checked in the handler).
  pub treasury: UncheckedAccount<'info>,

  #[account(init_if_needed, payer = caller, associated_token::mint = token_mint_a, associated_token::authority = treasury)]
  pub treasury_token_account_a: Box<Account<'info, TokenAccount>>,
  #[account(init_if_needed, payer = caller, associated_token::mint = token_mint_b, associated_token::authority = treasury)]
  pub treasury_token_account_b: Box<Account<'info, TokenAccount>>,

  /// CHECK: canonical AdminConfig PDA, read in the handler.
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,

  pub solve_program: Program<'info, solve::program::Solve>,
  pub token_program: Program<'info, Token>,
  pub associated_token_program: Program<'info, AssociatedToken>,
  pub system_program: Program<'info, System>,
}

pub fn sweep_ungauged_pool_fees(ctx: Context<SweepUngaugedPoolFees>) -> Result<()> {
  let config = AdminConfig::read(&ctx.accounts.admin_config.to_account_info(), ctx.program_id)?;
  let treasury = config.map(|c| c.treasury).unwrap_or_default();
  require!(treasury != Pubkey::default(), ErrorCode::TreasuryNotSet);
  require_keys_eq!(ctx.accounts.treasury.key(), treasury, ErrorCode::InvalidOwner);

  let amount_a = ctx.accounts.pool.protocol_fee_owed_a;
  let amount_b = ctx.accounts.pool.protocol_fee_owed_b;
  let before_a = ctx.accounts.treasury_token_account_a.amount;
  let before_b = ctx.accounts.treasury_token_account_b.amount;

  let protocol_signer: &[&[u8]] = &[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]];
  solve::cpi::collect_protocol_fees(CpiContext::new_with_signer(
    ctx.accounts.solve_program.to_account_info(),
    solve::cpi::accounts::CollectProtocolFees {
      solves_config: ctx.accounts.solves_config.to_account_info(),
      solve: ctx.accounts.pool.to_account_info(),
      collect_protocol_fees_authority: ctx.accounts.protocol.to_account_info(),
      token_vault_a: ctx.accounts.token_vault_a.to_account_info(),
      token_vault_b: ctx.accounts.token_vault_b.to_account_info(),
      token_destination_a: ctx.accounts.treasury_token_account_a.to_account_info(),
      token_destination_b: ctx.accounts.treasury_token_account_b.to_account_info(),
      token_program: ctx.accounts.token_program.to_account_info(),
    },
    &[protocol_signer],
  ))?;

  ctx.accounts.pool.reload()?;
  ctx.accounts.treasury_token_account_a.reload()?;
  ctx.accounts.treasury_token_account_b.reload()?;
  require!(ctx.accounts.pool.protocol_fee_owed_a == 0 && ctx.accounts.pool.protocol_fee_owed_b == 0, ErrorCode::InvalidAmount);
  require!(ctx.accounts.treasury_token_account_a.amount == before_a.checked_add(amount_a).ok_or(ErrorCode::ArithmeticOverflow)?
    && ctx.accounts.treasury_token_account_b.amount == before_b.checked_add(amount_b).ok_or(ErrorCode::ArithmeticOverflow)?,
    ErrorCode::InvalidAmount);

  emit!(UngaugedFeesSwept { pool: ctx.accounts.pool.key(), amount_a, amount_b, treasury });
  Ok(())
}

/// Settles a gauge's last trading fees to the Treasury when its removal is due and nobody voted for it in the
/// current epoch (DEV-17), so `configure_native_gauge(false)` can run. Before the review this needed the Admin
/// to collect from the DEX directly; with the Protocol PDA as the collector it is permissionless (review H-2),
/// and the fees can only reach the configured Treasury.
#[derive(Accounts)]
pub struct SettleRemovedGaugeFees<'info> {
  #[account(mut)]
  pub caller: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    seeds = [crate::constants::GAUGE_SEED, protocol.key().as_ref(), pool.key().as_ref()],
    bump = gauge.bump,
    constraint = gauge.status == crate::states::GAUGE_PENDING_REMOVAL @ ErrorCode::GaugeStateInvalid,
    constraint = protocol.current_epoch >= gauge.effective_epoch @ ErrorCode::GaugeTransitionNotDue,
  )]
  pub gauge: Box<Account<'info, crate::states::Gauge>>,

  #[account(seeds = [crate::constants::EPOCH_DATA_SEED, protocol.current_epoch.to_le_bytes().as_ref()], bump = epoch.bump)]
  pub epoch: Box<Account<'info, crate::states::Epoch>>,

  #[account(constraint = solves_config.collect_protocol_fees_authority == protocol.key() @ ErrorCode::Unauthorized)]
  pub solves_config: Box<Account<'info, SolvesConfig>>,

  #[account(mut, has_one = solves_config,
    constraint = pool.protocol_fee_rate == crate::constants::GAUGED_PROTOCOL_FEE_RATE @ ErrorCode::NativeGaugeRequired)]
  pub pool: Box<Account<'info, Solve>>,

  #[account(address = pool.token_mint_a)]
  pub token_mint_a: Account<'info, Mint>,
  #[account(address = pool.token_mint_b)]
  pub token_mint_b: Account<'info, Mint>,

  #[account(mut, address = pool.token_vault_a)]
  pub token_vault_a: Box<Account<'info, TokenAccount>>,
  #[account(mut, address = pool.token_vault_b)]
  pub token_vault_b: Box<Account<'info, TokenAccount>>,

  /// CHECK: must equal the Treasury configured in AdminConfig (checked in the handler).
  pub treasury: UncheckedAccount<'info>,

  #[account(init_if_needed, payer = caller, associated_token::mint = token_mint_a, associated_token::authority = treasury)]
  pub treasury_token_account_a: Box<Account<'info, TokenAccount>>,
  #[account(init_if_needed, payer = caller, associated_token::mint = token_mint_b, associated_token::authority = treasury)]
  pub treasury_token_account_b: Box<Account<'info, TokenAccount>>,

  /// CHECK: canonical AdminConfig PDA, read in the handler.
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,

  pub solve_program: Program<'info, solve::program::Solve>,
  pub token_program: Program<'info, Token>,
  pub associated_token_program: Program<'info, AssociatedToken>,
  pub system_program: Program<'info, System>,
}

pub fn settle_removed_gauge_fees(ctx: Context<SettleRemovedGaugeFees>) -> Result<()> {
  let config = AdminConfig::read(&ctx.accounts.admin_config.to_account_info(), ctx.program_id)?;
  let treasury = config.map(|c| c.treasury).unwrap_or_default();
  require!(treasury != Pubkey::default(), ErrorCode::TreasuryNotSet);
  require_keys_eq!(ctx.accounts.treasury.key(), treasury, ErrorCode::InvalidOwner);
  // With votes this epoch the fees belong to its voters: route_pool_fees, not the Treasury.
  require!(
    !crate::instructions::route_pool_fees::gauge_has_votes(&ctx.accounts.epoch, &ctx.accounts.gauge.key()),
    ErrorCode::GaugeHasVotes
  );

  let amount_a = ctx.accounts.pool.protocol_fee_owed_a;
  let amount_b = ctx.accounts.pool.protocol_fee_owed_b;
  require!(amount_a > 0 || amount_b > 0, ErrorCode::InsufficientFunds);
  let before_a = ctx.accounts.treasury_token_account_a.amount;
  let before_b = ctx.accounts.treasury_token_account_b.amount;

  let protocol_signer: &[&[u8]] = &[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]];
  solve::cpi::collect_protocol_fees(CpiContext::new_with_signer(
    ctx.accounts.solve_program.to_account_info(),
    solve::cpi::accounts::CollectProtocolFees {
      solves_config: ctx.accounts.solves_config.to_account_info(),
      solve: ctx.accounts.pool.to_account_info(),
      collect_protocol_fees_authority: ctx.accounts.protocol.to_account_info(),
      token_vault_a: ctx.accounts.token_vault_a.to_account_info(),
      token_vault_b: ctx.accounts.token_vault_b.to_account_info(),
      token_destination_a: ctx.accounts.treasury_token_account_a.to_account_info(),
      token_destination_b: ctx.accounts.treasury_token_account_b.to_account_info(),
      token_program: ctx.accounts.token_program.to_account_info(),
    },
    &[protocol_signer],
  ))?;

  ctx.accounts.pool.reload()?;
  ctx.accounts.treasury_token_account_a.reload()?;
  ctx.accounts.treasury_token_account_b.reload()?;
  require!(ctx.accounts.pool.protocol_fee_owed_a == 0 && ctx.accounts.pool.protocol_fee_owed_b == 0, ErrorCode::InvalidAmount);
  require!(ctx.accounts.treasury_token_account_a.amount == before_a.checked_add(amount_a).ok_or(ErrorCode::ArithmeticOverflow)?
    && ctx.accounts.treasury_token_account_b.amount == before_b.checked_add(amount_b).ok_or(ErrorCode::ArithmeticOverflow)?,
    ErrorCode::InvalidAmount);

  emit!(UngaugedFeesSwept { pool: ctx.accounts.pool.key(), amount_a, amount_b, treasury });
  Ok(())
}
