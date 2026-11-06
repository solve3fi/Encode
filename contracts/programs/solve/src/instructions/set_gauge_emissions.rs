use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{errors::ErrorCode, manager::solve_manager::next_solve_reward_infos, state::Solve};

pub const GAUGE_REWARD_VAULT_SEED: &[u8] = b"gauge_reward_vault";

pub fn gauge_reward_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"protocol"], &pubkey!("HMqzJpD85Z74R1vhor9LWm6KFhK6tYVChzjzyBRyjUmN")).0
}

#[derive(Accounts)]
pub struct SetGaugeEmissions<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    // The PDA can sign only via a CPI from the pinned governance program.
    #[account(address = gauge_reward_authority() @ ErrorCode::InvalidGaugeRewardAuthority)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub solve: Box<Account<'info, Solve>>,
    pub reward_mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = payer,
        seeds = [GAUGE_REWARD_VAULT_SEED, solve.key().as_ref()], bump,
        token::mint = reward_mint, token::authority = solve)]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SetGaugeEmissions>, rate_x64: u128, end_timestamp: u64, gate_phi_ppm: u32) -> Result<()> {
    let now = u64::try_from(Clock::get()?.unix_timestamp).map_err(|_| ErrorCode::InvalidTimestamp)?;
    require!(end_timestamp >= now || rate_x64 == 0, ErrorCode::InvalidTimestamp);
    let duration = end_timestamp.saturating_sub(now) as u128;
    let required_x64 = rate_x64.checked_mul(duration).ok_or(ErrorCode::MultiplicationOverflow)?;
    require!(required_x64 <= (ctx.accounts.reward_vault.amount as u128) << 64,
        ErrorCode::RewardVaultAmountInsufficient);
    let pool = &mut ctx.accounts.solve;
    let rewards = next_solve_reward_infos(pool, now)?;
    pool.update_rewards(rewards, now);
    pool.set_gauge_reward_schedule(ctx.accounts.reward_mint.key(), ctx.accounts.reward_vault.key(), rate_x64, end_timestamp, now, gate_phi_ppm)
}
