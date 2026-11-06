use anchor_lang::prelude::*;

/// The SOLV3 price the exit fee is charged against.
///
/// This is a separate account rather than a field on `Protocol` on purpose:
/// the deployed Protocol account was allocated at `8 + Protocol::INIT_SPACE`,
/// so growing that struct would make every instruction that touches it fail
/// to deserialize, and a migration couldn't load the account to repair it.
///
/// The rate is administrator-published, not an oracle reading. SOLV3 has no
/// price feed and its pools carry no liquidity, so there is nothing on-chain
/// to derive a market price from.
#[account]
#[derive(InitSpace)]
pub struct ExitConfig {
  /// Lamports per whole SOLV3 (not per base unit).
  pub lamports_per_solv3: u64,
  pub updated_at: i64,
  pub updated_by: Pubkey,
  pub bump: u8,
}
