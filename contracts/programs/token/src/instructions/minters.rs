use anchor_lang::prelude::*;

use crate::state::MintConfig;
use crate::errors::ErrorCode;


#[derive(Accounts)]
pub struct Minters<'info> {
    #[account(
      mut,
      constraint = authority.key() == mint_config.authority @ ErrorCode::UnauthorizedMintAccess
    )]
    pub authority: Signer<'info>,

    #[account(
      mut,
      constraint = mint_config.authority == authority.key() @ ErrorCode::UnauthorizedMintAccess
    )]
    pub mint_config: Box<Account<'info, MintConfig>>,

    pub system_program: Program<'info, System>,
}



pub fn add_minter<'info>(ctx: Context<Minters>, minter: Pubkey) -> Result<()> {
    let mint_config = &mut ctx.accounts.mint_config;
    if !mint_config.minters.contains(&minter) {
        mint_config.minters.push(minter);
    }
    Ok(())
}

pub fn remove_minter<'info>(ctx: Context<Minters>, minter: Pubkey) -> Result<()> {
    let mint_config = &mut ctx.accounts.mint_config;
    mint_config.minters.retain(|x| x != &minter);
    Ok(())
}
