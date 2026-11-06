use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
  BPS_DENOMINATOR, EXIT_CONFIG_SEED, EXIT_DISABLED_UNTIL_EPOCH, EXIT_FEE_CONFIG_SEED, KEEPER_CONFIG_SEED, MAX_EXIT_FEE_BPS,
  MAX_EXIT_PRICE_STEP_BPS, MIN_EXIT_PRICE_UPDATE_INTERVAL, PROTOCOL_SEED, SOLV3_UNITS_PER_TOKEN, VE_LOCK_SEED, VE_TOKEN_SEED,
};
use crate::errors::ErrorCode;
use crate::events::{ExitFeeScheduled, ExitFeesWithdrawn, ExitPriceUpdated, LockExited};
use crate::states::{AdminConfig, ExitConfig, ExitFeeConfig, Lock, Protocol};
use crate::utils::{burn_and_close_ve_token, transfer_token_from_protocol};

#[derive(Accounts)]
pub struct SetExitPrice<'info> {
  /// The Admin, or the price keeper named in KeeperConfig (checked in the handler).
  #[account(mut)]
  pub authority: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init_if_needed,
    payer = authority,
    space = 8 + ExitConfig::INIT_SPACE,
    seeds = [EXIT_CONFIG_SEED],
    bump
  )]
  pub exit_config: Box<Account<'info, ExitConfig>>,

  /// CHECK: canonical KeeperConfig PDA; may be uninitialized (no price keeper).
  #[account(seeds = [KEEPER_CONFIG_SEED], bump)]
  pub keeper_config: UncheckedAccount<'info>,

  pub system_program: Program<'info, System>,
}

/// Whether a price update stays inside the bounds (review L-3): at most MAX_EXIT_PRICE_STEP_BPS away from the
/// current price and at least MIN_EXIT_PRICE_UPDATE_INTERVAL after the last update.
pub(crate) fn exit_price_step_allowed(current: u64, next: u64, last_update: i64, now: i64) -> bool {
  let max_step = (current as u128) * (MAX_EXIT_PRICE_STEP_BPS as u128) / (BPS_DENOMINATOR as u128);
  let step = (current as i128 - next as i128).unsigned_abs();
  step <= max_step && now.saturating_sub(last_update) >= MIN_EXIT_PRICE_UPDATE_INTERVAL
}

/// Publishes the SOLV3-per-SOL rate the exit fee is charged against. SOLV3
/// has no price feed and its pools hold no liquidity, so this is an
/// administrator input, not an oracle reading.
pub fn set_exit_price(ctx: Context<SetExitPrice>, lamports_per_solv3: u64) -> Result<()> {
  require!(lamports_per_solv3 > 0, ErrorCode::InvalidAmount);

  let clock = Clock::get()?;
  let signer = ctx.accounts.authority.key();
  let is_admin = signer == ctx.accounts.protocol.admin;
  let keeper = crate::states::KeeperConfig::read(&ctx.accounts.keeper_config.to_account_info(), ctx.program_id)?;
  let is_keeper = keeper.is_some_and(|k| k != Pubkey::default() && k == signer);
  require!(is_admin || is_keeper, ErrorCode::Unauthorized);

  let exit_config = &mut ctx.accounts.exit_config;
  if exit_config.lamports_per_solv3 == 0 {
    // The first price can only come from the Admin; every later one moves within the step bounds.
    require!(is_admin, ErrorCode::Unauthorized);
  } else {
    require!(
      exit_price_step_allowed(exit_config.lamports_per_solv3, lamports_per_solv3, exit_config.updated_at, clock.unix_timestamp),
      ErrorCode::ExitPriceStepTooLarge
    );
  }

  exit_config.lamports_per_solv3 = lamports_per_solv3;
  exit_config.updated_at = clock.unix_timestamp;
  exit_config.updated_by = signer;
  exit_config.bump = ctx.bumps.exit_config;

  emit!(ExitPriceUpdated {
    updated_by: exit_config.updated_by,
    lamports_per_solv3: exit_config.lamports_per_solv3,
    updated_at: exit_config.updated_at,
  });

  Ok(())
}

#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct ExitLock<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    seeds = [EXIT_CONFIG_SEED],
    bump = exit_config.bump,
  )]
  pub exit_config: Box<Account<'info, ExitConfig>>,

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

  pub system_program: Program<'info, System>,
  pub token_program: Interface<'info, TokenInterface>,
  pub associated_token_program: Program<'info, AssociatedToken>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,

  /// CHECK: canonical ExitFeeConfig PDA; may be uninitialized (= initial fee).
  #[account(seeds = [EXIT_FEE_CONFIG_SEED], bump)]
  pub exit_fee_config: UncheckedAccount<'info>,
}

