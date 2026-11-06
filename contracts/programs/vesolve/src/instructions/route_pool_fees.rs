//! Atomically collect live DEX fee counters into the current gauge epoch vault.
//!
//! Unlike the legacy keeper's collect + fixed-amount deposit pair, this
//! instruction reads the write-locked pool inside the transaction. No fees can
//! arrive between the amount snapshot and CPI collection, and no tokens pass
//! through a keeper-owned account. The explicit epoch rejects stale clients.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use solve::state::{Solve, SolvesConfig};

use crate::constants::{EPOCH_DATA_SEED, GAUGE_SEED, PROTOCOL_SEED, VAULT_SEED};
use crate::errors::ErrorCode;
use crate::events::VaultCreated;
use crate::states::{Epoch, Gauge, Protocol, VaultData};

#[derive(Accounts)]
#[instruction(expected_epoch: u64)]
pub struct RoutePoolFees<'info> {
    /// Anyone (review H-2): the protocol PDA is the DEX's protocol-fee collector, and the fees can only go
    /// into this epoch's vault for this gauge's voters.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        constraint = protocol.current_epoch == expected_epoch @ ErrorCode::InvalidEpoch,
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(
        seeds = [GAUGE_SEED, protocol.key().as_ref(), pool.key().as_ref()],
        bump = gauge.bump,
        constraint = gauge.pool_address == pool.key() @ ErrorCode::InvalidGauge,
    )]
    pub gauge: Box<Account<'info, Gauge>>,

    #[account(
        constraint = solves_config.collect_protocol_fees_authority == protocol.key() @ ErrorCode::Unauthorized,
    )]
    pub solves_config: Box<Account<'info, SolvesConfig>>,

    #[account(mut, has_one = solves_config,
        constraint = pool.protocol_fee_rate == crate::constants::GAUGED_PROTOCOL_FEE_RATE @ ErrorCode::NativeGaugeRequired)]
    pub pool: Box<Account<'info, Solve>>,

    #[account(
        init_if_needed,
        payer = caller,
        space = 8 + VaultData::INIT_SPACE,
        seeds = [VAULT_SEED, expected_epoch.to_le_bytes().as_ref(), gauge.key().as_ref()],
        bump,
    )]
    pub vault: Box<Account<'info, VaultData>>,

    #[account(address = pool.token_mint_a, constraint = token_mint_a.key() == gauge.token_mint_a @ ErrorCode::InvalidMint)]
    pub token_mint_a: Account<'info, Mint>,

    #[account(address = pool.token_mint_b, constraint = token_mint_b.key() == gauge.token_mint_b @ ErrorCode::InvalidMint)]
    pub token_mint_b: Account<'info, Mint>,

    #[account(mut, address = pool.token_vault_a, constraint = token_vault_a.mint == token_mint_a.key() @ ErrorCode::InvalidMint)]
    pub token_vault_a: Box<Account<'info, TokenAccount>>,

    #[account(mut, address = pool.token_vault_b, constraint = token_vault_b.mint == token_mint_b.key() @ ErrorCode::InvalidMint)]
    pub token_vault_b: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint_a,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account_a: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint_b,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account_b: Box<Account<'info, TokenAccount>>,

    // Typed programs prevent arbitrary-program CPI. The deployed collection
    // instruction supports classic SPL Token; Token-2022 needs a separate path.
    pub solve_program: Program<'info, solve::program::Solve>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    /// The epoch the fees are routed into. Fees routed into an epoch where the gauge has no votes could never be
    /// claimed (DEV-10), so routing is refused until the gauge has votes; until then they stay owed in the pool.
    #[account(seeds = [EPOCH_DATA_SEED, expected_epoch.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
}

pub(crate) fn gauge_has_votes(epoch: &Epoch, gauge: &Pubkey) -> bool {
    epoch.gauge_weights.iter().any(|gw| gw.gauge == *gauge && gw.weight > 0)
}

fn accumulated_pool_rewards(previous: u64, collected: u64) -> Result<u64> {
    previous.checked_add(collected).ok_or_else(|| ErrorCode::ArithmeticOverflow.into())
}

fn validate_collection_result(before: u64, after: u64, collected: u64, remaining: u64) -> Result<()> {
    let expected = accumulated_pool_rewards(before, collected)?;
    require!(after == expected && remaining == 0, ErrorCode::InvalidAmount);
    Ok(())
}

