use anchor_lang::prelude::*;
use anchor_lang::solana_program::{bpf_loader_upgradeable, program::invoke_signed};

use crate::constants::{PROTOCOL_SEED, UPGRADE_AUTHORITY_SEED, UPGRADE_DELAY_SECONDS, UPGRADE_SCHEDULE_SEED};
use crate::errors::ErrorCode;
use crate::events::{UpgradeCancelled, UpgradeExecuted, UpgradeScheduled};
use crate::states::{Protocol, UpgradeSchedule};

/// Reads the upgrade authority out of a program-data account
/// (`UpgradeableLoaderState::ProgramData`: tag 3, slot, Option<Pubkey>).
fn program_data_authority(data: &[u8]) -> Option<Pubkey> {
  if data.len() < 45 || data[..4] != 3u32.to_le_bytes() || data[12] != 1 {
    return None;
  }
  Pubkey::try_from(&data[13..45]).ok()
}

/// Reads the authority out of a buffer account
/// (`UpgradeableLoaderState::Buffer`: tag 1, Option<Pubkey>).
fn buffer_authority(data: &[u8]) -> Option<Pubkey> {
  if data.len() < 37 || data[..4] != 1u32.to_le_bytes() || data[4] != 1 {
    return None;
  }
  Pubkey::try_from(&data[5..37]).ok()
}

/// Both the program's upgrade authority and the buffer's authority must be the
/// timelock PDA. Otherwise the buffer could be rewritten after scheduling, or
/// the upgrade could be done without waiting.
fn check_accounts(
  program: &AccountInfo,
  program_data: &AccountInfo,
  buffer: &AccountInfo,
  authority: &Pubkey,
) -> Result<()> {
  let (expected_data, _) = Pubkey::find_program_address(&[program.key.as_ref()], &bpf_loader_upgradeable::id());
  require_keys_eq!(program_data.key(), expected_data, ErrorCode::InvalidUpgradeBuffer);
  require_keys_eq!(*program.owner, bpf_loader_upgradeable::id(), ErrorCode::InvalidUpgradeBuffer);
  require_keys_eq!(*program_data.owner, bpf_loader_upgradeable::id(), ErrorCode::InvalidUpgradeBuffer);
  require_keys_eq!(*buffer.owner, bpf_loader_upgradeable::id(), ErrorCode::InvalidUpgradeBuffer);
  require!(program_data_authority(&program_data.try_borrow_data()?) == Some(*authority), ErrorCode::UpgradeAuthorityMismatch);
  require!(buffer_authority(&buffer.try_borrow_data()?) == Some(*authority), ErrorCode::InvalidUpgradeBuffer);
  Ok(())
}

/// Admin schedules an upgrade. Allowed under any pause (a nuclear pause must
/// not block shipping a fix, and the delay still applies).
#[derive(Accounts)]
#[instruction(target_program: Pubkey)]
pub struct ScheduleUpgrade<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Account<'info, Protocol>,

  #[account(
    init,
    payer = admin,
    space = 8 + UpgradeSchedule::INIT_SPACE,
    seeds = [UPGRADE_SCHEDULE_SEED, target_program.as_ref()],
    bump
  )]
  pub schedule: Account<'info, UpgradeSchedule>,

  /// CHECK: the target program account; owner and address are checked.
  #[account(address = target_program)]
  pub program: UncheckedAccount<'info>,

  /// CHECK: the target's program-data account; derived and read in `check_accounts`.
  pub program_data: UncheckedAccount<'info>,

  /// CHECK: loader buffer holding the new program; owner and authority are checked.
  pub buffer: UncheckedAccount<'info>,

  /// CHECK: PDA that must be the upgrade authority.
  #[account(seeds = [UPGRADE_AUTHORITY_SEED], bump)]
  pub upgrade_authority: UncheckedAccount<'info>,

  pub system_program: Program<'info, System>,
}

