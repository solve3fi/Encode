use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::{POOL_FEE_POSITION_SEED, POOL_FEE_VAULT_SEED};
use crate::errors::ErrorCode;
use crate::states::{PoolFeePosition, PoolFeeVault};

/// Same in-range gate as gauge_stake.rs's identical helper: out-of-range
/// liquidity does nothing for swappers and is cheap to mint arbitrarily
/// large for a narrow range, so it must never carry weight.
fn position_in_range(position: &solve::state::Position, pool: &solve::state::Solve) -> bool {
    pool.tick_current_index >= position.tick_lower_index
        && pool.tick_current_index < position.tick_upper_index
}

/// Registers an existing LP position against a pool's (Gauge-less) fee
/// vault. Unlike gauge staking, this never takes custody of the position --
/// the owner keeps it in their own wallet the whole time, and full range/
/// liquidity management, transfers, etc. all keep working normally. All
/// this records is "this position is eligible for a weighted share of
/// whatever gets swept into this pool's fee vault," verified at claim time
/// by the caller still holding the position NFT, not by any lockup here.
#[derive(Accounts)]
pub struct RegisterPoolFeePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    pub pool: Box<Account<'info, solve::state::Solve>>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + PoolFeeVault::INIT_SPACE,
        seeds = [POOL_FEE_VAULT_SEED, pool.key().as_ref()],
        bump,
    )]
    pub pool_fee_vault: Box<Account<'info, PoolFeeVault>>,

    #[account(
        constraint = position.solve == pool.key() @ ErrorCode::InvalidGauge,
        constraint = position.position_mint == position_mint.key() @ ErrorCode::InvalidMint,
        constraint = position.liquidity > 0 @ ErrorCode::PositionHasNoLiquidity,
    )]
    pub position: Box<Account<'info, solve::state::Position>>,

    #[account(constraint = position_mint.decimals == 0 @ ErrorCode::InvalidMint)]
    pub position_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        associated_token::mint = position_mint,
        associated_token::authority = owner,
        constraint = owner_position_token.amount == 1 @ ErrorCode::InvalidOwner,
    )]
    pub owner_position_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = owner,
        space = 8 + PoolFeePosition::INIT_SPACE,
        seeds = [POOL_FEE_POSITION_SEED, position_mint.key().as_ref()],
        bump,
    )]
    pub pool_fee_position: Box<Account<'info, PoolFeePosition>>,

    pub system_program: Program<'info, System>,
}

pub fn register_pool_fee_position(ctx: Context<RegisterPoolFeePosition>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let vault = &mut ctx.accounts.pool_fee_vault;
    if vault.pool == Pubkey::default() {
        vault.pool = ctx.accounts.pool.key();
        vault.token_mint_a = ctx.accounts.pool.token_mint_a;
        vault.token_mint_b = ctx.accounts.pool.token_mint_b;
        vault.bump = ctx.bumps.pool_fee_vault;
    }

    let position = &mut ctx.accounts.pool_fee_position;
    position.owner = ctx.accounts.owner.key();
    position.pool = ctx.accounts.pool.key();
    position.position = ctx.accounts.position.key();
    position.position_mint = ctx.accounts.position_mint.key();
    // Starts at zero weight, same reasoning as stake_position: nothing has
    // been realized yet, needs at least one sync_pool_fee_position call
    // after some trading activity before it earns a share.
    position.weight = 0;
    position.last_fee_owed_a = ctx.accounts.position.fee_owed_a;
    position.last_fee_owed_b = ctx.accounts.position.fee_owed_b;
    position.is_paused = false;
    position.reward_per_weight_a_paid_x64 = vault.reward_per_weight_a_x64;
    position.reward_per_weight_b_paid_x64 = vault.reward_per_weight_b_x64;
    position.accrued_a = 0;
    position.accrued_b = 0;
    position.registered_at = now;
    position.bump = ctx.bumps.pool_fee_position;

    Ok(())
}

