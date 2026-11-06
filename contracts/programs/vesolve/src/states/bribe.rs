use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Bribe {
    pub gauge: Pubkey,
    pub token_mint: Pubkey,
    pub creator: Pubkey,
    pub total_amount: u64,
    pub bump: u8,
}