/// The fee for exiting `amount` base units: amount x price x bps, divided
/// once and rounded UP so no exit, however small, is free.
pub fn exit_fee_lamports(amount: u64, lamports_per_solv3: u64, fee_bps: u64) -> Result<u64> {
  let denominator = SOLV3_UNITS_PER_TOKEN
    .checked_mul(BPS_DENOMINATOR as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)?;
  let numerator = (amount as u128)
    .checked_mul(lamports_per_solv3 as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)?
    .checked_mul(fee_bps as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)?;
  let fee = numerator
    .checked_add(denominator - 1)
    .ok_or(ErrorCode::ArithmeticOverflow)?
    / denominator;
  u64::try_from(fee).map_err(|_| error!(ErrorCode::ArithmeticOverflow))
}

/// Exits a permanent lock: the owner pays EXIT_FEE_BPS of the position's
/// published market value in SOL to the protocol treasury and receives the
/// full SOLV3 principal back. This supersedes `unlock_lock`, which is
/// unreachable because permanent locks never expire.
pub fn exit_lock(ctx: Context<ExitLock>, ve_token_id: u64) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Exit)?;
  let protocol = &mut ctx.accounts.protocol;
  let lock = &mut ctx.accounts.lock;
  let exit_config = &ctx.accounts.exit_config;

  // Checked first and against the on-chain epoch counter, so no price, lock
  // state or client can bypass it. The frontend hiding the Exit page is not
  // a control; this is.
  require!(exit_is_open(protocol.current_epoch), ErrorCode::ExitDisabled);
  require!(ve_token_id == lock.ve_token_id, ErrorCode::InvalidVeTokenId);
  require!(exit_config.lamports_per_solv3 > 0, ErrorCode::ExitPriceNotSet);

  // A lock that voted in the current epoch still carries weight in the
  // epoch's tally, so it cannot be dissolved until that epoch closes — same
  // guard unlock_lock uses.
  require!(
    lock.last_vote_epoch < protocol.current_epoch,
    ErrorCode::LockHasActiveVotes
  );

  let amount = lock.amount;
  require!(amount > 0, ErrorCode::InvalidAmount);

  let fee_bps = ExitFeeConfig::read_effective_bps(
    &ctx.accounts.exit_fee_config.to_account_info(),
    ctx.program_id,
    protocol.current_epoch,
  )?;
  let fee_lamports = exit_fee_lamports(amount, exit_config.lamports_per_solv3, fee_bps)?;

  if fee_lamports > 0 {
    transfer(
      CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
          from: ctx.accounts.user.to_account_info(),
          to: protocol.to_account_info(),
        },
      ),
      fee_lamports,
    )?;
  }

  transfer_token_from_protocol(
    &protocol,
    &ctx.accounts.token_mint,
    &ctx.accounts.protocol_token_account,
    &ctx.accounts.user_token_account,
    &ctx.accounts.token_program,
    amount,
  )?;

  burn_and_close_ve_token(
    &ctx.accounts.user,
    &ctx.accounts.ve_mint,
    &ctx.accounts.ve_token_account,
    &ctx.accounts.token_program,
    lock.ve_token_id,
    ctx.bumps.ve_mint,
  )?;

  protocol.total_locked = protocol
    .total_locked
    .checked_sub(amount)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  protocol.total_supply = protocol
    .total_supply
    .checked_sub(1)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  // The Lock record stays (emptied, its NFT burned) so rewards it earned in earlier epochs can still be
  // claimed (review L-2). An empty lock cannot vote, grow, merge, split or exit again.
  lock.amount = 0;
  lock.voting_power = 0;

  emit!(LockExited {
    owner: lock.owner,
    nft_token_id: lock.ve_token_id,
    amount,
    fee_lamports,
    lamports_per_solv3: exit_config.lamports_per_solv3,
    fee_bps,
    remaining_amount: 0,
  });

  Ok(())
}

#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct PartialExitLock<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(seeds = [EXIT_CONFIG_SEED], bump = exit_config.bump)]
  pub exit_config: Box<Account<'info, ExitConfig>>,

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
    constraint = protocol_token_account.amount >= lock.amount @ ErrorCode::InsufficientFunds,
  )]
  pub protocol_token_account: InterfaceAccount<'info, TokenAccount>,

  pub system_program: Program<'info, System>,
  pub token_program: Interface<'info, TokenInterface>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,

  /// CHECK: canonical ExitFeeConfig PDA; may be uninitialized (= initial fee).
  #[account(seeds = [EXIT_FEE_CONFIG_SEED], bump)]
  pub exit_fee_config: UncheckedAccount<'info>,
}

