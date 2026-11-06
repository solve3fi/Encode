use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ClaimedRewards {
    pub user: Pubkey,
    pub gauge: Pubkey,
    pub epoch: u64,
    pub amount: u64,
    pub last_claim_time: i64,
    pub bump: u8,
}


#[account]
#[derive(InitSpace)]
pub struct ClaimedPoolRewards {
    pub user: Pubkey,
    pub gauge: Pubkey,
    pub epoch: u64,
    pub amount_a: u64,
    pub amount_b: u64,
    pub last_claim_time: i64,
    pub bump: u8,
    /// Each side is claimed on its own, so a token that cannot be paid out
    /// (for example a frozen destination account) never blocks the other.
    pub claimed_a: bool,
    pub claimed_b: bool,
}
