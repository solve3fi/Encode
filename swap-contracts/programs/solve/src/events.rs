use anchor_lang::prelude::*;

// Position and liquidity events. The Apache base emits none; these keep the layouts the Quest
// decoder already reads (discriminators are sha256("event:<Name>")). Field order is part of the format.

#[event]
pub struct PositionOpened {
    pub solve: Pubkey,
    pub position: Pubkey,
    pub tick_lower_index: i32,
    pub tick_upper_index: i32,
}

#[event]
pub struct LiquidityIncreased {
    pub solve: Pubkey,
    pub position: Pubkey,
    pub tick_lower_index: i32,
    pub tick_upper_index: i32,
    pub liquidity: u128,
    pub token_a_amount: u64,
    pub token_b_amount: u64,
    pub token_a_transfer_fee: u64,
    pub token_b_transfer_fee: u64,
}

#[event]
pub struct LiquidityDecreased {
    pub solve: Pubkey,
    pub position: Pubkey,
    pub tick_lower_index: i32,
    pub tick_upper_index: i32,
    pub liquidity: u128,
    pub token_a_amount: u64,
    pub token_b_amount: u64,
    pub token_a_transfer_fee: u64,
    pub token_b_transfer_fee: u64,
}
