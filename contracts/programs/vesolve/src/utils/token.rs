use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::spl_token_2022::instruction::{
  freeze_account as build_freeze_account_ix, thaw_account as build_thaw_account_ix, AuthorityType,
};
use anchor_spl::token_interface::{Mint, MintTo, TokenAccount, TransferChecked, TokenInterface, BurnChecked, CloseAccount, SetAuthority, mint_to, transfer_checked, burn_checked, close_account, set_authority};
use anchor_spl::metadata::{
  Metadata,
  CreateMetadataAccountsV3,
  create_metadata_accounts_v3,
  mpl_token_metadata::types::{DataV2, Creator},
};

use crate::constants::{PROTOCOL_SEED, VE_TOKEN_SEED};
use crate::states::Protocol;
use crate::constants::nft::{VE_METADATA_NAME, VE_METADATA_SYMBOL, VE_METADATA_URI};


pub fn transfer_token_to_protocol<'info>(
  authority: &Signer<'info>,
  token_mint: &InterfaceAccount<'info, Mint>,
  token_account: &InterfaceAccount<'info, TokenAccount>,
  protocol_token_account: &InterfaceAccount<'info, TokenAccount>,
  token_program: &Interface<'info, TokenInterface>,
  amount: u64,
) -> Result<()> {

 let cpi_accounts = TransferChecked {
    from: token_account.to_account_info(),
    mint: token_mint.to_account_info(),
    to: protocol_token_account.to_account_info(),
    authority: authority.to_account_info(),
  };

  let cpi_program = token_program.to_account_info();
  let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
  transfer_checked(cpi_ctx, amount, token_mint.decimals)?;

  Ok(())
}


pub fn transfer_token_from_protocol<'info>(
  protocol: &Account<'info, Protocol>,
  token_mint: &InterfaceAccount<'info, Mint>,
  protocol_token_account: &InterfaceAccount<'info, TokenAccount>,
  token_account: &InterfaceAccount<'info, TokenAccount>,
  token_program: &Interface<'info, TokenInterface>,
  amount: u64,
) -> Result<()> {

  let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_SEED, &[protocol.bump]]];

  let cpi_accounts = TransferChecked {
    from: protocol_token_account.to_account_info(),
    to: token_account.to_account_info(),
    authority: protocol.to_account_info(),
    mint: token_mint.to_account_info(),
  };

  let cpi_program = token_program.to_account_info();
  let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
  transfer_checked(cpi_ctx, amount, token_mint.decimals)?;

  Ok(())
}


pub fn mint_ve_token_with_metadata<'info>(
  protocol: &Account<'info, Protocol>,
  ve_mint: &InterfaceAccount<'info, Mint>,
  ve_token_account: &InterfaceAccount<'info, TokenAccount>,
  metadata: &UncheckedAccount<'info>,
  funder: &Signer<'info>,
  metadata_program: &Program<'info, Metadata>,
  token_program: &Interface<'info, TokenInterface>,
  system_program: &Program<'info, System>,
  rent: &Sysvar<'info, Rent>,
  bump: u8,
) -> Result<()> {

  mint_ve_token(
    protocol,
    ve_mint,
    ve_token_account,
    token_program,
    bump,
  )?;
  
  let next_nft_token_id_bytes = protocol.next_nft_token_id.to_le_bytes();
  let signer_seeds: &[&[&[u8]]] = &[&[VE_TOKEN_SEED, next_nft_token_id_bytes.as_ref(), &[bump]]];

  let mut nft_name = String::from(VE_METADATA_NAME);
  nft_name.push_str(" #");
  nft_name.push_str(&protocol.next_nft_token_id.to_string());

  let mut nft_uri = String::from(VE_METADATA_URI);
  nft_uri.push_str("/");
  nft_uri.push_str(&protocol.next_nft_token_id.to_string());

  let metadata_data = DataV2 {
    name: nft_name,
    symbol: VE_METADATA_SYMBOL.to_string(),
    uri: nft_uri,
    seller_fee_basis_points: 0,
    creators: Some(vec![Creator {
      address: protocol.key(),
      verified: false,
      share: 100,
    }]),
    collection: None,
    uses: None,
  };

  let create_metadata_cpi = CreateMetadataAccountsV3 {
    metadata: metadata.to_account_info(),
    mint: ve_mint.to_account_info(),
    mint_authority: ve_mint.to_account_info(),
    update_authority: ve_mint.to_account_info(),
    payer: funder.to_account_info(),
    system_program: system_program.to_account_info(),
    rent: rent.to_account_info(),
  };

  let metadata_ctx = CpiContext::new_with_signer(
      metadata_program.to_account_info(),
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

  remove_ve_token_authority(
    protocol,
    ve_mint,
    token_program,
    bump,
  )?;

  Ok(())
}

// veNFTs represent live protocol state (Lock.owner, voting weight, whether a
// lock has an active vote this epoch) that only transfer_lock/merge_lock/
// exit_lock know how to update. A veNFT's mint sets itself as freeze
// authority (see create_lock.rs's `mint::freeze_authority = ve_mint.key()`)
// specifically so it can be kept frozen outside of those instructions --
// otherwise a bare SPL transfer moves the NFT while Lock.owner (and every
// instruction gated on it) still points at the sender, permanently
// bricking the lock: the new holder can't act on it (owner constraint
// fails) and the old owner no longer holds the NFT needed to exit/merge it.
fn set_ve_token_account_frozen<'info>(
  freeze: bool,
  ve_mint: &InterfaceAccount<'info, Mint>,
  ve_token_account: &InterfaceAccount<'info, TokenAccount>,
  token_program: &Interface<'info, TokenInterface>,
  signer_seeds: &[&[&[u8]]],
) -> Result<()> {
  let token_program_id = token_program.key();
  let mint_key = ve_mint.key();
  let account_key = ve_token_account.key();

  let ix = if freeze {
    build_freeze_account_ix(&token_program_id, &account_key, &mint_key, &mint_key, &[])?
  } else {
    build_thaw_account_ix(&token_program_id, &account_key, &mint_key, &mint_key, &[])?
  };

  invoke_signed(
    &ix,
    &[
      ve_token_account.to_account_info(),
      ve_mint.to_account_info(),
      token_program.to_account_info(),
    ],
    signer_seeds,
  )?;

  Ok(())
}

