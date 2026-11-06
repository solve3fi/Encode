use anchor_lang::prelude::*;

use crate::constants::{GAUGE_SEED, MIN_GAUGE_TICK_SPACING, PROTOCOL_SEED};
use crate::errors::ErrorCode;
use crate::events::GaugeScheduled;
use crate::states::{
  sorted_pair, AdminConfig, Gauge, PairCanonical, PausableSystem, Protocol, GAUGE_ACTIVE, GAUGE_CREATED,
  GAUGE_PENDING_ACTIVATION, GAUGE_PENDING_REMOVAL, GAUGE_REMOVED, PAIR_SEED,
};

/// Admin requests that a gauge become active at the next rollover. The gauge
/// may take votes straight away; fee routing and emissions switch when
/// `configure_native_gauge(true)` runs in the new epoch.
#[derive(Accounts)]
#[instruction(mint_lo: Pubkey, mint_hi: Pubkey)]
pub struct ScheduleGaugeActivation<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    seeds = [GAUGE_SEED, protocol.key().as_ref(), gauge.pool_address.as_ref()],
    bump = gauge.bump,
  )]
  pub gauge: Box<Account<'info, Gauge>>,

  #[account(constraint = pool.key() == gauge.pool_address @ ErrorCode::InvalidGauge)]
  pub pool: Box<Account<'info, solve::state::Solve>>,

  #[account(
    init_if_needed,
    payer = admin,
    space = 8 + PairCanonical::INIT_SPACE,
    seeds = [PAIR_SEED, mint_lo.as_ref(), mint_hi.as_ref()],
    bump
  )]
  pub pair: Box<Account<'info, PairCanonical>>,

  /// The gauge currently holding the pair, when there is one and it is not
  /// this gauge. Its status decides whether the pair is free.
  pub occupant: Option<Box<Account<'info, Gauge>>>,

  pub system_program: Program<'info, System>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn schedule_gauge_activation(ctx: Context<ScheduleGaugeActivation>, mint_lo: Pubkey, mint_hi: Pubkey) -> Result<()> {
  AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, PausableSystem::GaugeActivation)?;
  let current_epoch = ctx.accounts.protocol.current_epoch;
  let gauge = &mut ctx.accounts.gauge;
  let pair = &mut ctx.accounts.pair;

  require!(sorted_pair(&gauge.token_mint_a, &gauge.token_mint_b) == (mint_lo, mint_hi), ErrorCode::InvalidPair);
  require!(gauge.status == GAUGE_CREATED || gauge.status == GAUGE_REMOVED, ErrorCode::GaugeStateInvalid);
  // Fail now, not at activation, if the pool could never carry a gauge.
  require!(ctx.accounts.pool.tick_spacing >= MIN_GAUGE_TICK_SPACING, ErrorCode::PoolRangeTooNarrow);

  if pair.bump == 0 {
    pair.mint_lo = mint_lo;
    pair.mint_hi = mint_hi;
    pair.bump = ctx.bumps.pair;
  }
  // One canonical pool per pair: free when empty, when the holder is this
  // gauge's own earlier run, or when the holder has been removed.
  if pair.gauge != Pubkey::default() && pair.gauge != gauge.key() {
    let occupant = ctx.accounts.occupant.as_ref().ok_or(ErrorCode::PairHasGauge)?;
    require_keys_eq!(occupant.key(), pair.gauge, ErrorCode::InvalidPair);
    require!(occupant.status == GAUGE_REMOVED, ErrorCode::PairHasGauge);
  }
  pair.gauge = gauge.key();

  begin_activation(gauge, current_epoch)?;
  emit!(GaugeScheduled { gauge: gauge.key(), pool: gauge.pool_address, kind: 0, effective_epoch: gauge.effective_epoch });
  Ok(())
}

fn begin_activation(gauge: &mut Gauge, current_epoch: u64) -> Result<()> {
  if gauge.status == GAUGE_REMOVED {
    gauge.generation = gauge.generation.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;
  }
  gauge.status = GAUGE_PENDING_ACTIVATION;
  gauge.effective_epoch = current_epoch.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;
  Ok(())
}

