use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::{BRIBE_TOKEN_SEED, PROTOCOL_SEED};
use crate::errors::ErrorCode;
use crate::events::BribeTokenUpdated;
use crate::states::{BribeToken, Protocol};

#[derive(Accounts)]
pub struct SetBribeToken<'info> {
  #[account(
    mut,
    constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized,
  )]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  pub token_mint: InterfaceAccount<'info, Mint>,

  #[account(
    init_if_needed,
    payer = admin,
    space = 8 + BribeToken::INIT_SPACE,
    seeds = [BRIBE_TOKEN_SEED, token_mint.key().as_ref()],
    bump,
  )]
  pub bribe_token: Box<Account<'info, BribeToken>>,

  pub system_program: Program<'info, System>,
}

/// Whitelists, delists and pauses one bribe reward token. Delisting
/// (`allowed = false`) only blocks new deposits; `paused = true` also blocks
/// claims of this token. Neither can change an amount already earned.
pub fn set_bribe_token(ctx: Context<SetBribeToken>, allowed: bool, paused: bool) -> Result<()> {
  let now = Clock::get()?.unix_timestamp;
  let policy = &mut ctx.accounts.bribe_token;
  policy.mint = ctx.accounts.token_mint.key();
  policy.allowed = allowed;
  policy.paused = paused;
  policy.updated_at = now;
  policy.bump = ctx.bumps.bribe_token;

  emit!(BribeTokenUpdated {
    admin: ctx.accounts.admin.key(),
    mint: policy.mint,
    allowed,
    paused,
    updated_at: now,
  });
  Ok(())
}
