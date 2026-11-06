use anchor_lang::prelude::*;

/// Marks a lock as enrolled in the public Auto-Vote program. Presence of
/// this account (at its canonical PDA, seeded by the lock) is what
/// authorizes AUTO_VOTE_KEEPER to cast votes on the lock's behalf (see
/// instructions/vote.rs) and is what charges AUTO_VOTE_FEE_BPS on the
/// lock's voting rewards to the protocol treasury instead of paying them
/// out in full (see claim_bribe_reward.rs / claim_pool_reward.rs).
///
/// A separate PDA rather than a Lock field for the same reason ExitConfig
/// is separate from Protocol -- Lock is already deployed at a fixed size,
/// so growing it would break every instruction that deserializes it.
#[account]
#[derive(InitSpace)]
pub struct AutoVoteEnrollment {
  pub lock: Pubkey,
  pub owner: Pubkey,
  pub enrolled_at: i64,
  pub bump: u8,
}

/// A wallet registered to cast votes for enrolled locks whose owners choose it (DEV-12). Anyone may register;
/// registering gives no power by itself -- a lock owner must pick this voter with set_auto_voter. The auto-vote
/// fee is unchanged: AUTO_VOTE_FEE_BPS of an enrolled lock's voting rewards goes to the protocol whichever
/// voter casts its votes.
#[account]
#[derive(InitSpace)]
pub struct AutoVoter {
  pub authority: Pubkey,
  pub registered_at: i64,
  pub bump: u8,
}

/// A lock owner's choice of registered auto-voter for an enrolled lock. While it exists (and is newer than the
/// lock's current enrollment), only that voter may auto-vote the lock and the Solve3 keeper is refused. Closing
/// it (clear_auto_voter) hands the lock back to the Solve3 keeper.
#[account]
#[derive(InitSpace)]
pub struct AutoVoteDelegate {
  pub lock: Pubkey,
  pub voter: Pubkey,
  pub set_at: i64,
  pub bump: u8,
}

/// Admin-flagged partner voter. A lock voted by this wallet pays no AUTO_VOTE_FEE_BPS when it claims; every other
/// auto-voter (including the Solve3 keeper) still charges the standard fee. A separate PDA keyed by the voter's
/// wallet, so no existing account layout changes.
#[account]
#[derive(InitSpace)]
pub struct PartnerVoter {
  pub voter: Pubkey,
  pub added_at: i64,
  pub bump: u8,
}

impl PartnerVoter {
  /// Whether `voter` is a flagged partner, from the optional PartnerVoter account a claim passes as its first
  /// remaining account. Leaving it out is allowed (the fee is then charged); passing anything but the voter's own
  /// PartnerVoter PDA is refused, so the flag cannot be faked. Only the lock's owner can claim, so omitting it
  /// can only cost the claimer.
  pub fn is_exempt(remaining: &[AccountInfo], voter: &Pubkey, program_id: &Pubkey) -> Result<bool> {
    let Some(info) = remaining.first() else { return Ok(false) };
    let (expected, _) = Pubkey::find_program_address(&[crate::constants::PARTNER_VOTER_SEED, voter.as_ref()], program_id);
    require_keys_eq!(info.key(), expected, crate::errors::ErrorCode::InvalidOwner);
    if info.owner != program_id || info.data_is_empty() {
      return Ok(false);
    }
    let flagged = PartnerVoter::try_deserialize(&mut &info.try_borrow_data()?[..])?;
    Ok(flagged.voter == *voter)
  }
}