/// Admin requests removal of an active gauge. It stays normal through this
/// epoch; new bribes stop now; fee routing returns to 95/5 once
/// `configure_native_gauge(false)` runs in the next epoch.
#[derive(Accounts)]
pub struct RequestGaugeRemoval<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    seeds = [GAUGE_SEED, protocol.key().as_ref(), gauge.pool_address.as_ref()],
    bump = gauge.bump,
  )]
  pub gauge: Box<Account<'info, Gauge>>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn request_gauge_removal(ctx: Context<RequestGaugeRemoval>) -> Result<()> {
  AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, PausableSystem::GaugeActivation)?;
  let current_epoch = ctx.accounts.protocol.current_epoch;
  let gauge = &mut ctx.accounts.gauge;
  require!(gauge.status == GAUGE_ACTIVE, ErrorCode::GaugeStateInvalid);
  gauge.status = GAUGE_PENDING_REMOVAL;
  gauge.effective_epoch = current_epoch.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;
  emit!(GaugeScheduled { gauge: gauge.key(), pool: gauge.pool_address, kind: 1, effective_epoch: gauge.effective_epoch });
  Ok(())
}

/// Moves the pair's canonical gauge from one pool to another at a single
/// rollover: the old gauge goes PENDING_REMOVAL and the new one
/// PENDING_ACTIVATION with the same effective epoch, so the pair never has
/// two active gauges.
#[derive(Accounts)]
#[instruction(mint_lo: Pubkey, mint_hi: Pubkey)]
pub struct ScheduleGaugeMigration<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    seeds = [GAUGE_SEED, protocol.key().as_ref(), old_gauge.pool_address.as_ref()],
    bump = old_gauge.bump,
  )]
  pub old_gauge: Box<Account<'info, Gauge>>,

  #[account(
    mut,
    seeds = [GAUGE_SEED, protocol.key().as_ref(), new_gauge.pool_address.as_ref()],
    bump = new_gauge.bump,
  )]
  pub new_gauge: Box<Account<'info, Gauge>>,

  #[account(constraint = new_pool.key() == new_gauge.pool_address @ ErrorCode::InvalidGauge)]
  pub new_pool: Box<Account<'info, solve::state::Solve>>,

  #[account(
    mut,
    seeds = [PAIR_SEED, mint_lo.as_ref(), mint_hi.as_ref()],
    bump = pair.bump,
  )]
  pub pair: Box<Account<'info, PairCanonical>>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn schedule_gauge_migration(ctx: Context<ScheduleGaugeMigration>, mint_lo: Pubkey, mint_hi: Pubkey) -> Result<()> {
  AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, PausableSystem::GaugeActivation)?;
  let current_epoch = ctx.accounts.protocol.current_epoch;
  let old = &mut ctx.accounts.old_gauge;
  let new = &mut ctx.accounts.new_gauge;
  let pair = &mut ctx.accounts.pair;

  require_keys_neq!(old.key(), new.key(), ErrorCode::InvalidGauge);
  require_keys_eq!(pair.gauge, old.key(), ErrorCode::InvalidPair);
  require!(sorted_pair(&old.token_mint_a, &old.token_mint_b) == (mint_lo, mint_hi), ErrorCode::InvalidPair);
  require!(sorted_pair(&new.token_mint_a, &new.token_mint_b) == (mint_lo, mint_hi), ErrorCode::InvalidPair);
  require!(old.status == GAUGE_ACTIVE, ErrorCode::GaugeStateInvalid);
  require!(new.status == GAUGE_CREATED || new.status == GAUGE_REMOVED, ErrorCode::GaugeStateInvalid);
  require!(ctx.accounts.new_pool.tick_spacing >= MIN_GAUGE_TICK_SPACING, ErrorCode::PoolRangeTooNarrow);

  old.status = GAUGE_PENDING_REMOVAL;
  old.effective_epoch = current_epoch.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;
  begin_activation(new, current_epoch)?;
  pair.gauge = new.key();

  emit!(GaugeScheduled { gauge: old.key(), pool: old.pool_address, kind: 2, effective_epoch: old.effective_epoch });
  emit!(GaugeScheduled { gauge: new.key(), pool: new.pool_address, kind: 2, effective_epoch: new.effective_epoch });
  Ok(())
}
