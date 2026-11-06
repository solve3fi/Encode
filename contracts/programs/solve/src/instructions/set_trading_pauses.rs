use anchor_lang::prelude::*;

use crate::state::SolvesConfig;

/// Pauses swaps and/or new liquidity for every pool under this config.
/// Signed by the config's fee authority, which `set_fee_authority` can hand
/// over, so the pause key moves with the rest of the DEX administration.
#[derive(Accounts)]
pub struct SetTradingPauses<'info> {
    #[account(mut, has_one = fee_authority)]
    pub solves_config: Account<'info, SolvesConfig>,

    pub fee_authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<SetTradingPauses>,
    swaps_paused: bool,
    liquidity_increases_paused: bool,
) -> Result<()> {
    ctx.accounts
        .solves_config
        .set_trading_pauses(swaps_paused, liquidity_increases_paused);
    Ok(())
}
