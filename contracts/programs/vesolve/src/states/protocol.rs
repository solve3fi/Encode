use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Protocol {
  pub admin: Pubkey,
  pub token_mint: Pubkey,
  pub next_nft_token_id: u64,
  pub total_supply: u64,
  pub total_locked: u64,
  pub current_epoch: u64,
  pub last_emission_time: i64,
  pub epoch_start_time: i64,
  pub epoch_reset_time: i64,
  pub bump: u8,
}