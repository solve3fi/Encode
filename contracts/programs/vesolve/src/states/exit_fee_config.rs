use anchor_lang::prelude::*;

use crate::constants::{EXIT_FEE_BPS, EXIT_FEE_CONFIG_SEED};
use crate::errors::ErrorCode;

/// The exit fee percentage. A separate account from `ExitConfig` so the
/// price account keeps its layout. An account that was never created means
/// the initial `EXIT_FEE_BPS` applies.
///
/// Admin changes never apply to the current epoch: `set_exit_fee_bps` records
/// the new value for the next epoch, and `effective_bps` switches over once
/// the protocol reaches it.
#[account]
#[derive(InitSpace)]
pub struct ExitFeeConfig {
  pub fee_bps: u64,
  pub pending_bps: u64,
  /// First epoch the pending value applies to; 0 = nothing pending.
  pub pending_epoch: u64,
  pub bump: u8,
}

impl ExitFeeConfig {
  pub fn effective_bps(&self, current_epoch: u64) -> u64 {
    if self.pending_epoch != 0 && current_epoch >= self.pending_epoch {
      self.pending_bps
    } else {
      self.fee_bps
    }
  }

  /// The fee in force at `current_epoch` from the raw canonical account, or
  /// the initial default when it was never created.
  pub fn read_effective_bps(info: &AccountInfo, program_id: &Pubkey, current_epoch: u64) -> Result<u64> {
    let (expected, _) = Pubkey::find_program_address(&[EXIT_FEE_CONFIG_SEED], program_id);
    require_keys_eq!(info.key(), expected, ErrorCode::InvalidOwner);
    if info.owner != program_id || info.data_is_empty() {
      return Ok(EXIT_FEE_BPS);
    }
    let data = info.try_borrow_data()?;
    Ok(ExitFeeConfig::try_deserialize(&mut &data[..])?.effective_bps(current_epoch))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn pending_value_applies_only_from_its_epoch() {
    let c = ExitFeeConfig { fee_bps: 4_000, pending_bps: 2_500, pending_epoch: 6, bump: 255 };
    assert_eq!(c.effective_bps(5), 4_000);
    assert_eq!(c.effective_bps(6), 2_500);
    assert_eq!(c.effective_bps(9), 2_500);
  }

  #[test]
  fn nothing_pending_keeps_the_current_value() {
    let c = ExitFeeConfig { fee_bps: 4_000, pending_bps: 0, pending_epoch: 0, bump: 255 };
    assert_eq!(c.effective_bps(0), 4_000);
    assert_eq!(c.effective_bps(100), 4_000);
  }
}
