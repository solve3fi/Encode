use anchor_lang::prelude::*;

use crate::constants::{MAX_BRIBE_WEIGHT, MAX_VOTE_WEIGHT};

#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub epoch: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub total_voting_power: u64,
    pub total_votes: u64,
    #[max_len(MAX_VOTE_WEIGHT)]
    pub gauge_weights: Vec<GaugeWeight>,
    // Was #[max_len(MAX_VOTE_WEIGHT)] (100) — a defined-but-unused
    // MAX_BRIBE_WEIGHT constant existed for exactly this field and was
    // never applied. At 100 entries the account's total INIT_SPACE exceeds
    // Solana's 10,240-byte single-CPI account-creation limit, making
    // update_epoch fail with "Failed to reallocate account data" for
    // every caller — i.e. no epoch, and therefore no vote/reward cycle,
    // could ever be created against this program as originally deployed.
    #[max_len(MAX_BRIBE_WEIGHT)]
    pub bribes: Vec<BribeWeight>,
    pub bump: u8,
}


#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct GaugeWeight {
    pub gauge: Pubkey,
    pub weight: u64,
    pub votes: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct BribeWeight {
    pub gauge: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
}


impl Epoch {
    /// Voting rewards earned in epoch N become claimable when epoch N+1 begins, that is, as soon as the voting epoch
    /// has ended. Bribes and routed fees are tied to the current epoch, so epoch N's reward pot cannot change once
    /// N+1 has begun. (This was N+2 until the 2026-10-13 decision to shorten the voter reward delay.)
    pub fn voting_rewards_claimable(&self, current_epoch: u64) -> bool {
        self.epoch
            .checked_add(1)
            .is_some_and(|claim_epoch| current_epoch >= claim_epoch)
    }

    pub fn update_total_power(&mut self) {
        self.total_voting_power = self.gauge_weights.iter().map(|gauge_weight| gauge_weight.weight).sum();
    }

    pub fn update_total_votes(&mut self) {
        self.total_votes = self.gauge_weights.iter().map(|gauge_weight| gauge_weight.votes).sum();
    }   
}

#[cfg(test)]
mod tests {
    use super::Epoch;

    fn epoch(number: u64) -> Epoch {
        Epoch {
            epoch: number,
            start_time: 0,
            end_time: 0,
            total_voting_power: 0,
            total_votes: 0,
            gauge_weights: vec![],
            bribes: vec![],
            bump: 0,
        }
    }

    #[test]
    fn voting_rewards_unlock_when_the_next_epoch_begins() {
        let voting_epoch = epoch(5);

        assert!(!voting_epoch.voting_rewards_claimable(5));
        assert!(voting_epoch.voting_rewards_claimable(6));
        assert!(voting_epoch.voting_rewards_claimable(7));
        assert!(voting_epoch.voting_rewards_claimable(8));
    }

    #[test]
    fn voting_rewards_epoch_overflow_is_not_claimable() {
        assert!(!epoch(u64::MAX).voting_rewards_claimable(u64::MAX));
    }
}
