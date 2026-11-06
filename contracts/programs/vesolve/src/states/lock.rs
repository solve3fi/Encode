use anchor_lang::prelude::*;

use crate::errors::ErrorCode;

#[account]
#[derive(InitSpace)]
pub struct Lock {
  pub owner: Pubkey,
  pub ve_token_id: u64,
  pub ve_mint: Pubkey,
  pub amount: u64,
  pub unlock_time: i64,
  pub voting_power: u64,
  pub last_vote_epoch: u64,
  pub bump: u8,
}


impl Lock {
  /// Permanent locks always have one unit of voting power per locked token.
  ///
  /// `current_time` remains in the signature for instruction compatibility,
  /// but time never reduces a lock's voting power.
  pub fn calculate_voting_power(&self, _current_time: i64) -> u64 {
    self.amount
  }


  pub fn calculate_split_power(&self, split_amount: u64) -> Result<u64> {
    require!(split_amount > 0, ErrorCode::InvalidAmount);
    require!(split_amount < self.amount, ErrorCode::InvalidAmount);

    // The split lock preserves the same 1:1 SOLV3-to-veSOLV3 invariant.
    Ok(split_amount)
  }

  /// Permanent locks never expire on their own; exit_lock is the only way
  /// out, and it explicitly closes the lock after collecting the configured
  /// SOL fee.
  pub fn is_expired(&self, _current_time: i64) -> bool {
    false
  }

  pub fn can_merge_with(&self, other: &Lock, _current_time: i64) -> bool {
    self.owner == other.owner
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn permanent_lock(amount: u64) -> Lock {
    Lock {
      owner: Pubkey::new_unique(),
      ve_token_id: 1,
      ve_mint: Pubkey::new_unique(),
      amount,
      unlock_time: i64::MAX,
      voting_power: amount,
      last_vote_epoch: 0,
      bump: 255,
    }
  }

  #[test]
  fn voting_power_is_one_to_one_at_every_time() {
    let lock = permanent_lock(1_000);

    assert_eq!(lock.calculate_voting_power(0), 1_000);
    assert_eq!(lock.calculate_voting_power(1_000_000_000), 1_000);
    assert_eq!(lock.calculate_voting_power(i64::MAX), 1_000);
    assert_eq!(lock.calculate_split_power(400).unwrap(), 400);
  }

  #[test]
  fn permanent_lock_never_expires() {
    let lock = permanent_lock(1_000);

    assert!(!lock.is_expired(0));
    assert!(!lock.is_expired(i64::MAX));
  }

  #[test]
  fn split_rejects_zero_and_full_amount() {
    let lock = permanent_lock(1_000_000);
    assert!(lock.calculate_split_power(0).is_err());
    assert!(lock.calculate_split_power(1_000_000).is_err());
  }
}