pub fn schedule_upgrade(ctx: Context<ScheduleUpgrade>, target_program: Pubkey) -> Result<()> {
  let a = &ctx.accounts;
  check_accounts(&a.program.to_account_info(), &a.program_data.to_account_info(), &a.buffer.to_account_info(), &a.upgrade_authority.key())?;
  let now = Clock::get()?.unix_timestamp;
  let executable_at = now.checked_add(UPGRADE_DELAY_SECONDS).ok_or(ErrorCode::ArithmeticOverflow)?;
  let buffer = a.buffer.key();
  let schedule = &mut ctx.accounts.schedule;
  schedule.program = target_program;
  schedule.buffer = buffer;
  schedule.scheduled_at = now;
  schedule.executable_at = executable_at;
  schedule.bump = ctx.bumps.schedule;
  emit!(UpgradeScheduled { program: target_program, buffer, executable_at });
  Ok(())
}

/// Admin cancels a scheduled upgrade at any time before it runs.
#[derive(Accounts)]
pub struct CancelUpgrade<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Account<'info, Protocol>,

  #[account(
    mut,
    close = admin,
    seeds = [UPGRADE_SCHEDULE_SEED, schedule.program.as_ref()],
    bump = schedule.bump
  )]
  pub schedule: Account<'info, UpgradeSchedule>,
}

pub fn cancel_upgrade(ctx: Context<CancelUpgrade>) -> Result<()> {
  let s = &ctx.accounts.schedule;
  emit!(UpgradeCancelled { program: s.program, buffer: s.buffer });
  Ok(())
}

/// Runs the loader's Upgrade once the delay has passed. The PDA signs as the
/// upgrade authority; the buffer's rent goes to the Admin as the loader's spill.
#[derive(Accounts)]
pub struct ExecuteUpgrade<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Account<'info, Protocol>,

  #[account(
    mut,
    close = admin,
    seeds = [UPGRADE_SCHEDULE_SEED, schedule.program.as_ref()],
    bump = schedule.bump
  )]
  pub schedule: Account<'info, UpgradeSchedule>,

  /// CHECK: must be the scheduled program.
  #[account(mut, address = schedule.program)]
  pub program: UncheckedAccount<'info>,

  /// CHECK: derived from the program and read in `check_accounts`.
  #[account(mut)]
  pub program_data: UncheckedAccount<'info>,

  /// CHECK: must be the scheduled buffer.
  #[account(mut, address = schedule.buffer)]
  pub buffer: UncheckedAccount<'info>,

  /// CHECK: PDA signer.
  #[account(seeds = [UPGRADE_AUTHORITY_SEED], bump)]
  pub upgrade_authority: UncheckedAccount<'info>,

  /// CHECK: loader rent sysvar.
  pub rent: UncheckedAccount<'info>,
  /// CHECK: loader clock sysvar.
  pub clock: UncheckedAccount<'info>,
  /// CHECK: the BPF upgradeable loader.
  #[account(address = bpf_loader_upgradeable::id())]
  pub loader: UncheckedAccount<'info>,
}

pub fn execute_upgrade(ctx: Context<ExecuteUpgrade>) -> Result<()> {
  let a = &ctx.accounts;
  require!(Clock::get()?.unix_timestamp >= a.schedule.executable_at, ErrorCode::UpgradeNotDue);
  check_accounts(&a.program.to_account_info(), &a.program_data.to_account_info(), &a.buffer.to_account_info(), &a.upgrade_authority.key())?;
  let ix = bpf_loader_upgradeable::upgrade(&a.program.key(), &a.buffer.key(), &a.upgrade_authority.key(), &a.admin.key());
  let bump = [ctx.bumps.upgrade_authority];
  invoke_signed(
    &ix,
    &[
      a.program_data.to_account_info(),
      a.program.to_account_info(),
      a.buffer.to_account_info(),
      a.admin.to_account_info(),
      a.rent.to_account_info(),
      a.clock.to_account_info(),
      a.upgrade_authority.to_account_info(),
    ],
    &[&[UPGRADE_AUTHORITY_SEED, &bump]],
  )?;
  emit!(UpgradeExecuted { program: a.program.key(), buffer: a.buffer.key() });
  Ok(())
}
