use anchor_lang::prelude::*;
use anchor_spl::token::{burn, Burn, Mint, Token, TokenAccount};

use crate::{
    errors::ErrorCode, instructions::set_gauge_emissions::gauge_reward_authority,
    manager::solve_manager::next_solve_reward_infos, state::Solve, util::to_timestamp_u64,
};

/// Burns gauge emissions that streamed while the pool had no liquidity, so the
/// SOLV3 minted for a week ends up equal to what was actually earned. Only the
/// pinned governance program can sign (via CPI), mirroring `set_gauge_emissions`.
#[derive(Accounts)]
pub struct BurnUnearnedGaugeEmissions<'info> {
    #[account(address = gauge_reward_authority() @ ErrorCode::InvalidGaugeRewardAuthority)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub solve: Box<Account<'info, Solve>>,
    #[account(mut)]
    pub reward_mint: Account<'info, Mint>,
    #[account(mut, address = solve.reward_infos[0].vault, constraint = reward_vault.mint == reward_mint.key())]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<BurnUnearnedGaugeEmissions>) -> Result<()> {
    let now = to_timestamp_u64(Clock::get()?.unix_timestamp)?;
    let pool = &mut ctx.accounts.solve;
    require!(pool.has_gauge_reward(), ErrorCode::GaugeRewardManaged);
    require_keys_eq!(pool.reward_infos[0].mint, ctx.accounts.reward_mint.key(), ErrorCode::GaugeRewardManaged);
    let rewards = next_solve_reward_infos(pool, now)?;
    pool.update_rewards(rewards, now);

    let amount = pool.gauge_unearned_whole_tokens();
    if amount == 0 {
        return Ok(());
    }
    require!(ctx.accounts.reward_vault.amount >= amount, ErrorCode::RewardVaultAmountInsufficient);
    pool.record_gauge_unearned_burned(amount);

    let seeds = pool.seeds();
    burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.reward_mint.to_account_info(),
                from: ctx.accounts.reward_vault.to_account_info(),
                authority: pool.to_account_info(),
            },
            &[&seeds],
        ),
        amount,
    )
}
