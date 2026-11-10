use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ErrorCode,
    state::*,
    util::{is_token_badge_initialized, v2::is_supported_token_mint},
};

#[derive(Accounts)]
#[instruction(tick_spacing: u16)]
pub struct InitializePoolV2<'info> {
    pub solves_config: Box<Account<'info, SolvesConfig>>,

    pub token_mint_a: InterfaceAccount<'info, Mint>,
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    #[account(seeds = [b"token_badge", solves_config.key().as_ref(), token_mint_a.key().as_ref()], bump)]
    /// CHECK: checked in the handler
    pub token_badge_a: UncheckedAccount<'info>,
    #[account(seeds = [b"token_badge", solves_config.key().as_ref(), token_mint_b.key().as_ref()], bump)]
    /// CHECK: checked in the handler
    pub token_badge_b: UncheckedAccount<'info>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(init,
      seeds = [
        b"solve".as_ref(),
        solves_config.key().as_ref(),
        token_mint_a.key().as_ref(),
        token_mint_b.key().as_ref(),
        tick_spacing.to_le_bytes().as_ref()
      ],
      bump,
      payer = funder,
      space = Solve::LEN)]
    pub solve: Box<Account<'info, Solve>>,

    #[account(init,
      payer = funder,
      token::token_program = token_program_a,
      token::mint = token_mint_a,
      token::authority = solve)]
    pub token_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(init,
      payer = funder,
      token::token_program = token_program_b,
      token::mint = token_mint_b,
      token::authority = solve)]
    pub token_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(has_one = solves_config, constraint = fee_tier.tick_spacing == tick_spacing)]
    pub fee_tier: Account<'info, FeeTier>,

    #[account(address = *token_mint_a.to_account_info().owner)]
    pub token_program_a: Interface<'info, TokenInterface>,
    #[account(address = *token_mint_b.to_account_info().owner)]
    pub token_program_b: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializePoolV2>,
    tick_spacing: u16,
    initial_sqrt_price: u128,
) -> Result<()> {
    let token_mint_a = ctx.accounts.token_mint_a.key();
    let token_mint_b = ctx.accounts.token_mint_b.key();

    let solve = &mut ctx.accounts.solve;
    let solves_config = &ctx.accounts.solves_config;

    let default_fee_rate = ctx.accounts.fee_tier.default_fee_rate;

    // ignore the bump passed and use one Anchor derived
    let bump = ctx.bumps.solve;

    // Don't allow creating a pool with unsupported token mints
    let is_token_badge_initialized_a = is_token_badge_initialized(
        solves_config.key(),
        token_mint_a,
        &ctx.accounts.token_badge_a,
    )?;

    if !is_supported_token_mint(&ctx.accounts.token_mint_a, is_token_badge_initialized_a).unwrap() {
        return Err(ErrorCode::UnsupportedTokenMint.into());
    }

    let is_token_badge_initialized_b = is_token_badge_initialized(
        solves_config.key(),
        token_mint_b,
        &ctx.accounts.token_badge_b,
    )?;

    if !is_supported_token_mint(&ctx.accounts.token_mint_b, is_token_badge_initialized_b).unwrap() {
        return Err(ErrorCode::UnsupportedTokenMint.into());
    }

    solve.initialize(
        solves_config,
        bump,
        tick_spacing,
        initial_sqrt_price,
        default_fee_rate,
        token_mint_a,
        ctx.accounts.token_vault_a.key(),
        token_mint_b,
        ctx.accounts.token_vault_b.key(),
    )
}
