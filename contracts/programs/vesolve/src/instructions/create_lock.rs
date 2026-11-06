use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::metadata::Metadata;

use crate::constants::{PROTOCOL_SEED, VE_LOCK_SEED, VE_TOKEN_SEED};
use crate::events::LockCreated;
use crate::states::{Lock, Protocol};
use crate::errors::ErrorCode;
use crate::utils::{mint_ve_token_with_metadata, transfer_token_to_protocol};

#[derive(Accounts)]
#[instruction(amount: u64, unlock_time: i64)]
pub struct CreateLock<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init,
    payer = user,
    space = 8 + Lock::INIT_SPACE,
    seeds = [VE_LOCK_SEED, protocol.next_nft_token_id.to_le_bytes().as_ref()],
    bump
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


pub fn create_lock<'info>(
  ctx: Context<CreateLock>,
  amount: u64,
  _unlock_time: i64,
) -> Result<()> {
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;

  require!(amount > 0, ErrorCode::InvalidAmount);

  let protocol = &mut ctx.accounts.protocol;
  let ve_mint = &mut ctx.accounts.ve_mint;
  let lock = &mut ctx.accounts.lock;

  transfer_token_to_protocol(
    &ctx.accounts.user,
    &ctx.accounts.token_mint,
    &ctx.accounts.user_token_account,
    &ctx.accounts.protocol_token_account,
    &ctx.accounts.token_program,
    amount,
  )?;

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


  let ve_token_id = protocol.next_nft_token_id;
  protocol.next_nft_token_id = protocol.next_nft_token_id
    .checked_add(1)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  protocol.total_supply = protocol.total_supply
    .checked_add(1)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  lock.owner = ctx.accounts.user.key();
  lock.ve_token_id = ve_token_id;
  lock.ve_mint = ve_mint.key();
  lock.amount = amount;
  // Keep the legacy field and instruction argument for account/IDL compatibility.
  // New locks are permanent and never become eligible for the legacy fee-free unlock.
  lock.unlock_time = i64::MAX;
  lock.voting_power = lock.calculate_voting_power(current_time);
  lock.last_vote_epoch = 0;
  lock.bump = ctx.bumps.lock;

  protocol.total_locked = protocol.total_locked
    .checked_add(amount)
    .ok_or(ErrorCode::ArithmeticOverflow)?;


  emit!(LockCreated {
    owner: lock.owner,
    nft_token_id: lock.ve_token_id,
    token_mint: lock.ve_mint,
    amount: lock.amount,
    unlock_time: lock.unlock_time,
    voting_power: lock.voting_power,
    last_vote_epoch: lock.last_vote_epoch
  });

  Ok(())
}
