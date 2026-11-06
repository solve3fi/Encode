use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::metadata::Metadata;


use crate::constants::{PROTOCOL_SEED, VE_LOCK_SEED, VE_TOKEN_SEED};
use crate::errors::ErrorCode;
use crate::states::{Lock, Protocol};
use crate::utils::{burn_and_close_ve_token, mint_ve_token_with_metadata};

#[derive(Accounts)]
#[instruction(ve_token_id: u64, amount: u64)]
pub struct SplitLock<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()],
    bump = ve_lock.bump,
    constraint = ve_lock.owner == user.key() @ ErrorCode::InvalidOwner,
  )]
  pub ve_lock: Box<Account<'info, Lock>>,

  #[account(
    mut,
    seeds = [VE_TOKEN_SEED, ve_lock.ve_token_id.to_le_bytes().as_ref()],
    bump,
    constraint = ve_lock_mint.key() == ve_lock.ve_mint @ ErrorCode::InvalidMint,
  )]
  pub ve_lock_mint: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    constraint = ve_lock_token_account.mint == ve_lock_mint.key() @ ErrorCode::InvalidMint,
    constraint = ve_lock_token_account.owner == user.key() @ ErrorCode::InvalidOwner,
    constraint = ve_lock_token_account.amount == 1 @ ErrorCode::InvalidAmount,
  )]
  pub ve_lock_token_account: InterfaceAccount<'info, TokenAccount>,

  #[account(
    init,
    payer = user,
    space = 8 + Lock::INIT_SPACE,
    seeds = [VE_LOCK_SEED, protocol.next_nft_token_id.to_le_bytes().as_ref()],
    bump
  )]
  pub lock: Box<Account<'info, Lock>>,

  #[account(
    init,
    payer = user,
    mint::decimals = 0,
    mint::authority = ve_mint.key(),
    mint::freeze_authority = ve_mint.key(),
    seeds = [VE_TOKEN_SEED, protocol.next_nft_token_id.to_le_bytes().as_ref()],
    bump
  )]
  pub ve_mint: InterfaceAccount<'info, Mint>,

  #[account(
    init,
    payer = user,
    associated_token::mint = ve_mint,
    associated_token::authority = user,
  )]
  pub ve_token_account: InterfaceAccount<'info, TokenAccount>,

  /// CHECK: New Metaplex Account being created
  #[account(mut)]
  pub metadata: UncheckedAccount<'info>,

  pub system_program: Program<'info, System>,
  pub token_program: Interface<'info, TokenInterface>,
  pub associated_token_program: Program<'info, AssociatedToken>,
  pub metadata_program: Program<'info, Metadata>,
  pub rent: Sysvar<'info, Rent>,
}


pub fn split_lock(
  ctx: Context<SplitLock>,
  ve_token_id: u64,
  amount: u64,
) -> Result<()> {
  let protocol = &mut ctx.accounts.protocol;
  let ve_lock = &mut ctx.accounts.ve_lock;
  let ve_mint = &mut ctx.accounts.ve_mint;
  let lock = &mut ctx.accounts.lock;

  require!(ve_token_id == ve_lock.ve_token_id, ErrorCode::InvalidVeTokenId);
  require!(amount > 0, ErrorCode::InvalidAmount);
  require!(amount < ve_lock.amount, ErrorCode::InvalidAmount);

  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;

  require!(!ve_lock.is_expired(current_time), ErrorCode::LockExpired);
  // A lock that has already voted this epoch must not be splittable: the
  // vote already cast is a snapshot recorded in `epoch.gauge_weights` /
  // `user_vote` under the *current* owner, and it is not retroactively
  // reduced when `ve_lock.amount` shrinks below. Without this guard, an
  // owner could vote with the lock's full power, split off nearly all of
  // its backing into a brand-new (unvoted) lock, and transfer that lock to
  // a second account (transfer_lock already forbids moving a
  // just-voted lock, but the freshly split lock reports
  // `last_vote_epoch == 0` and is therefore transferable) which then casts
  // an independent vote with its own `user_vote` record. The two votes
  // combined would represent far more total voting power than the
  // lock's real backing ever supported, letting an attacker manufacture
  // outsized gauge weight / reward share for a fraction of the true cost.
  // Mirrors the identical guard in `transfer_lock` / `unlock_lock`.
  require!(
    ve_lock.last_vote_epoch < protocol.current_epoch,
    ErrorCode::LockHasActiveVotes
  );

  let split_amount = amount;
  let split_power = ve_lock.calculate_split_power(split_amount)?;

  mint_ve_token_with_metadata(
    &protocol,
    &ve_mint,
    &ctx.accounts.ve_token_account,
    &ctx.accounts.metadata,
    &ctx.accounts.user,
    &ctx.accounts.metadata_program,
    &ctx.accounts.token_program,
    &ctx.accounts.system_program,
    &ctx.accounts.rent,
    ctx.bumps.ve_mint,
  )?;


  let ve_token_id_new = protocol.next_nft_token_id;
  protocol.next_nft_token_id = protocol.next_nft_token_id
    .checked_add(1)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  protocol.total_supply = protocol.total_supply
    .checked_add(1)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  lock.owner = ctx.accounts.user.key();
  lock.ve_token_id = ve_token_id_new;
  lock.ve_mint = ve_mint.key();
  lock.amount = split_amount;
  lock.unlock_time = ve_lock.unlock_time;
  lock.voting_power = split_power;
  // Propagate, don't reset: a lock that voted this epoch stays "voted" after
  // being split, so exit_lock's LockHasActiveVotes guard still applies to
  // the split-off piece. Zeroing this let a voter split a just-voted lock
  // into an unvoted-looking lock and exit_lock it immediately, reclaiming
  // principal while the original vote's weight was still counted.
  lock.last_vote_epoch = ve_lock.last_vote_epoch;
  lock.bump = ctx.bumps.lock;

  // Update original lock
  ve_lock.amount = ve_lock.amount.checked_sub(split_amount).ok_or(ErrorCode::ArithmeticOverflow)?;
  ve_lock.voting_power = ve_lock.calculate_voting_power(current_time);

  // Check if original lock should be burned (amount = 0)
  if ve_lock.amount == 0 {
    // ve_lock.bump is this Lock PDA's bump, not ve_lock_mint's — the CPI
    // signer must use the mint's own PDA bump (see the same fix in
    // merge_lock.rs). This branch is currently unreachable (amount is
    // required to stay < ve_lock.amount above), but fixed for correctness.
    burn_and_close_ve_token(
      &ctx.accounts.user,
      &ctx.accounts.ve_lock_mint,
      &ctx.accounts.ve_lock_token_account,
      &ctx.accounts.token_program,
      ve_lock.ve_token_id,
      ctx.bumps.ve_lock_mint,
    )?;

    protocol.total_supply = protocol.total_supply.checked_sub(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
  }

  Ok(())

}
