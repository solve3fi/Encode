use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{AUTO_VOTE_DELEGATE_SEED, AUTO_VOTE_SEED, PROTOCOL_SEED, VE_LOCK_SEED, VE_TOKEN_SEED};
use crate::errors::ErrorCode;
use crate::events::{LockTransferred};
use crate::states::{Lock, Protocol};
use crate::utils::{close_program_account_if_present, transfer_ve_token};

#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct TransferLock<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(
    mut,
    seeds = [PROTOCOL_SEED],
    bump = protocol.bump,
    constraint = protocol.admin != Pubkey::default() @ ErrorCode::Unauthorized,
  )]
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
    seeds = [VE_TOKEN_SEED, lock.ve_token_id.to_le_bytes().as_ref()],
    bump
  )]
  pub ve_mint: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    constraint = ve_token_account.mint == ve_mint.key() @ ErrorCode::InvalidMint,
    constraint = ve_token_account.owner == user.key() @ ErrorCode::InvalidOwner,
    constraint = ve_token_account.amount == 1 @ ErrorCode::InvalidAmount,
  )]
  pub ve_token_account: InterfaceAccount<'info, TokenAccount>,

  #[account(
    mut,
    constraint = destination_token_account.mint == ve_mint.key() @ ErrorCode::InvalidMint,
    constraint = destination_token_account.owner == destination.key() @ ErrorCode::InvalidOwner,
  )]
  pub destination_token_account: InterfaceAccount<'info, TokenAccount>,

  /// CHECK: Recipient of the NFT
  pub destination: AccountInfo<'info>,

  pub token_program: Interface<'info, TokenInterface>,

  /// CHECK: the lock's Auto-Vote enrollment PDA, closed if present: the new owner did not enroll (review M-1).
  #[account(mut, seeds = [AUTO_VOTE_SEED, lock.key().as_ref()], bump)]
  pub auto_vote_enrollment: UncheckedAccount<'info>,

  /// CHECK: the lock's auto-voter choice PDA, closed if present for the same reason.
  #[account(mut, seeds = [AUTO_VOTE_DELEGATE_SEED, lock.key().as_ref()], bump)]
  pub auto_vote_delegate: UncheckedAccount<'info>,
}


pub fn transfer_lock(
  ctx: Context<TransferLock>,
  ve_token_id: u64,
) -> Result<()> {
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;

  let protocol = &ctx.accounts.protocol;
  let lock = &mut ctx.accounts.lock;

  require!(ve_token_id == lock.ve_token_id, ErrorCode::InvalidVeTokenId);
  require!(!lock.is_expired(current_time), ErrorCode::LockExpired);
  require!(
    lock.last_vote_epoch < protocol.current_epoch,
    ErrorCode::LockHasActiveVotes
  );
  require!(ctx.accounts.destination.key() != ctx.accounts.user.key(), ErrorCode::InvalidOwner);

  lock.voting_power = lock.calculate_voting_power(current_time);

  transfer_ve_token(
    &ctx.accounts.user,
    &ctx.accounts.ve_mint,
    &ctx.accounts.ve_token_account,
    &ctx.accounts.destination_token_account,
    &ctx.accounts.token_program,
    lock.ve_token_id,
    ctx.bumps.ve_mint,
  )?;

  lock.owner = ctx.accounts.destination.key();

  // The seller's Auto-Vote settings must not keep steering the buyer's lock; rent goes back to the seller.
  let user = ctx.accounts.user.to_account_info();
  close_program_account_if_present(&ctx.accounts.auto_vote_enrollment.to_account_info(), &user)?;
  close_program_account_if_present(&ctx.accounts.auto_vote_delegate.to_account_info(), &user)?;

  emit!(LockTransferred {
    from: ctx.accounts.user.key(),
    to: ctx.accounts.destination.key(),
    nft_token_id: lock.ve_token_id,
  });

  Ok(())
}
