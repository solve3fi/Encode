use anchor_lang::prelude::*;

use crate::state::SolvesConfig;

#[derive(Accounts)]
pub struct SetFeeAuthority<'info> {
    #[account(mut)]
    pub solves_config: Account<'info, SolvesConfig>,

    #[account(address = solves_config.fee_authority)]
    pub fee_authority: Signer<'info>,

    /// CHECK: safe, the account that will be new authority can be arbitrary
    pub new_fee_authority: UncheckedAccount<'info>,
}

/// Set the fee authority. Only the current fee authority has permission to invoke this instruction.
pub fn handler(ctx: Context<SetFeeAuthority>) -> Result<()> {
    ctx.accounts
        .solves_config
        .update_fee_authority(ctx.accounts.new_fee_authority.key());
    Ok(())
}