pub fn route_pool_fees(ctx: Context<RoutePoolFees>, expected_epoch: u64) -> Result<()> {
    require!(gauge_has_votes(&ctx.accounts.epoch, &ctx.accounts.gauge.key()), ErrorCode::GaugeHasNoVotes);
    // All source and destination accounts are locked for the whole instruction.
    let amount_a = ctx.accounts.pool.protocol_fee_owed_a;
    let amount_b = ctx.accounts.pool.protocol_fee_owed_b;
    let next_rewards_a = accumulated_pool_rewards(ctx.accounts.vault.pool_rewards_a, amount_a)?;
    let next_rewards_b = accumulated_pool_rewards(ctx.accounts.vault.pool_rewards_b, amount_b)?;
    let before_a = ctx.accounts.vault_token_account_a.amount;
    let before_b = ctx.accounts.vault_token_account_b.amount;

    let protocol_signer: &[&[u8]] = &[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]];
    solve::cpi::collect_protocol_fees(CpiContext::new_with_signer(
        ctx.accounts.solve_program.to_account_info(),
        solve::cpi::accounts::CollectProtocolFees {
            solves_config: ctx.accounts.solves_config.to_account_info(),
            solve: ctx.accounts.pool.to_account_info(),
            collect_protocol_fees_authority: ctx.accounts.protocol.to_account_info(),
            token_vault_a: ctx.accounts.token_vault_a.to_account_info(),
            token_vault_b: ctx.accounts.token_vault_b.to_account_info(),
            token_destination_a: ctx.accounts.vault_token_account_a.to_account_info(),
            token_destination_b: ctx.accounts.vault_token_account_b.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        &[protocol_signer],
    ))?;

    ctx.accounts.pool.reload()?;
    ctx.accounts.vault_token_account_a.reload()?;
    ctx.accounts.vault_token_account_b.reload()?;
    validate_collection_result(before_a, ctx.accounts.vault_token_account_a.amount, amount_a, ctx.accounts.pool.protocol_fee_owed_a)?;
    validate_collection_result(before_b, ctx.accounts.vault_token_account_b.amount, amount_b, ctx.accounts.pool.protocol_fee_owed_b)?;

    let vault = &mut ctx.accounts.vault;
    vault.admin = ctx.accounts.caller.key();
    vault.gauge = ctx.accounts.gauge.key();
    vault.epoch = expected_epoch;
    vault.pool_rewards_a = next_rewards_a;
    vault.pool_rewards_b = next_rewards_b;
    vault.bump = ctx.bumps.vault;
    // Deliberately preserve vault.rewards (emissions), including on repeat sweeps.
    ctx.accounts.protocol.last_emission_time = Clock::get()?.unix_timestamp;
    for (token_mint, rewards) in [
        (ctx.accounts.token_mint_a.key(), amount_a),
        (ctx.accounts.token_mint_b.key(), amount_b),
    ] {
        emit!(VaultCreated { admin: ctx.accounts.caller.key(), gauge: ctx.accounts.gauge.key(), token_mint, epoch: expected_epoch, rewards });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::InstructionData;

    #[test]
    fn repeated_sweeps_accumulate_exactly() {
        let first = accumulated_pool_rewards(17, 23).unwrap();
        assert_eq!(accumulated_pool_rewards(first, 40).unwrap(), 80);
        assert_eq!(accumulated_pool_rewards(first, 0).unwrap(), first);
        assert!(accumulated_pool_rewards(u64::MAX, 1).is_err());
    }

    #[test]
    fn collection_requires_exact_balance_delta_and_zeroed_counters() {
        assert!(validate_collection_result(50, 73, 23, 0).is_ok());
        assert!(validate_collection_result(50, 50, 0, 0).is_ok());
        assert!(validate_collection_result(50, 72, 23, 0).is_err());
        assert!(validate_collection_result(50, 74, 23, 0).is_err());
        assert!(validate_collection_result(50, 73, 23, 1).is_err());
        assert!(validate_collection_result(u64::MAX, 0, 1, 0).is_err());
    }

    #[test]
    fn instruction_pins_epoch_and_has_no_off_chain_amount_arguments() {
        let data = crate::instruction::RoutePoolFees { expected_epoch: 42 }.data();
        assert_eq!(data.len(), 16); // discriminator + one u64, no snapshot amounts
        assert_eq!(&data[8..], &42u64.to_le_bytes());
        let next = crate::instruction::RoutePoolFees { expected_epoch: 43 }.data();
        assert_ne!(data, next);
    }
}
