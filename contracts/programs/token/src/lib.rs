use anchor_lang::prelude::*;

declare_id!("CKRSmDf3n1ZsAc91YyRyCwWLoNShZ4xi2nWESMbDw7Pw");

pub mod state;
pub mod errors;
pub mod instructions;
pub mod security;
pub mod auth;

use instructions::*;

#[program]
pub mod token {
    use super::*;

    pub fn initialize_mint(ctx: Context<InitializeMint>, decimals: u8, name: String, symbol: String, uri: String) -> Result<()> {
        instructions::initialize_mint::initialize_mint(ctx, decimals, name, symbol, uri)
    }

    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        instructions::mint_tokens::mint_tokens(ctx, amount)
    }

    pub fn transfer_mint_authority(ctx: Context<TransferMintAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::mint_tokens::transfer_mint_authority(ctx, new_authority)
    }

    pub fn revoke_freeze_authority(ctx: Context<RevokeFreezeAuthority>) -> Result<()> {
        instructions::mint_tokens::revoke_freeze_authority(ctx)
    }

    pub fn add_minter(ctx: Context<Minters>, minter: Pubkey) -> Result<()> {
        instructions::minters::add_minter(ctx, minter)
    }

    pub fn remove_minter(ctx: Context<Minters>, minter: Pubkey) -> Result<()> {
        instructions::minters::remove_minter(ctx, minter)
    }
}