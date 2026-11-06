use anchor_lang::prelude::*;

/// Lifecycle of a gauge (spec section 4, INVARIANTS 1.2):
/// CREATED -> PENDING_ACTIVATION -> ACTIVE -> PENDING_REMOVAL -> REMOVED.
/// A pending change applies from `effective_epoch` (the next rollover after
/// it was requested); `configure_native_gauge` executes it. REMOVED is
/// terminal for that run of the gauge: relisting the pool starts a new
/// generation (REMOVED -> PENDING_ACTIVATION, `generation` + 1) and every
/// obligation of the old run stays keyed by its own epoch.
pub const GAUGE_CREATED: u8 = 0;
pub const GAUGE_PENDING_ACTIVATION: u8 = 1;
pub const GAUGE_ACTIVE: u8 = 2;
pub const GAUGE_PENDING_REMOVAL: u8 = 3;
pub const GAUGE_REMOVED: u8 = 4;

#[account]
#[derive(InitSpace)]
pub struct Gauge {
  pub pool_address: Pubkey,
  pub token_mint_a: Pubkey,
  pub token_mint_b: Pubkey,
  pub fee_tier: u16,
  /// True while the gauge routes fees and streams emissions: ACTIVE and
  /// PENDING_REMOVAL. Set only by `configure_native_gauge`.
  pub is_active: bool,
  pub bump: u8,
  pub status: u8,
  /// First epoch the pending change applies to (0 when none is pending).
  pub effective_epoch: u64,
  /// How many times this pool's gauge has been (re)listed.
  pub generation: u16,
}

impl Gauge {
  /// Votes may target a gauge that is pending activation (they set its first
  /// emission) or active. A gauge pending removal takes no new votes.
  pub fn accepts_votes(&self) -> bool {
    self.status == GAUGE_PENDING_ACTIVATION || self.status == GAUGE_ACTIVE
  }

  /// New bribes only for an active gauge; they stop when removal is requested.
  pub fn accepts_bribes(&self) -> bool {
    self.status == GAUGE_ACTIVE
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn gauge(status: u8) -> Gauge {
    Gauge {
      pool_address: Pubkey::default(),
      token_mint_a: Pubkey::default(),
      token_mint_b: Pubkey::default(),
      fee_tier: 0,
      is_active: false,
      bump: 255,
      status,
      effective_epoch: 0,
      generation: 0,
    }
  }

  #[test]
  fn votes_and_bribes_follow_the_lifecycle_table() {
    let rows = [
      (GAUGE_CREATED, false, false),
      (GAUGE_PENDING_ACTIVATION, true, false),
      (GAUGE_ACTIVE, true, true),
      (GAUGE_PENDING_REMOVAL, false, false),
      (GAUGE_REMOVED, false, false),
    ];
    for (status, votes, bribes) in rows {
      assert_eq!(gauge(status).accepts_votes(), votes, "votes at status {status}");
      assert_eq!(gauge(status).accepts_bribes(), bribes, "bribes at status {status}");
    }
  }
}
