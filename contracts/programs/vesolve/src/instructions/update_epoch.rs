use anchor_lang::prelude::*;

use crate::constants::{EPOCH_DATA_SEED, PROTOCOL_SEED, WEEK};
use crate::errors::ErrorCode;
use crate::events::EpochUpdated;
use crate::states::{Protocol, Epoch};

#[derive(Accounts)]
pub struct UpdateEpoch<'info> {
  /// Intentionally permissionless: anyone may crank the epoch forward once the
  /// week boundary passes. The signer only pays the new `Epoch` PDA's rent;
  /// no privilege is derived from being the caller.
  #[account(mut)]
  pub caller: Signer<'info>,

  #[account(
    mut,
    seeds = [PROTOCOL_SEED],
    bump = protocol.bump,
  )]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init,
    payer = caller,
    space = 8 + Epoch::INIT_SPACE,
    seeds = [EPOCH_DATA_SEED, (protocol.current_epoch + 1).to_le_bytes().as_ref()],
    bump
  )]
  pub epoch: Box<Account<'info, Epoch>>,

  pub system_program: Program<'info, System>,
}


pub fn update_epoch(ctx: Context<UpdateEpoch>) -> Result<()> {
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;

  let protocol = &mut ctx.accounts.protocol;
  let epoch = &mut ctx.accounts.epoch;

  let boundary = current_time
    .checked_div(WEEK)
    .ok_or(ErrorCode::ArithmeticOverflow)?
    .checked_mul(WEEK)
    .ok_or(ErrorCode::ArithmeticOverflow)?;
  require!(boundary > protocol.epoch_start_time, ErrorCode::InvalidEpoch);

  protocol.current_epoch = protocol.current_epoch
    .checked_add(1)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  protocol.epoch_start_time = boundary;
  protocol.epoch_reset_time = WEEK;

  epoch.epoch = protocol.current_epoch;
  epoch.start_time = boundary;
  epoch.end_time = boundary
    .checked_add(WEEK)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  epoch.total_voting_power = 0;
  epoch.total_votes = 0;
  epoch.gauge_weights = Vec::new();
  epoch.bribes = Vec::new();
  epoch.bump = ctx.bumps.epoch;

  emit!(EpochUpdated {
    epoch: epoch.epoch,
    start_time: epoch.start_time,
    end_time: epoch.end_time,
  });
  
  Ok(())
}
