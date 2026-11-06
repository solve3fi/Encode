//! The vesolve Protocol PDA holds the DEX's fee authority and protocol-fee collection authority (review H-2),
//! so no wallet can collect voters' trading fees or flip pool fee splits on its own. Pool protocol-fee rates
//! follow one fixed rule that anyone can apply (`sync_pool_fee_rate`); the remaining DEX settings are changed
//! by the Admin through the pass-through instructions below, signed by the Protocol PDA.
use anchor_lang::prelude::*;
use solve::state::{Solve, SolvesConfig};

use crate::constants::{GAUGE_SEED, GAUGED_PROTOCOL_FEE_RATE, PROTOCOL_SEED, UNGAUGED_PROTOCOL_FEE_RATE};
use crate::errors::ErrorCode;
use crate::events::PoolFeeRateSynced;
use crate::states::{Gauge, Protocol};

/// The protocol fee rate a pool must have: every fee to voters while its gauge is active, 5% to the Treasury
/// (95% to LPs) otherwise.
pub(crate) fn target_protocol_fee_rate(gauge_active: bool) -> u16 {
  if gauge_active { GAUGED_PROTOCOL_FEE_RATE } else { UNGAUGED_PROTOCOL_FEE_RATE }
}

#[derive(Accounts)]
pub struct SyncPoolFeeRate<'info> {
  pub caller: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(constraint = solves_config.fee_authority == protocol.key() @ ErrorCode::Unauthorized)]
  pub solves_config: Box<Account<'info, SolvesConfig>>,

  #[account(mut, has_one = solves_config)]
  pub pool: Box<Account<'info, Solve>>,

  /// CHECK: the pool's gauge PDA; it may not exist (a pool that never had a gauge).
  #[account(seeds = [GAUGE_SEED, protocol.key().as_ref(), pool.key().as_ref()], bump)]
  pub gauge: UncheckedAccount<'info>,

  pub solve_program: Program<'info, solve::program::Solve>,
}

/// Sets a pool's protocol fee rate to the rule above (replaces the keeper's off-chain fee policy). Permissionless.
/// Refused while protocol fees are still owed, so fees are always settled under the split they accrued under.
pub fn sync_pool_fee_rate(ctx: Context<SyncPoolFeeRate>) -> Result<()> {
  let info = ctx.accounts.gauge.to_account_info();
  let gauge_active = info.owner == ctx.program_id
    && !info.data_is_empty()
    && Gauge::try_deserialize(&mut &info.try_borrow_data()?[..])?.is_active;
  let target = target_protocol_fee_rate(gauge_active);
  require!(ctx.accounts.pool.protocol_fee_rate != target, ErrorCode::FeeRateAlreadySynced);
  require!(
    ctx.accounts.pool.protocol_fee_owed_a == 0 && ctx.accounts.pool.protocol_fee_owed_b == 0,
    ErrorCode::GaugeFeesMustBeSwept
  );
  let signer: &[&[u8]] = &[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]];
  solve::cpi::set_protocol_fee_rate(
    CpiContext::new_with_signer(
      ctx.accounts.solve_program.to_account_info(),
      solve::cpi::accounts::SetProtocolFeeRate {
        solves_config: ctx.accounts.solves_config.to_account_info(),
        solve: ctx.accounts.pool.to_account_info(),
        fee_authority: ctx.accounts.protocol.to_account_info(),
      },
      &[signer],
    ),
    target,
  )?;
  emit!(PoolFeeRateSynced { pool: ctx.accounts.pool.key(), protocol_fee_rate: target });
  Ok(())
}

/// Accounts shared by the Admin pass-throughs. `target` is the DEX account being changed (fee tier or pool),
/// or the config again when the change is config-wide; the DEX validates it.
#[derive(Accounts)]
pub struct DexAdmin<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  /// CHECK: the DEX config; the DEX checks its fee authority is the Protocol PDA.
  #[account(mut)]
  pub solves_config: UncheckedAccount<'info>,

  /// CHECK: validated by the DEX instruction it is passed to.
  #[account(mut)]
  pub target: UncheckedAccount<'info>,

  pub solve_program: Program<'info, solve::program::Solve>,
  pub system_program: Program<'info, System>,
}

