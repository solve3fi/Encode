use anchor_lang::prelude::*;

use crate::auth::admin::is_admin_key;
use crate::constants::{EPOCH_DATA_SEED, PROTOCOL_SEED, WEEK};
use crate::errors::ErrorCode;
use crate::states::{Epoch, Protocol};
use crate::events::ProtocolInitialized;

#[derive(Accounts)]
pub struct Initialize<'info> {
  #[account(
    mut,
    constraint = is_admin_key(&payer.key()) @ ErrorCode::Unauthorized,
  )]
  pub payer: Signer<'info>,

  #[account(
    init,
    payer = payer,
    space = 8 + Protocol::INIT_SPACE,
    seeds = [PROTOCOL_SEED],
    bump
  )]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init,
    payer = payer,
    space = 8 + Epoch::INIT_SPACE,
    seeds = [EPOCH_DATA_SEED, 0u64.to_le_bytes().as_ref()],
    bump
  )]
  pub epoch: Box<Account<'info, Epoch>>,

  pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>, mint_token: Pubkey, epoch_reset_time: i64) -> Result<()> {

  let protocol = &mut ctx.accounts.protocol;
  let epoch = &mut ctx.accounts.epoch;
  let clock = Clock::get()?;

  require!(epoch_reset_time == WEEK, ErrorCode::InvalidEpoch);
  if crate::constants::FAST_EPOCHS {
    msg!("fast-epochs test build: epoch length {} seconds", WEEK);
  }

  // Unix time began on a Thursday, so floor(timestamp / WEEK) * WEEK is
  // always Thursday 00:00 UTC (Wednesday evening in North America).
  let epoch_start_time = clock.unix_timestamp
    .checked_div(WEEK)
    .ok_or(ErrorCode::ArithmeticOverflow)?
    .checked_mul(WEEK)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  protocol.admin = ctx.accounts.payer.key();
  protocol.token_mint = mint_token;
  protocol.next_nft_token_id = 1;
  protocol.total_supply = 0;
  protocol.total_locked = 0;
  protocol.current_epoch = 0;
  protocol.last_emission_time = 0;
  protocol.epoch_start_time = epoch_start_time;
  protocol.epoch_reset_time = WEEK;
  protocol.bump = ctx.bumps.protocol;

  epoch.epoch = 0;
  epoch.start_time = epoch_start_time;
  epoch.end_time = epoch_start_time
    .checked_add(WEEK)
    .ok_or(ErrorCode::ArithmeticOverflow)?;
  epoch.total_voting_power = 0;
  epoch.total_votes = 0;
  epoch.gauge_weights = Vec::new();
  epoch.bribes = Vec::new();
  epoch.bump = ctx.bumps.epoch;

  emit!(ProtocolInitialized {
    admin: protocol.admin,
    token_mint: protocol.token_mint,
    next_nft_token_id: protocol.next_nft_token_id,
    total_supply: protocol.total_supply,
    total_locked: protocol.total_locked,
    current_epoch: protocol.current_epoch,
    epoch_start_time: protocol.epoch_start_time,
    epoch_reset_time: protocol.epoch_reset_time,
  });

  Ok(()) 
}
