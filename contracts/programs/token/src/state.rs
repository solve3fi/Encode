use anchor_lang::{prelude::*, solana_program};

#[account]
#[derive(InitSpace)]
pub struct MintConfig {
  pub authority: Pubkey,
  #[max_len(10)]
  pub minters: Vec<Pubkey>,
  /// Base units minted through this program. Capped at the genesis supply.
  pub minted: u64,
  pub bump: u8,
}

/// Genesis supply in whole tokens (rule B1). Later emissions are minted by the
/// vesolve Protocol PDA after the mint authority is handed over, not here.
pub const GENESIS_SUPPLY_TOKENS: u64 = 100_000_000;

/// The most that may ever be minted through `mint_tokens`, in base units.
pub fn genesis_supply_base_units(decimals: u8) -> Option<u64> {
  GENESIS_SUPPLY_TOKENS.checked_mul(10u64.checked_pow(decimals as u32)?)
}

#[cfg(test)]
mod supply_tests {
  use super::*;

  #[test]
  fn genesis_supply_is_100_million_whole_tokens() {
    assert_eq!(genesis_supply_base_units(9), Some(100_000_000_000_000_000));
    assert_eq!(genesis_supply_base_units(6), Some(100_000_000_000_000));
    assert_eq!(genesis_supply_base_units(0), Some(100_000_000));
  }
}


impl <'info> MintConfig {
  // get_instruction_relative(0, ...) reads the current *top-level*
  // transaction instruction, not the immediate CPI caller -- for a direct,
  // single-hop CPI into mint_tokens the two coincide, but a deeper CPI
  // chain (A calls B calls mint_tokens) would resolve to A, not B. Callers
  // relying on this for a multi-hop authorization chain should not.
  pub fn is_minter(&self, authority: &Pubkey, instructions_sysvar: &AccountInfo<'info>) -> bool {
    if self.authority == *authority {
      return true;
    }
    // A sysvar read failure must deny, not panic -- an unwrap() here would
    // let a malformed instructions sysvar account halt the whole
    // transaction with an unrecoverable runtime panic instead of a clean
    // program error.
    solana_program::sysvar::instructions::get_instruction_relative(0, instructions_sysvar)
      .is_ok_and(|instruction| self.minters.contains(&instruction.program_id))
  }
}
