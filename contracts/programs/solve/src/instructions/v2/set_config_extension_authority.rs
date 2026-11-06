use anchor_lang::prelude::*;

use crate::state::{SolvesConfig, SolvesConfigExtension};

#[derive(Accounts)]
pub struct SetConfigExtensionAuthority<'info> {
    pub solves_config: Box<Account<'info, SolvesConfig>>,

    #[account(mut, has_one = solves_config)]
    pub solves_config_extension: Account<'info, SolvesConfigExtension>,

    #[account(address = solves_config_extension.config_extension_authority)]
    pub config_extension_authority: Signer<'info>,

    /// CHECK: safe, the account that will be new authority can be arbitrary
    pub new_config_extension_authority: UncheckedAccount<'info>,
}

/// Set the config extension authority. Only the current config extension authority has permission to invoke this instruction.
pub fn handler(ctx: Context<SetConfigExtensionAuthority>) -> Result<()> {
    ctx.accounts
        .solves_config_extension
        .update_config_extension_authority(ctx.accounts.new_config_extension_authority.key());
    Ok(())
}