/// Exits part of a lock: the fee applies only to `amount`, that amount of
/// SOLV3 goes back to the owner, and the rest stays permanently locked in the
/// same lock and ve token. Same gates as `exit_lock`.
pub fn partial_exit_lock(ctx: Context<PartialExitLock>, ve_token_id: u64, amount: u64) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Exit)?;
  let protocol = &mut ctx.accounts.protocol;
  let lock = &mut ctx.accounts.lock;
  let exit_config = &ctx.accounts.exit_config;

  require!(exit_is_open(protocol.current_epoch), ErrorCode::ExitDisabled);
  require!(ve_token_id == lock.ve_token_id, ErrorCode::InvalidVeTokenId);
  require!(exit_config.lamports_per_solv3 > 0, ErrorCode::ExitPriceNotSet);
  require!(lock.last_vote_epoch < protocol.current_epoch, ErrorCode::LockHasActiveVotes);
  require!(amount > 0, ErrorCode::InvalidAmount);
  require!(amount < lock.amount, ErrorCode::PartialExitMustLeaveRemainder);

  let fee_bps = ExitFeeConfig::read_effective_bps(
    &ctx.accounts.exit_fee_config.to_account_info(),
    ctx.program_id,
    protocol.current_epoch,
  )?;
  let fee_lamports = exit_fee_lamports(amount, exit_config.lamports_per_solv3, fee_bps)?;

  if fee_lamports > 0 {
    transfer(
      CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
          from: ctx.accounts.user.to_account_info(),
          to: protocol.to_account_info(),
        },
      ),
      fee_lamports,
    )?;
  }

  transfer_token_from_protocol(
    &protocol,
    &ctx.accounts.token_mint,
    &ctx.accounts.protocol_token_account,
    &ctx.accounts.user_token_account,
    &ctx.accounts.token_program,
    amount,
  )?;

  lock.amount = lock.amount.checked_sub(amount).ok_or(ErrorCode::ArithmeticOverflow)?;
  lock.voting_power = lock.calculate_voting_power(Clock::get()?.unix_timestamp);
  protocol.total_locked = protocol
    .total_locked
    .checked_sub(amount)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  emit!(LockExited {
    owner: lock.owner,
    nft_token_id: lock.ve_token_id,
    amount,
    fee_lamports,
    lamports_per_solv3: exit_config.lamports_per_solv3,
    fee_bps,
    remaining_amount: lock.amount,
  });

  Ok(())
}

#[derive(Accounts)]
pub struct SetExitFee<'info> {
  #[account(
    mut,
    constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized,
  )]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init_if_needed,
    payer = admin,
    space = 8 + ExitFeeConfig::INIT_SPACE,
    seeds = [EXIT_FEE_CONFIG_SEED],
    bump
  )]
  pub exit_fee_config: Box<Account<'info, ExitFeeConfig>>,

  pub system_program: Program<'info, System>,
}

/// Admin sets the exit fee percentage (basis points). It never applies to the
/// current epoch: the new value takes effect when the next epoch starts, and
/// a second change before then replaces the pending one.
pub fn set_exit_fee_bps(ctx: Context<SetExitFee>, fee_bps: u64) -> Result<()> {
  require!(fee_bps <= MAX_EXIT_FEE_BPS, ErrorCode::InvalidExitFee);

  let current_epoch = ctx.accounts.protocol.current_epoch;
  let config = &mut ctx.accounts.exit_fee_config;

  if config.bump == 0 {
    config.fee_bps = crate::constants::EXIT_FEE_BPS;
    config.bump = ctx.bumps.exit_fee_config;
  }
  // bank a pending change that already took effect before scheduling another
  config.fee_bps = config.effective_bps(current_epoch);
  config.pending_bps = fee_bps;
  config.pending_epoch = current_epoch.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;

  emit!(ExitFeeScheduled {
    updated_by: ctx.accounts.admin.key(),
    current_bps: config.fee_bps,
    new_bps: config.pending_bps,
    effective_epoch: config.pending_epoch,
  });

  Ok(())
}

