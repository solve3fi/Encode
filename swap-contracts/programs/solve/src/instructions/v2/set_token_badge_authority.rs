use anchor_lang::prelude::*;

use crate::state::{SolvesConfig, SolvesConfigExtension};

#[derive(Accounts)]
pub struct SetTokenBadgeAuthority<'info> {
    pub solves_config: Box<Account<'info, SolvesConfig>>,

    #[account(mut, has_one = solves_config)]
    pub solves_config_extension: Account<'info, SolvesConfigExtension>,

    #[account(address = solves_config_extension.config_extension_authority)]
    pub config_extension_authority: Signer<'info>,

    /// CHECK: safe, the account that will be new authority can be arbitrary
    pub new_token_badge_authority: UncheckedAccount<'info>,
}

/// Set the token badge authority. Only the config extension authority has permission to invoke this instruction.
pub fn handler(ctx: Context<SetTokenBadgeAuthority>) -> Result<()> {
    ctx.accounts
        .solves_config_extension
        .update_token_badge_authority(ctx.accounts.new_token_badge_authority.key());
    Ok(())
}
