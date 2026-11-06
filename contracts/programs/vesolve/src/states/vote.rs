use anchor_lang::prelude::*;

use crate::constants::MAX_GAUGE_VOTES;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct GaugeVote {
    pub gauge: Pubkey,
    pub weight: u64, // Percentage of voting power (0-100 for 0-100%)
}

#[account]
#[derive(InitSpace)]
pub struct UserVote {
    pub user: Pubkey,
    pub epoch: u64,
    pub total_voting_power: u64,
    #[max_len(MAX_GAUGE_VOTES)]
    pub votes: Vec<GaugeVote>,
    pub last_vote_time: i64,
    pub bump: u8,
}

/// Which lock produced a vote. UserVote is keyed by (lock, epoch), so each
/// lock has its own vote and one lock's vote never replaces another's. The
/// claim instructions still take this record, and check it against the lock
/// they were given, so the auto-vote fee can only be avoided by claiming with
/// the very lock that voted (which is the lock the fee is looked up on).
#[account]
#[derive(InitSpace)]
pub struct VoteLockRecord {
    pub user: Pubkey,
    pub epoch: u64,
    pub lock: Pubkey,
    pub ve_token_id: u64,
    pub bump: u8,
}