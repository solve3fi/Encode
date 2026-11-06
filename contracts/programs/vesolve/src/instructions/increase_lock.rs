use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{PROTOCOL_SEED, VE_LOCK_SEED};
use crate::errors::ErrorCode;
use crate::events::LockUpdated;
use crate::states::{Lock, Protocol};
use crate::utils::transfer_token_to_protocol;

#[derive(Accounts)]
#[instruction(ve_token_id: u64, amount: u64)]
pub struct IncreaseLock<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()],
    bump = lock.bump,
    constraint = lock.owner == user.key() @ ErrorCode::InvalidOwner,
  )]
  pub lock: Box<Account<'info, Lock>>,

  #[account(
    mut,
    constraint = user_token_account.mint == protocol.token_mint @ ErrorCode::InvalidMint,
    constraint = user_token_account.owner == user.key() @ ErrorCode::InvalidOwner,
    constraint = user_token_account.amount >= amount @ ErrorCode::InsufficientFunds,
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
    constraint = protocol_token_account.owner == protocol.key() @ ErrorCode::InvalidOwner,
  )]
  pub protocol_token_account: InterfaceAccount<'info, TokenAccount>,

  pub token_program: Interface<'info, TokenInterface>,
}


pub fn increase_lock(
  ctx: Context<IncreaseLock>,
  ve_token_id: u64,
  amount: u64,
) -> Result<()> {
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;

  require!(amount > 0, ErrorCode::InvalidAmount);

  let protocol = &mut ctx.accounts.protocol;
  let lock = &mut ctx.accounts.lock;

  require!(ve_token_id == lock.ve_token_id, ErrorCode::InvalidVeTokenId);
  require!(lock.amount > 0, ErrorCode::LockIsEmpty);
  require!(!lock.is_expired(current_time), ErrorCode::LockExpired);

  transfer_token_to_protocol(
    &ctx.accounts.user,
    &ctx.accounts.token_mint,
    &ctx.accounts.user_token_account,
    &ctx.accounts.protocol_token_account,
    &ctx.accounts.token_program,
    amount,
  )?;

  let old_amount = lock.amount;
  let old_voting_power = lock.voting_power;

  lock.amount = lock.amount.checked_add(amount)
      .ok_or(ErrorCode::ArithmeticOverflow)?;

  lock.voting_power = lock.calculate_voting_power(current_time);

  protocol.total_locked = protocol.total_locked.checked_add(amount)
      .ok_or(ErrorCode::ArithmeticOverflow)?;

  emit!(LockUpdated {
    owner: lock.owner,
    nft_token_id: lock.ve_token_id,
    old_amount,
    new_amount: lock.amount,
    old_voting_power,
    new_voting_power: lock.voting_power,
  });

  Ok(())

}
