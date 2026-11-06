use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{PROTOCOL_SEED, VE_LOCK_SEED, VE_TOKEN_SEED};
use crate::errors::ErrorCode;
use crate::states::{Lock, Protocol};
use crate::utils::{burn_and_close_ve_token, transfer_token_from_protocol};

#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct UnlockLock<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()],
    bump = lock.bump,
    constraint = lock.owner == user.key() @ ErrorCode::InvalidOwner,
    close = user
  )]
  pub lock: Box<Account<'info, Lock>>,

  #[account(
    mut,
    constraint = user_token_account.mint == protocol.token_mint @ ErrorCode::InvalidMint,
    constraint = user_token_account.owner == user.key() @ ErrorCode::InvalidOwner,
  )]
  pub user_token_account: InterfaceAccount<'info, TokenAccount>,

  #[account(
    mut,
    constraint = token_mint.key() == protocol.token_mint @ ErrorCode::InvalidMint,
  )]
  pub token_mint: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    constraint = protocol_token_account.mint == token_mint.key() @ ErrorCode::InvalidMint,
    constraint = protocol_token_account.amount >= lock.amount @ ErrorCode::InsufficientFunds,
  )]
  pub protocol_token_account: InterfaceAccount<'info, TokenAccount>,

  #[account(
    mut,
    seeds = [VE_TOKEN_SEED, lock.ve_token_id.to_le_bytes().as_ref()],
    bump
  )]
  pub ve_mint: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    associated_token::mint = ve_mint,
    associated_token::authority = user,
  )]
  pub ve_token_account: InterfaceAccount<'info, TokenAccount>,

  pub token_program: Interface<'info, TokenInterface>,
  pub associated_token_program: Program<'info, AssociatedToken>,
}


pub fn unlock_lock(
  ctx: Context<UnlockLock>,
  ve_token_id: u64,
) -> Result<()> {
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;

  let protocol = &mut ctx.accounts.protocol;
  let lock = &mut ctx.accounts.lock;

  require!(ve_token_id == lock.ve_token_id, ErrorCode::InvalidVeTokenId);
  require!(lock.is_expired(current_time), ErrorCode::LockNotExpired);
  require!(lock.last_vote_epoch < protocol.current_epoch, ErrorCode::LockHasActiveVotes);

  let current_voting_power = lock.calculate_voting_power(current_time);
  require!(current_voting_power == 0, ErrorCode::InvalidVotingPower);

  transfer_token_from_protocol(
    &protocol,
    &ctx.accounts.token_mint,
    &ctx.accounts.protocol_token_account,
    &ctx.accounts.user_token_account,
    &ctx.accounts.token_program,
    lock.amount,
  )?;

  protocol.total_locked = protocol.total_locked
    .checked_sub(lock.amount)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  protocol.total_supply = protocol.total_supply
    .checked_sub(1)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  burn_and_close_ve_token(
    &ctx.accounts.user,
    &ctx.accounts.ve_mint,
    &ctx.accounts.ve_token_account,
    &ctx.accounts.token_program,
    lock.ve_token_id,
    ctx.bumps.ve_mint,
  )?;

  Ok(())

}
