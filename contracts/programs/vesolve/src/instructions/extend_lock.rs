use anchor_lang::prelude::*;

use crate::constants::VE_LOCK_SEED;
use crate::errors::ErrorCode;
use crate::events::LockExtended;
use crate::states::{Lock};

#[derive(Accounts)]
#[instruction(ve_token_id: u64, unlock_time: i64)]
pub struct ExtendLock<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(
    mut,
    seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()],
    bump = lock.bump,
    constraint = lock.owner == user.key() @ ErrorCode::InvalidOwner,
  )]
  pub lock: Box<Account<'info, Lock>>,
}


pub fn extend_lock(
  ctx: Context<ExtendLock>,
  ve_token_id: u64,
  _unlock_time: i64,
) -> Result<()> {
  let lock = &mut ctx.accounts.lock;
  let old_unlock_time = lock.unlock_time;

  require!(ve_token_id == lock.ve_token_id, ErrorCode::InvalidVeTokenId);
  lock.unlock_time = i64::MAX;
  lock.voting_power = lock.amount;

  emit!(LockExtended {
    owner: lock.owner,
    nft_token_id: lock.ve_token_id,
    old_unlock_time,
    new_unlock_time: i64::MAX,
  });

  Ok(())

}
