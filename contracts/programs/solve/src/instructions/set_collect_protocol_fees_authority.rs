use anchor_lang::prelude::*;

use crate::state::SolvesConfig;

#[derive(Accounts)]
pub struct SetCollectProtocolFeesAuthority<'info> {
    #[account(mut)]
    pub solves_config: Account<'info, SolvesConfig>,

    #[account(address = solves_config.collect_protocol_fees_authority)]
    pub collect_protocol_fees_authority: Signer<'info>,

    /// CHECK: safe, the account that will be new authority can be arbitrary
    pub new_collect_protocol_fees_authority: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<SetCollectProtocolFeesAuthority>) -> Result<()> {
    ctx.accounts
        .solves_config
        .update_collect_protocol_fees_authority(
            ctx.accounts.new_collect_protocol_fees_authority.key(),
        );
    Ok(())
}
