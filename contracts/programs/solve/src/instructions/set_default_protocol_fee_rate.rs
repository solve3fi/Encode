use anchor_lang::prelude::*;

use crate::state::SolvesConfig;

#[derive(Accounts)]
pub struct SetDefaultProtocolFeeRate<'info> {
    #[account(mut)]
    pub solves_config: Account<'info, SolvesConfig>,

    #[account(address = solves_config.fee_authority)]
    pub fee_authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<SetDefaultProtocolFeeRate>,
    default_protocol_fee_rate: u16,
) -> Result<()> {
    ctx.accounts
        .solves_config
        .update_default_protocol_fee_rate(default_protocol_fee_rate)
}
