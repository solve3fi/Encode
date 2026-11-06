use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{PROTOCOL_SEED, VE_LOCK_SEED, VE_TOKEN_SEED};
use crate::errors::ErrorCode;
use crate::events::{LockBurned, LockUpdated};
use crate::states::{Lock, Protocol};
use crate::utils::{burn_and_close_ve_token};

#[derive(Accounts)]
#[instruction(primary_ve_token_id: u64, secondary_ve_token_id: u64)]
pub struct MergeLock<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    seeds = [VE_LOCK_SEED, primary_ve_token_id.to_le_bytes().as_ref()],
    bump = primary_lock.bump,
    constraint = primary_lock.owner == user.key() @ ErrorCode::InvalidOwner,
  )]
  pub primary_lock: Box<Account<'info, Lock>>,

  #[account(
    mut,
    seeds = [VE_LOCK_SEED, secondary_ve_token_id.to_le_bytes().as_ref()],
    bump = secondary_lock.bump,
    constraint = secondary_lock.owner == user.key() @ ErrorCode::InvalidOwner,
  )]
  pub secondary_lock: Box<Account<'info, Lock>>,

  #[account(
    mut,
    seeds = [VE_TOKEN_SEED, secondary_lock.ve_token_id.to_le_bytes().as_ref()],
    bump,
    constraint = secondary_ve_mint.key() == secondary_lock.ve_mint @ ErrorCode::InvalidMint,
  )]
  pub secondary_ve_mint: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    constraint = secondary_ve_token_account.mint == secondary_ve_mint.key() @ ErrorCode::InvalidMint,
    constraint = secondary_ve_token_account.owner == user.key() @ ErrorCode::InvalidOwner,
    constraint = secondary_ve_token_account.amount == 1 @ ErrorCode::InvalidAmount,
  )]
  pub secondary_ve_token_account: InterfaceAccount<'info, TokenAccount>,

  pub token_program: Interface<'info, TokenInterface>,
}


/// Both locks must be unvoted in the current epoch.
fn merge_allowed(primary_last_vote: u64, secondary_last_vote: u64, current_epoch: u64) -> bool {
  primary_last_vote < current_epoch && secondary_last_vote < current_epoch
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn merge_is_refused_if_either_lock_voted_this_epoch() {
    assert!(merge_allowed(0, 0, 5));
    assert!(merge_allowed(4, 4, 5));
    assert!(!merge_allowed(5, 0, 5));
    assert!(!merge_allowed(0, 5, 5));
    assert!(!merge_allowed(5, 5, 5));
  }
}

pub fn merge_lock(
  ctx: Context<MergeLock>,
  primary_ve_token_id: u64,
  secondary_ve_token_id: u64,
) -> Result<()> {
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;

  let protocol = &mut ctx.accounts.protocol;
  let primary_lock = &mut ctx.accounts.primary_lock;
  let secondary_lock = &mut ctx.accounts.secondary_lock;

  require!(primary_ve_token_id == primary_lock.ve_token_id, ErrorCode::InvalidVeTokenId);
  require!(secondary_ve_token_id == secondary_lock.ve_token_id, ErrorCode::InvalidVeTokenId);
  // Anchor resolves `primary_lock` and `secondary_lock` independently by
  // seeds, so passing the same ve_token_id for both aliases them onto the
  // same underlying account: `secondary_lock`'s `close = user` would then
  // close the account out from under `primary_lock` after this function
  // had already added its own amount to itself and signed a burn/transfer
  // against a token account that's simultaneously the "primary" owner's,
  // permanently destroying the lock and stranding its principal.
  require!(primary_ve_token_id != secondary_ve_token_id, ErrorCode::InvalidVeTokenId);
  require!(primary_lock.can_merge_with(&secondary_lock, current_time), ErrorCode::InvalidLock);
  // A9: a position that voted this epoch cannot be merged. Its vote record is
  // keyed to the lock being burned, so merging would orphan a live vote.
  require!(
    merge_allowed(primary_lock.last_vote_epoch, secondary_lock.last_vote_epoch, protocol.current_epoch),
    ErrorCode::LockHasActiveVotes
  );

  // Emptied locks (fully exited or merged away) stay as records for their past rewards only (review L-2).
  require!(primary_lock.amount > 0 && secondary_lock.amount > 0, ErrorCode::LockIsEmpty);

  let old_amount = primary_lock.amount;
  let old_voting_power = primary_lock.voting_power;

  let new_amount = primary_lock.amount.checked_add(secondary_lock.amount)
      .ok_or(ErrorCode::ArithmeticOverflow)?;
  let new_unlock_time = primary_lock.unlock_time.max(secondary_lock.unlock_time);

  primary_lock.amount = new_amount;
  primary_lock.unlock_time = new_unlock_time;
  primary_lock.voting_power = primary_lock.calculate_voting_power(current_time);
  // Propagate the more recent vote: merging a just-voted lock into an
  // unvoted primary must not erase that the combined principal backed a
  // live vote this epoch, or exit_lock's LockHasActiveVotes guard could be
  // bypassed the same way a bare last_vote_epoch=0 reset on split did.
  primary_lock.last_vote_epoch = primary_lock.last_vote_epoch.max(secondary_lock.last_vote_epoch);

  // The CPI signer seeds must be the ve_mint's own PDA bump (it's its own
  // mint/freeze authority) — secondary_lock.bump is a different PDA's bump
  // and only coincidentally matches it for some token ids, which is why this
  // previously passed the wrong value undetected.
  burn_and_close_ve_token(
    &ctx.accounts.user,
    &ctx.accounts.secondary_ve_mint,
    &ctx.accounts.secondary_ve_token_account,
    &ctx.accounts.token_program,
    secondary_lock.ve_token_id,
    ctx.bumps.secondary_ve_mint,
  )?;

  protocol.total_supply = protocol.total_supply.checked_sub(1)
      .ok_or(ErrorCode::ArithmeticOverflow)?;

  // Keep the secondary Lock record, emptied, so rewards it earned before the merge stay claimable (review L-2).
  secondary_lock.amount = 0;
  secondary_lock.voting_power = 0;

  emit!(LockBurned {
    owner: secondary_lock.owner,
    nft_token_id: secondary_lock.ve_token_id,
  });

  emit!(LockUpdated {
    owner: primary_lock.owner,
    nft_token_id: primary_lock.ve_token_id,
    old_amount,
    new_amount: primary_lock.amount,
    old_voting_power,
    new_voting_power: primary_lock.voting_power,
  });

  Ok(())

}
