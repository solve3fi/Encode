use anchor_lang::prelude::*;

use crate::constants::{GAUGE_SEED, PROTOCOL_SEED};
use crate::events::GaugeCreated;
use crate::states::{Protocol, Gauge};
use crate::errors::ErrorCode;

#[derive(Accounts)]
#[instruction(pool_address: Pubkey, token_mint_a: Pubkey, token_mint_b: Pubkey, fee_tier: u16)]
pub struct CreateGauge<'info> {
  #[account(mut)]
  pub admin: Signer<'info>,

  #[account(
    mut,
    seeds = [PROTOCOL_SEED],
    bump = protocol.bump,
    constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized,
  )]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init,
    payer = admin,
    space = 8 + Gauge::INIT_SPACE,
    seeds = [GAUGE_SEED, protocol.key().as_ref(), pool_address.as_ref()],
    bump
  )]
  pub gauge: Box<Account<'info, Gauge>>,

  pub system_program: Program<'info, System>,
}

pub fn create_gauge<'info>(
  ctx: Context<CreateGauge>,
  pool_address: Pubkey,
  token_mint_a: Pubkey,
  token_mint_b: Pubkey,
  fee_tier: u16,
) -> Result<()> {
  let gauge = &mut ctx.accounts.gauge;

  gauge.pool_address = pool_address;
  gauge.token_mint_a = token_mint_a;
  gauge.token_mint_b = token_mint_b;
  gauge.fee_tier = fee_tier;
  // A bare/old-client create call must not activate an unfunded fee policy.
  // configure_native_gauge enables range-aware LP rewards and 100% gauge
  // fees atomically, then activates this gauge (normally in the same tx).
  gauge.is_active = false;
  gauge.status = crate::states::GAUGE_CREATED;
  gauge.effective_epoch = 0;
  gauge.generation = 0;
  gauge.bump = ctx.bumps.gauge;

  emit!(GaugeCreated {
    pool_address: gauge.pool_address,
    token_mint_a: gauge.token_mint_a,
    token_mint_b: gauge.token_mint_b,
    fee_tier: gauge.fee_tier,
    is_active: gauge.is_active,
  });

  Ok(())
}