/// Permissionless, same rationale as vesolve's sync_stake: refreshes a
/// registered position's weight against real fee_owed activity and current
/// range status, without needing the owner to do anything. Doesn't move
/// funds or grant any privilege to the caller.
#[derive(Accounts)]
pub struct SyncPoolFeePosition<'info> {
    pub caller: Signer<'info>,

    pub pool: Box<Account<'info, solve::state::Solve>>,

    #[account(
        constraint = position.position_mint == pool_fee_position.position_mint @ ErrorCode::InvalidMint,
    )]
    pub position: Box<Account<'info, solve::state::Position>>,

    #[account(
        mut,
        seeds = [POOL_FEE_VAULT_SEED, pool.key().as_ref()],
        bump = pool_fee_vault.bump,
        constraint = pool_fee_vault.pool == pool.key() @ ErrorCode::InvalidGauge,
    )]
    pub pool_fee_vault: Box<Account<'info, PoolFeeVault>>,

    #[account(
        mut,
        seeds = [POOL_FEE_POSITION_SEED, pool_fee_position.position_mint.as_ref()],
        bump = pool_fee_position.bump,
        constraint = pool_fee_position.pool == pool.key() @ ErrorCode::InvalidGauge,
    )]
    pub pool_fee_position: Box<Account<'info, PoolFeePosition>>,
}

pub fn sync_pool_fee_position(ctx: Context<SyncPoolFeePosition>) -> Result<()> {
    let in_range = position_in_range(&ctx.accounts.position, &ctx.accounts.pool);
    let fee_owed_a = ctx.accounts.position.fee_owed_a;
    let fee_owed_b = ctx.accounts.position.fee_owed_b;
    let vault = &mut ctx.accounts.pool_fee_vault;
    let position = &mut ctx.accounts.pool_fee_position;
    position.sync(vault, in_range, fee_owed_a, fee_owed_b)
}

/// Permissionless -- same "anyone can fund" philosophy as create_bribe.
/// Whoever holds the swept protocol-fee tokens (in practice, the
/// admin/keeper after calling the DEX's collect_protocol_fees, which is
/// itself gated to the configured collect_protocol_fees_authority) donates
/// them into this pool's vault to be shared by its registered positions.
#[derive(Accounts)]
#[instruction(amount_a: u64, amount_b: u64)]
pub struct FundPoolFeeVault<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    pub pool: Box<Account<'info, solve::state::Solve>>,

    #[account(
        mut,
        seeds = [POOL_FEE_VAULT_SEED, pool.key().as_ref()],
        bump = pool_fee_vault.bump,
        constraint = pool_fee_vault.pool == pool.key() @ ErrorCode::InvalidGauge,
    )]
    pub pool_fee_vault: Box<Account<'info, PoolFeeVault>>,

    #[account(constraint = token_mint_a.key() == pool_fee_vault.token_mint_a @ ErrorCode::InvalidMint)]
    pub token_mint_a: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = funder_token_account_a.mint == token_mint_a.key() @ ErrorCode::InvalidMint,
        constraint = funder_token_account_a.owner == funder.key() @ ErrorCode::InvalidOwner,
        constraint = funder_token_account_a.amount >= amount_a @ ErrorCode::InsufficientFunds,
    )]
    pub funder_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = funder,
        associated_token::mint = token_mint_a,
        associated_token::authority = pool_fee_vault,
    )]
    pub vault_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(constraint = token_mint_b.key() == pool_fee_vault.token_mint_b @ ErrorCode::InvalidMint)]
    pub token_mint_b: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = funder_token_account_b.mint == token_mint_b.key() @ ErrorCode::InvalidMint,
        constraint = funder_token_account_b.owner == funder.key() @ ErrorCode::InvalidOwner,
        constraint = funder_token_account_b.amount >= amount_b @ ErrorCode::InsufficientFunds,
    )]
    pub funder_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = funder,
        associated_token::mint = token_mint_b,
        associated_token::authority = pool_fee_vault,
    )]
    pub vault_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn fund_pool_fee_vault(ctx: Context<FundPoolFeeVault>, amount_a: u64, amount_b: u64) -> Result<()> {
    require!(amount_a > 0 || amount_b > 0, ErrorCode::InvalidAmount);

    if amount_a > 0 {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.funder_token_account_a.to_account_info(),
                    mint: ctx.accounts.token_mint_a.to_account_info(),
                    to: ctx.accounts.vault_token_account_a.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount_a,
            ctx.accounts.token_mint_a.decimals,
        )?;
    }

    if amount_b > 0 {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.funder_token_account_b.to_account_info(),
                    mint: ctx.accounts.token_mint_b.to_account_info(),
                    to: ctx.accounts.vault_token_account_b.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount_b,
            ctx.accounts.token_mint_b.decimals,
        )?;
    }

    ctx.accounts.pool_fee_vault.fund(amount_a, amount_b)
}