#[derive(Accounts)]
pub struct WithdrawExitFees<'info> {
  #[account(
    mut,
    constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized,
  )]
  pub admin: Signer<'info>,

  #[account(
    mut,
    seeds = [PROTOCOL_SEED],
    bump = protocol.bump,
  )]
  pub protocol: Box<Account<'info, Protocol>>,

  /// CHECK: must be the Treasury recorded in AdminConfig; checked in the handler.
  #[account(mut)]
  pub destination: UncheckedAccount<'info>,

  /// CHECK: canonical AdminConfig PDA; read for the Treasury address.
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

/// Moves collected exit fees out of the protocol account, to the Treasury only. Lamports are moved
/// directly rather than via a system transfer because the protocol account is
/// program-owned, and never below its rent-exempt minimum.
pub fn withdraw_exit_fees(ctx: Context<WithdrawExitFees>, amount: u64) -> Result<()> {
  require!(amount > 0, ErrorCode::InvalidAmount);

  // Exit fees belong to the Treasury, not to wherever the Admin points them.
  let treasury = AdminConfig::read(&ctx.accounts.admin_config.to_account_info(), ctx.program_id)?
    .map(|c| c.treasury)
    .unwrap_or_default();
  require!(treasury != Pubkey::default(), ErrorCode::TreasuryNotSet);
  require_keys_eq!(ctx.accounts.destination.key(), treasury, ErrorCode::InvalidTreasury);

  let protocol_info = ctx.accounts.protocol.to_account_info();
  let rent_exempt_minimum = Rent::get()?.minimum_balance(protocol_info.data_len());
  let balance = protocol_info.lamports();

  let withdrawable = balance.saturating_sub(rent_exempt_minimum);
  require!(amount <= withdrawable, ErrorCode::InsufficientTreasuryBalance);

  **protocol_info.try_borrow_mut_lamports()? = balance
    .checked_sub(amount)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  let destination_info = ctx.accounts.destination.to_account_info();
  **destination_info.try_borrow_mut_lamports()? = destination_info
    .lamports()
    .checked_add(amount)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

  emit!(ExitFeesWithdrawn {
    admin: ctx.accounts.admin.key(),
    destination: ctx.accounts.destination.key(),
    amount,
  });

  Ok(())
}

/// Exit stays closed through the first four weeks after launch.
pub fn exit_is_open(current_epoch: u64) -> bool {
  current_epoch >= EXIT_DISABLED_UNTIL_EPOCH
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn exit_price_moves_at_most_a_quarter_per_update_and_not_too_often() {
    let t = 1_000_000;
    let later = t + MIN_EXIT_PRICE_UPDATE_INTERVAL;
    assert!(exit_price_step_allowed(1_000, 1_250, t, later));
    assert!(exit_price_step_allowed(1_000, 750, t, later));
    assert!(!exit_price_step_allowed(1_000, 1_251, t, later));
    assert!(!exit_price_step_allowed(1_000, 749, t, later));
    assert!(!exit_price_step_allowed(1_000, 1_100, t, later - 1), "too soon after the last update");
  }

  #[test]
  fn exit_is_closed_for_the_first_four_weeks() {
    for epoch in 0..EXIT_DISABLED_UNTIL_EPOCH {
      assert!(!exit_is_open(epoch), "epoch {epoch} must be closed");
    }
  }

  #[test]
  fn exit_floor_opens_at_epoch_four_and_stays_open() {
    assert_eq!(EXIT_DISABLED_UNTIL_EPOCH, 4);
    assert!(exit_is_open(4));
    assert!(exit_is_open(5));
    assert!(exit_is_open(u64::MAX));
  }

  #[test]
  fn fee_matches_the_formula_when_it_divides_evenly() {
    // 2 SOLV3 at 1 SOL each, 40% = 0.8 SOL
    assert_eq!(exit_fee_lamports(2_000_000_000, 1_000_000_000, 4_000).unwrap(), 800_000_000);
  }

  #[test]
  fn fee_rounds_up_so_no_exit_is_free() {
    for amount in [1u64, 2, 999, 1_000_000] {
      assert!(exit_fee_lamports(amount, 1, 4_000).unwrap() >= 1, "amount {amount}");
    }
    assert_eq!(exit_fee_lamports(1, 1, 4_000).unwrap(), 1);
    assert_eq!(exit_fee_lamports(0, 1_000_000_000, 4_000).unwrap(), 0);
    assert_eq!(exit_fee_lamports(1_000_000_000, 1_000_000_000, 0).unwrap(), 0);
  }

  #[test]
  fn fee_handles_the_supply_cap_without_overflow() {
    let hundred_million = 100_000_000u64 * 1_000_000_000;
    assert_eq!(exit_fee_lamports(hundred_million, 1_000_000_000, 10_000).unwrap(), 100_000_000_000_000_000);
  }
}
