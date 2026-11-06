use anchor_lang::prelude::*;

/// A program upgrade waiting out its timelock. One per target program; closed
/// when the upgrade is executed or cancelled.
#[account]
#[derive(InitSpace)]
pub struct UpgradeSchedule {
  pub program: Pubkey,
  pub buffer: Pubkey,
  pub scheduled_at: i64,
  pub executable_at: i64,
  pub bump: u8,
}
