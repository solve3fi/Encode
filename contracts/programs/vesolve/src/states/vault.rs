use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct VaultData {
  pub admin: Pubkey,
  pub gauge: Pubkey,
  /// Emission rewards deposited via `distribute_reward` for this epoch/gauge.
  pub rewards: u64,
  // Snapshot of deposited pool-fee amounts, kept in fields separate from
  // `rewards` (emissions) so distribute_reward and distribute_pool_reward
  // no longer clobber each other's accounting (see audit finding M-01),
  // and claim_pool_reward can size payouts from this fixed snapshot
  // instead of the live, depleting vault balance (see audit finding M-02).
  pub pool_rewards_a: u64,
  pub pool_rewards_b: u64,
  pub epoch: u64,
  pub bump: u8,
}