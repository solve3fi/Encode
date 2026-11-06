use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{set_authority, spl_token_2022::instruction::AuthorityType, Mint, MintTo, SetAuthority, TokenAccount, TokenInterface, mint_to};

use crate::state::{genesis_supply_base_units, MintConfig};
use crate::errors::ErrorCode;

#[derive(Accounts)]
pub struct MintTokens<'info> {
  #[account(
    mut,
    constraint = mint_config.is_minter(&authority.key(), &instructions_sysvar.to_account_info()) @ ErrorCode::UnauthorizedMintAccess
  )]
  pub authority: Signer<'info>,

  #[account(
    mut,
    seeds = [b"mint"],
    bump,
  )]
  pub mint: InterfaceAccount<'info, Mint>,

  #[account(mut)]
  pub mint_config: Box<Account<'info, MintConfig>>,

  #[account(
    mut,
    constraint = token_account.mint == mint.key() @ ErrorCode::InvalidTokenAccount,
  )]
  pub token_account: InterfaceAccount<'info, TokenAccount>,

  /// CHECK: Instructions sysvar for CPI detection
  #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
  pub instructions_sysvar: UncheckedAccount<'info>,
  
  pub token_program: Interface<'info, TokenInterface>,
  pub system_program: Program<'info, System>,
  pub associated_token_program: Program<'info, AssociatedToken>,
}


pub fn mint_tokens<'info>(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
  require!(amount > 0, ErrorCode::InvalidMintAmount);

  // No arbitrary minting (B1): everything minted here, by anyone, counts
  // against the genesis supply.
  let cap = genesis_supply_base_units(ctx.accounts.mint.decimals).ok_or(ErrorCode::GenesisSupplyExceeded)?;
  let minted = ctx.accounts.mint_config.minted.checked_add(amount).ok_or(ErrorCode::GenesisSupplyExceeded)?;
  require!(minted <= cap, ErrorCode::GenesisSupplyExceeded);
  ctx.accounts.mint_config.minted = minted;
  
  let token_account = &ctx.accounts.token_account;
  let signer_seeds: &[&[&[u8]]] = &[&[b"mint", &[ctx.bumps.mint]]];
  
  let cpi_accounts = MintTo {
    mint: ctx.accounts.mint.to_account_info(),
    to: token_account.to_account_info(),
    authority: ctx.accounts.mint.to_account_info(),
  };
  
  let cpi_program = ctx.accounts.token_program.to_account_info();
  let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
  mint_to(cpi_ctx, amount)?;

  msg!("Minted {} tokens to {} by authority {}", amount, token_account.key(), ctx.accounts.authority.key());

  Ok(())
}

/// Hands the mint authority to another address (the vesolve Protocol PDA once
/// genesis is minted). After this, nothing minted through this program can
/// happen and emissions are controlled by the new authority.
#[derive(Accounts)]
pub struct TransferMintAuthority<'info> {
  #[account(mut, constraint = authority.key() == mint_config.authority @ ErrorCode::UnauthorizedAuthority)]
  pub authority: Signer<'info>,

  #[account(mut, seeds = [b"mint"], bump)]
  pub mint: InterfaceAccount<'info, Mint>,

  #[account(seeds = [b"mint_config", mint.key().as_ref()], bump = mint_config.bump)]
  pub mint_config: Box<Account<'info, MintConfig>>,

  pub token_program: Interface<'info, TokenInterface>,
}

pub fn transfer_mint_authority(ctx: Context<TransferMintAuthority>, new_authority: Pubkey) -> Result<()> {
  let signer_seeds: &[&[&[u8]]] = &[&[b"mint", &[ctx.bumps.mint]]];
  let cpi = CpiContext::new_with_signer(
    ctx.accounts.token_program.to_account_info(),
    SetAuthority { current_authority: ctx.accounts.mint.to_account_info(), account_or_mint: ctx.accounts.mint.to_account_info() },
    signer_seeds,
  );
  set_authority(cpi, AuthorityType::MintTokens, Some(new_authority))
}

/// Removes the SOLV3 mint's freeze authority for good (review L-1), so no holder's tokens can ever be frozen
/// and wallets stop flagging the token. Signed by the mint config authority; one-way.
#[derive(Accounts)]
pub struct RevokeFreezeAuthority<'info> {
  #[account(constraint = authority.key() == mint_config.authority @ ErrorCode::UnauthorizedAuthority)]
  pub authority: Signer<'info>,

  #[account(mut, seeds = [b"mint"], bump)]
  pub mint: InterfaceAccount<'info, Mint>,

  #[account(seeds = [b"mint_config", mint.key().as_ref()], bump = mint_config.bump)]
  pub mint_config: Box<Account<'info, MintConfig>>,

  pub token_program: Interface<'info, TokenInterface>,
}

pub fn revoke_freeze_authority(ctx: Context<RevokeFreezeAuthority>) -> Result<()> {
  let signer_seeds: &[&[&[u8]]] = &[&[b"mint", &[ctx.bumps.mint]]];
  let cpi = CpiContext::new_with_signer(
    ctx.accounts.token_program.to_account_info(),
    SetAuthority { current_authority: ctx.accounts.mint.to_account_info(), account_or_mint: ctx.accounts.mint.to_account_info() },
    signer_seeds,
  );
  set_authority(cpi, AuthorityType::FreezeAccount, None)
}
