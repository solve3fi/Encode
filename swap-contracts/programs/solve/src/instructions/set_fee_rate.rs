use anchor_lang::prelude::*;

use crate::state::{Solve, SolvesConfig};

#[derive(Accounts)]
pub struct SetFeeRate<'info> {
    pub solves_config: Account<'info, SolvesConfig>,

    #[account(mut, has_one = solves_config)]
    pub solve: Account<'info, Solve>,

    #[account(address = solves_config.fee_authority)]
    pub fee_authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetFeeRate>, fee_rate: u16) -> Result<()> {
    ctx.accounts.solve.update_fee_rate(fee_rate)
}