pub fn mint_ve_token<'info>(
  protocol: &Account<'info, Protocol>,
  ve_mint: &InterfaceAccount<'info, Mint>,
  ve_token_account: &InterfaceAccount<'info, TokenAccount>,
  token_program: &Interface<'info, TokenInterface>,
  bump: u8,
) -> Result<()> {

  let next_nft_token_id_bytes = protocol.next_nft_token_id.to_le_bytes();
  let signer_seeds: &[&[&[u8]]] = &[&[VE_TOKEN_SEED, next_nft_token_id_bytes.as_ref(), &[bump]]];

  let cpi_accounts = MintTo {
    mint: ve_mint.to_account_info(),
    to: ve_token_account.to_account_info(),
    authority: ve_mint.to_account_info(),
  };

  let cpi_program = token_program.to_account_info();
  let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
  mint_to(cpi_ctx, 1)?;

  set_ve_token_account_frozen(true, ve_mint, ve_token_account, token_program, signer_seeds)?;

  Ok(())
}


pub fn transfer_ve_token<'info>(
  funder: &Signer<'info>,
  ve_mint: &InterfaceAccount<'info, Mint>,
  ve_token_account: &InterfaceAccount<'info, TokenAccount>,
  receiver: &InterfaceAccount<'info, TokenAccount>,
  token_program: &Interface<'info, TokenInterface>,
  ve_token_id: u64,
  bump: u8,
) -> Result<()> {

  let next_nft_token_id_bytes = ve_token_id.to_le_bytes();
  let signer_seeds: &[&[&[u8]]] = &[&[VE_TOKEN_SEED, next_nft_token_id_bytes.as_ref(), &[bump]]];

  set_ve_token_account_frozen(false, ve_mint, ve_token_account, token_program, signer_seeds)?;

  let cpi_accounts = TransferChecked {
    from: ve_token_account.to_account_info(),
    to: receiver.to_account_info(),
    authority: funder.to_account_info(),
    mint: ve_mint.to_account_info(),
  };

  let cpi_program = token_program.to_account_info();
  let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
  transfer_checked(cpi_ctx, 1, ve_mint.decimals)?;

  set_ve_token_account_frozen(true, ve_mint, receiver, token_program, signer_seeds)?;

  Ok(())
}

pub fn burn_and_close_ve_token<'info>(
  funder: &Signer<'info>,
  ve_mint: &InterfaceAccount<'info, Mint>,
  ve_token_account: &InterfaceAccount<'info, TokenAccount>,
  token_program: &Interface<'info, TokenInterface>,
  ve_token_id: u64,
  bump: u8,
) -> Result<()> {

  let next_nft_token_id_bytes = ve_token_id.to_le_bytes();
  let signer_seeds: &[&[&[u8]]] = &[&[VE_TOKEN_SEED, next_nft_token_id_bytes.as_ref(), &[bump]]];

  // Burn is rejected by the token program on a frozen account, same as
  // Transfer -- thaw first (nothing else needs to touch this account
  // afterward, since it's closed below).
  set_ve_token_account_frozen(false, ve_mint, ve_token_account, token_program, signer_seeds)?;

  let cpi_accounts = BurnChecked {
    mint: ve_mint.to_account_info(),
    from: ve_token_account.to_account_info(),
    authority: funder.to_account_info(),
  };

  let cpi_program = token_program.to_account_info();
  let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
  burn_checked(cpi_ctx, 1, ve_mint.decimals)?;

  let cpi_accounts = CloseAccount {
    account: ve_token_account.to_account_info(),
    destination: funder.to_account_info(),
    authority: funder.to_account_info(),
  };

  let cpi_program = token_program.to_account_info();
  let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
  close_account(cpi_ctx)?;

  Ok(())
}


pub fn remove_ve_token_authority<'info>(
  protocol: &Account<'info, Protocol>,
  ve_mint: &InterfaceAccount<'info, Mint>,
  token_program: &Interface<'info, TokenInterface>,
  bump: u8,
) -> Result<()> {

  let next_nft_token_id_bytes = protocol.next_nft_token_id.to_le_bytes();
  let signer_seeds: &[&[&[u8]]] = &[&[VE_TOKEN_SEED, next_nft_token_id_bytes.as_ref(), &[bump]]];

  let cpi_accounts = SetAuthority {
    current_authority: ve_mint.to_account_info(),
    account_or_mint: ve_mint.to_account_info(),
  };

  let cpi_program = token_program.to_account_info();
  let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
  set_authority(cpi_ctx, AuthorityType::MintTokens, None)?;

  Ok(())
}