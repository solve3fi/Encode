use anchor_lang::prelude::*;

/// A Treasury change waiting for its delay (review H-1). `set_treasury` writes it; anyone can apply it once
/// `executable_at` has passed; the Admin can cancel it before then.
#[account]
#[derive(InitSpace)]
pub struct TreasuryChange {
  pub treasury: Pubkey,
  pub executable_at: i64,
  pub bump: u8,
}

/// Narrow operational role the Admin assigns (review H-2): the price keeper may nudge the exit price within
/// the per-update bounds and nothing else. Everything else the keeper does is permissionless.
#[account]
#[derive(InitSpace)]
pub struct KeeperConfig {
  pub keeper: Pubkey,
  pub bump: u8,
}

impl KeeperConfig {
  /// The configured keeper, or None when the account was never created.
  pub fn read(info: &AccountInfo, program_id: &Pubkey) -> Result<Option<Pubkey>> {
    let (expected, _) = Pubkey::find_program_address(&[crate::constants::KEEPER_CONFIG_SEED], program_id);
    require_keys_eq!(info.key(), expected, crate::errors::ErrorCode::InvalidOwner);
    if info.owner != program_id || info.data_is_empty() {
      return Ok(None);
    }
    Ok(Some(KeeperConfig::try_deserialize(&mut &info.try_borrow_data()?[..])?.keeper))
  }
}