#[derive(Accounts)]
pub struct ClaimPoolFees<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    pub pool: Box<Account<'info, solve::state::Solve>>,

    #[account(
        mut,
        seeds = [POOL_FEE_VAULT_SEED, pool.key().as_ref()],
        bump = pool_fee_vault.bump,
        constraint = pool_fee_vault.pool == pool.key() @ ErrorCode::InvalidGauge,
    )]
    pub pool_fee_vault: Box<Account<'info, PoolFeeVault>>,

    #[account(
        constraint = position.position_mint == pool_fee_position.position_mint @ ErrorCode::InvalidMint,
    )]
    pub position: Box<Account<'info, solve::state::Position>>,

    #[account(
        mut,
        seeds = [POOL_FEE_POSITION_SEED, pool_fee_position.position_mint.as_ref()],
        bump = pool_fee_position.bump,
        constraint = pool_fee_position.pool == pool.key() @ ErrorCode::InvalidGauge,
    )]
    pub pool_fee_position: Box<Account<'info, PoolFeePosition>>,

    // Ownership is proven by presently holding the position NFT, not by
    // pool_fee_position.owner -- LP position NFTs (unlike veNFTs) transfer
    // freely, so a stored owner field would go stale the moment one changes
    // hands.
    #[account(constraint = position_mint.key() == pool_fee_position.position_mint @ ErrorCode::InvalidMint)]
    pub position_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        associated_token::mint = position_mint,
        associated_token::authority = owner,
        constraint = owner_position_token.amount == 1 @ ErrorCode::InvalidOwner,
    )]
    pub owner_position_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(constraint = token_mint_a.key() == pool_fee_vault.token_mint_a @ ErrorCode::InvalidMint)]
    pub token_mint_a: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = token_mint_a,
        associated_token::authority = pool_fee_vault,
    )]
    pub vault_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = token_mint_a,
        associated_token::authority = owner,
    )]
    pub owner_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(constraint = token_mint_b.key() == pool_fee_vault.token_mint_b @ ErrorCode::InvalidMint)]
    pub token_mint_b: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = token_mint_b,
        associated_token::authority = pool_fee_vault,
    )]
    pub vault_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = token_mint_b,
        associated_token::authority = owner,
    )]
    pub owner_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn claim_pool_fees(ctx: Context<ClaimPoolFees>) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Claims)?;
    let in_range = position_in_range(&ctx.accounts.position, &ctx.accounts.pool);
    let fee_owed_a = ctx.accounts.position.fee_owed_a;
    let fee_owed_b = ctx.accounts.position.fee_owed_b;

    {
        let vault = &mut ctx.accounts.pool_fee_vault;
        let position = &mut ctx.accounts.pool_fee_position;
        position.sync(vault, in_range, fee_owed_a, fee_owed_b)?;
    }

    let amount_a = ctx.accounts.pool_fee_position.accrued_a;
    let amount_b = ctx.accounts.pool_fee_position.accrued_b;
    require!(amount_a > 0 || amount_b > 0, ErrorCode::InsufficientFunds);

    let pool_key = ctx.accounts.pool.key();
    let vault_bump = ctx.accounts.pool_fee_vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[POOL_FEE_VAULT_SEED, pool_key.as_ref(), &[vault_bump]]];

    if amount_a > 0 {
        require!(
            ctx.accounts.vault_token_account_a.amount >= amount_a,
            ErrorCode::InsufficientFunds
        );
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_token_account_a.to_account_info(),
                    mint: ctx.accounts.token_mint_a.to_account_info(),
                    to: ctx.accounts.owner_token_account_a.to_account_info(),
                    authority: ctx.accounts.pool_fee_vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount_a,
            ctx.accounts.token_mint_a.decimals,
        )?;
        ctx.accounts.pool_fee_position.accrued_a = 0;
    }

    if amount_b > 0 {
        require!(
            ctx.accounts.vault_token_account_b.amount >= amount_b,
            ErrorCode::InsufficientFunds
        );
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_token_account_b.to_account_info(),
                    mint: ctx.accounts.token_mint_b.to_account_info(),
                    to: ctx.accounts.owner_token_account_b.to_account_info(),
                    authority: ctx.accounts.pool_fee_vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount_b,
            ctx.accounts.token_mint_b.decimals,
        )?;
        ctx.accounts.pool_fee_position.accrued_b = 0;
    }

    Ok(())
}
