use anchor_lang::prelude::*;

use crate::constants::MAX_GAUGE_VOTES;
use crate::states::GaugeVote;

/// Marks a lock as a protocol allocation (Treasury, Team, Advisors, ...) whose
/// votes the Admin casts (rule A10). `owner` is the wallet that held the lock
/// at registration: if the lock is later transferred, Admin voting lapses.
#[account]
#[derive(InitSpace)]
pub struct AllocationVoter {
  pub lock: Pubkey,
  pub owner: Pubkey,
  pub bump: u8,
  /// Standing split (percent per gauge) the public crank applies each epoch.
  #[max_len(MAX_GAUGE_VOTES)]
  pub votes: Vec<GaugeVote>,
  /// Bumped on every Admin change to `votes`.
  pub version: u32,
  /// Epoch + 1 of the last application (0 = never), and the version applied.
  pub applied_epoch_plus_one: u64,
  pub applied_version: u32,
}
