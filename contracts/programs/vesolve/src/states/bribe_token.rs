use anchor_lang::prelude::*;

use crate::constants::BRIBE_TOKEN_SEED;
use crate::errors::ErrorCode;

/// Admin-managed policy for one bribe reward token (Full Launch rule A12).
///
/// `allowed` gates NEW deposits only. Delisting a token (allowed = false)
/// never touches obligations already created: claims keep working. `paused`
/// is the per-token emergency switch: it blocks new deposits and claims of
/// this one token without freezing any other reward.
#[account]
#[derive(InitSpace)]
pub struct BribeToken {
  pub mint: Pubkey,
  pub allowed: bool,
  pub paused: bool,
  pub updated_at: i64,
  pub bump: u8,
}

impl BribeToken {
  /// New deposits need the token whitelisted and not paused.
  pub fn accepts_deposits(&self) -> bool {
    self.allowed && !self.paused
  }

  /// Claim-side check for a token whose policy account may never have been
  /// created (tokens deposited before the whitelist existed, or never listed).
  /// An absent account means "never paused", so existing obligations are not
  /// stranded. A present account must be the canonical PDA for this mint.
  pub fn is_paused_for_claims(
    info: &AccountInfo,
    mint: &Pubkey,
    program_id: &Pubkey,
  ) -> Result<bool> {
    let (expected, _) = Pubkey::find_program_address(&[BRIBE_TOKEN_SEED, mint.as_ref()], program_id);
    require_keys_eq!(info.key(), expected, ErrorCode::InvalidMint);
    if info.owner != program_id || info.data_is_empty() {
      return Ok(false);
    }
    let data = info.try_borrow_data()?;
    let policy = BribeToken::try_deserialize(&mut &data[..])?;
    Ok(policy.paused)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn token(allowed: bool, paused: bool) -> BribeToken {
    BribeToken { mint: Pubkey::new_unique(), allowed, paused, updated_at: 0, bump: 255 }
  }

  #[test]
  fn deposits_need_whitelisted_and_unpaused() {
    assert!(token(true, false).accepts_deposits());
    assert!(!token(false, false).accepts_deposits());
    assert!(!token(true, true).accepts_deposits());
    assert!(!token(false, true).accepts_deposits());
  }

  fn run_claim_check(owner: Pubkey, program_id: Pubkey, policy: Option<BribeToken>) -> bool {
    let mint = Pubkey::new_unique();
    let (key, _) = Pubkey::find_program_address(&[BRIBE_TOKEN_SEED, mint.as_ref()], &program_id);
    let mut lamports = 1u64;
    let mut data: Vec<u8> = match policy {
      Some(mut p) => {
        p.mint = mint;
        let mut buf = BribeToken::DISCRIMINATOR.to_vec();
        p.serialize(&mut buf).unwrap();
        buf
      }
      None => vec![],
    };
    let info = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &owner, false, 0);
    BribeToken::is_paused_for_claims(&info, &mint, &program_id).unwrap()
  }

  #[test]
  fn claims_ignore_unconfigured_tokens_and_respect_pause() {
    let program_id = Pubkey::new_unique();
    // Never configured: system-owned, empty. Claims must stay open.
    assert!(!run_claim_check(anchor_lang::system_program::ID, program_id, None));
    // Delisted but not paused: obligations remain claimable.
    assert!(!run_claim_check(program_id, program_id, Some(token(false, false))));
    // Paused: that token's claims stop.
    assert!(run_claim_check(program_id, program_id, Some(token(true, true))));
  }

  #[test]
  fn claim_check_rejects_a_non_canonical_account() {
    let program_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let wrong = Pubkey::new_unique();
    let mut lamports = 1u64;
    let mut data = vec![];
    let owner = anchor_lang::system_program::ID;
    let info = AccountInfo::new(&wrong, false, false, &mut lamports, &mut data, &owner, false, 0);
    assert!(BribeToken::is_paused_for_claims(&info, &mint, &program_id).is_err());
  }
}
