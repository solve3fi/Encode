use anchor_lang::prelude::*;

use anchor_spl::token_interface::{Mint, TokenInterface};
use anchor_spl::metadata::{
  Metadata,
  CreateMetadataAccountsV3,
  create_metadata_accounts_v3,
  mpl_token_metadata::types::{DataV2, Creator},
};

use crate::state::MintConfig;
use crate::errors::ErrorCode;
use crate::auth::is_admin_key;

#[derive(Accounts)]
#[instruction(
  decimals: u8,
  name: String,
  symbol: String,
  uri: String,
)]
pub struct InitializeMint<'info> {
  // Gate initialization on a hardcoded admin key so that the first caller
  // after deployment cannot front-run initialization and permanently seize
  // mint control. `init` still makes this a one-time instruction; this
  // additionally ensures only a designated admin can be the one to run it.
  #[account(
    mut,
    constraint = is_admin_key(&authority.key()) @ ErrorCode::UnauthorizedInitialization,
  )]
  pub authority: Signer<'info>,

  // Gate initialization on this program's own upgrade authority, rather
  // than any signer, so the first transaction after deployment can't
  // front-run mint-authority control (see audit finding H-07).
  #[account(
    constraint = program.programdata_address()? == Some(program_data.key()) @ ErrorCode::UnauthorizedMintAccess,
  )]
  pub program: Program<'info, crate::program::Token>,

  #[account(
    constraint = program_data.upgrade_authority_address == Some(authority.key()) @ ErrorCode::UnauthorizedMintAccess,
  )]
  pub program_data: Account<'info, ProgramData>,

  #[account(
    init,
    payer = authority,
    mint::decimals = decimals,
    mint::authority = mint.key(),
    mint::freeze_authority = mint.key(),
    seeds = [b"mint"],
    bump
  )]
  pub mint: InterfaceAccount<'info, Mint>,

  #[account(
    init,
    payer = authority,
    space = 8 + MintConfig::INIT_SPACE,
    seeds = [b"mint_config", mint.key().as_ref()],
    bump
  )]
  pub mint_config: Box<Account<'info, MintConfig>>,

  /// CHECK: New Metaplex Account being created
  #[account(mut)]
  pub metadata: UncheckedAccount<'info>,
  
  pub token_metadata_program: Program<'info, Metadata>,
  pub token_program: Interface<'info, TokenInterface>,
  pub system_program: Program<'info, System>,
  pub rent: Sysvar<'info, Rent>,
}


pub fn initialize_mint<'info>(
  ctx: Context<InitializeMint>,
  decimals: u8,
  name: String,
  symbol: String,
  uri: String,
) -> Result<()> {
  require!(decimals <= 9, ErrorCode::InvalidDecimals);
  require!(!name.is_empty() && name.len() <= 32, ErrorCode::InvalidTokenName);
  require!(!symbol.is_empty() && symbol.len() <= 10, ErrorCode::InvalidTokenSymbol);
  require!(!uri.is_empty() && uri.len() <= 200, ErrorCode::InvalidTokenUri);


  let mint_config = &mut ctx.accounts.mint_config;
  let authority = &ctx.accounts.authority;

  mint_config.authority = authority.key();
  mint_config.bump = ctx.bumps.mint_config;
  mint_config.minters = Default::default();
  mint_config.minted = 0;
  

  let signer_seeds: &[&[&[u8]]] = &[&[b"mint", &[ctx.bumps.mint]]];
  
  let metadata_data = DataV2 {
    name: name.clone(),
    symbol: symbol.clone(),
    uri: uri.clone(),
    seller_fee_basis_points: 0,
    creators: Some(vec![Creator {
      address: authority.key(),
      verified: false,
      share: 100,
    }]),
    collection: None,
    uses: None,
  };

  let create_metadata_cpi = CreateMetadataAccountsV3 {
    metadata: ctx.accounts.metadata.to_account_info(),
    mint: ctx.accounts.mint.to_account_info(),
    mint_authority: ctx.accounts.mint.to_account_info(),
    update_authority: ctx.accounts.mint.to_account_info(),
    payer: ctx.accounts.authority.to_account_info(),
    system_program: ctx.accounts.system_program.to_account_info(),
    rent: ctx.accounts.rent.to_account_info(),
  };

  let metadata_ctx = CpiContext::new_with_signer(
      ctx.accounts.token_metadata_program.to_account_info(),
      create_metadata_cpi,
      signer_seeds,
  );

  create_metadata_accounts_v3(
      metadata_ctx,
      metadata_data,
      true,
      true,
      None,
  )?;

  msg!("Token initialized: {} ({}) with {} decimals", name, symbol, decimals);
  Ok(())
}
