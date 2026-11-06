use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

#[derive(Accounts)]
// now we don't use bumps, but we must list args in the same order to use tick_spacing arg.
#[instruction(bumps: SolveBumps, tick_spacing: u16)]
pub struct InitializePool<'info> {
    pub solves_config: Box<Account<'info, SolvesConfig>>,

    pub token_mint_a: Account<'info, Mint>,
    pub token_mint_b: Account<'info, Mint>,

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
      token::mint = token_mint_a,
      token::authority = solve)]
    pub token_vault_a: Box<Account<'info, TokenAccount>>,

    #[account(init,
      payer = funder,
      token::mint = token_mint_b,
      token::authority = solve)]
    pub token_vault_b: Box<Account<'info, TokenAccount>>,

    #[account(has_one = solves_config, constraint = fee_tier.tick_spacing == tick_spacing)]
    pub fee_tier: Account<'info, FeeTier>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializePool>,
    _bumps: SolveBumps,
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
