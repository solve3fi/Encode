use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TransferChecked, TokenInterface, transfer_checked};

use crate::constants::{VAULT_SEED};
use crate::states::{VaultData};


pub fn transfer_token_to_vault<'info>(
  authority: &Signer<'info>,
  token_mint: &InterfaceAccount<'info, Mint>,
  token_account: &InterfaceAccount<'info, TokenAccount>,
  vault_token_account: &InterfaceAccount<'info, TokenAccount>,
  token_program: &Interface<'info, TokenInterface>,
  amount: u64,
) -> Result<()> {

 let cpi_accounts = TransferChecked {
    from: token_account.to_account_info(),
    mint: token_mint.to_account_info(),
    to: vault_token_account.to_account_info(),
    authority: authority.to_account_info(),
  };

  let cpi_program = token_program.to_account_info();
  let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
  transfer_checked(cpi_ctx, amount, token_mint.decimals)?;

  Ok(())
}


pub fn transfer_token_from_vault<'info>(
  vault: &Account<'info, VaultData>,
  token_mint: &InterfaceAccount<'info, Mint>,
  vault_token_account: &InterfaceAccount<'info, TokenAccount>,
  token_account: &InterfaceAccount<'info, TokenAccount>,
  token_program: &Interface<'info, TokenInterface>,
  amount: u64,
) -> Result<()> {

  let epoch_bytes = vault.epoch.to_le_bytes();
  let signer_seeds: &[&[&[u8]]] = &[&[
    VAULT_SEED,
    epoch_bytes.as_ref(),
    vault.gauge.as_ref(),
    &[vault.bump],
  ]];

  let cpi_accounts = TransferChecked {
    from: vault_token_account.to_account_info(),
    to: token_account.to_account_info(),
    authority: vault.to_account_info(),
    mint: token_mint.to_account_info(),
  };

  let cpi_program = token_program.to_account_info();
  let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
  transfer_checked(cpi_ctx, amount, token_mint.decimals)?;

  Ok(())
}

/// Closes a program-owned account if it exists: its lamports go to `destination` and the account is handed
/// back to the system program empty. Does nothing for an account that was never created.
pub fn close_program_account_if_present<'info>(account: &AccountInfo<'info>, destination: &AccountInfo<'info>) -> Result<()> {
  if account.owner != &crate::ID || account.lamports() == 0 {
    return Ok(());
  }
  let lamports = account.lamports();
  **destination.try_borrow_mut_lamports()? = destination
    .lamports()
    .checked_add(lamports)
    .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
  **account.try_borrow_mut_lamports()? = 0;
  account.assign(&anchor_lang::solana_program::system_program::ID);
  account.resize(0)?;
  Ok(())
}