fn signer_seeds(ctx: &Context<DexAdmin>) -> [u8; 1] {
  [ctx.accounts.protocol.bump]
}

pub fn dex_initialize_fee_tier(ctx: Context<DexAdmin>, tick_spacing: u16, default_fee_rate: u16) -> Result<()> {
  let bump = signer_seeds(&ctx);
  let signer: &[&[u8]] = &[PROTOCOL_SEED, &bump];
  solve::cpi::initialize_fee_tier(
    CpiContext::new_with_signer(
      ctx.accounts.solve_program.to_account_info(),
      solve::cpi::accounts::InitializeFeeTier {
        config: ctx.accounts.solves_config.to_account_info(),
        fee_tier: ctx.accounts.target.to_account_info(),
        funder: ctx.accounts.admin.to_account_info(),
        fee_authority: ctx.accounts.protocol.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
      },
      &[signer],
    ),
    tick_spacing,
    default_fee_rate,
  )
}

pub fn dex_set_default_fee_rate(ctx: Context<DexAdmin>, default_fee_rate: u16) -> Result<()> {
  let bump = signer_seeds(&ctx);
  let signer: &[&[u8]] = &[PROTOCOL_SEED, &bump];
  solve::cpi::set_default_fee_rate(
    CpiContext::new_with_signer(
      ctx.accounts.solve_program.to_account_info(),
      solve::cpi::accounts::SetDefaultFeeRate {
        solves_config: ctx.accounts.solves_config.to_account_info(),
        fee_tier: ctx.accounts.target.to_account_info(),
        fee_authority: ctx.accounts.protocol.to_account_info(),
      },
      &[signer],
    ),
    default_fee_rate,
  )
}

pub fn dex_set_default_protocol_fee_rate(ctx: Context<DexAdmin>, default_protocol_fee_rate: u16) -> Result<()> {
  // New pools start ungauged, so they start at the ungauged split (the rule sync_pool_fee_rate applies).
  require!(default_protocol_fee_rate == UNGAUGED_PROTOCOL_FEE_RATE, ErrorCode::InvalidAmount);
  let bump = signer_seeds(&ctx);
  let signer: &[&[u8]] = &[PROTOCOL_SEED, &bump];
  solve::cpi::set_default_protocol_fee_rate(
    CpiContext::new_with_signer(
      ctx.accounts.solve_program.to_account_info(),
      solve::cpi::accounts::SetDefaultProtocolFeeRate {
        solves_config: ctx.accounts.solves_config.to_account_info(),
        fee_authority: ctx.accounts.protocol.to_account_info(),
      },
      &[signer],
    ),
    default_protocol_fee_rate,
  )
}

pub fn dex_set_fee_rate(ctx: Context<DexAdmin>, fee_rate: u16) -> Result<()> {
  let bump = signer_seeds(&ctx);
  let signer: &[&[u8]] = &[PROTOCOL_SEED, &bump];
  solve::cpi::set_fee_rate(
    CpiContext::new_with_signer(
      ctx.accounts.solve_program.to_account_info(),
      solve::cpi::accounts::SetFeeRate {
        solves_config: ctx.accounts.solves_config.to_account_info(),
        solve: ctx.accounts.target.to_account_info(),
        fee_authority: ctx.accounts.protocol.to_account_info(),
      },
      &[signer],
    ),
    fee_rate,
  )
}

pub fn dex_set_trading_pauses(ctx: Context<DexAdmin>, swaps_paused: bool, liquidity_increases_paused: bool) -> Result<()> {
  let bump = signer_seeds(&ctx);
  let signer: &[&[u8]] = &[PROTOCOL_SEED, &bump];
  solve::cpi::set_trading_pauses(
    CpiContext::new_with_signer(
      ctx.accounts.solve_program.to_account_info(),
      solve::cpi::accounts::SetTradingPauses {
        solves_config: ctx.accounts.solves_config.to_account_info(),
        fee_authority: ctx.accounts.protocol.to_account_info(),
      },
      &[signer],
    ),
    swaps_paused,
    liquidity_increases_paused,
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn active_gauges_send_every_fee_to_voters_and_the_rest_keep_95_5() {
    assert_eq!(target_protocol_fee_rate(true), 10_000);
    assert_eq!(target_protocol_fee_rate(false), 500);
  }
}
