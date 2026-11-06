use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::{
    errors::ErrorCode,
    manager::swap_manager::*,
    state::Solve,
    util::{to_timestamp_u64, update_and_swap_solve, SparseSwapTickSequenceBuilder},
};

#[derive(Accounts)]
pub struct TwoHopSwap<'info> {
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    pub token_authority: Signer<'info>,

    #[account(mut)]
    pub solve_one: Box<Account<'info, Solve>>,

    #[account(mut)]
    pub solve_two: Box<Account<'info, Solve>>,

    #[account(mut, constraint = token_owner_account_one_a.mint == solve_one.token_mint_a)]
    pub token_owner_account_one_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = solve_one.token_vault_a)]
    pub token_vault_one_a: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_one_b.mint == solve_one.token_mint_b)]
    pub token_owner_account_one_b: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = solve_one.token_vault_b)]
    pub token_vault_one_b: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_two_a.mint == solve_two.token_mint_a)]
    pub token_owner_account_two_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = solve_two.token_vault_a)]
    pub token_vault_two_a: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_two_b.mint == solve_two.token_mint_b)]
    pub token_owner_account_two_b: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = solve_two.token_vault_b)]
    pub token_vault_two_b: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_one_0: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_one_1: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_one_2: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_two_0: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_two_1: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_two_2: UncheckedAccount<'info>,

    #[account(seeds = [b"oracle", solve_one.key().as_ref()],bump)]
    /// CHECK: Oracle is currently unused and will be enabled on subsequent updates
    pub oracle_one: UncheckedAccount<'info>,

    #[account(seeds = [b"oracle", solve_two.key().as_ref()],bump)]
    /// CHECK: Oracle is currently unused and will be enabled on subsequent updates
    pub oracle_two: UncheckedAccount<'info>,

    /// Trading pause switches live in the config's feature flags.
    #[account(address = solve_one.solves_config)]
    pub solves_config: Account<'info, crate::state::SolvesConfig>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<TwoHopSwap>,
    amount: u64,
    other_amount_threshold: u64,
    amount_specified_is_input: bool,
    a_to_b_one: bool,
    a_to_b_two: bool,
    sqrt_price_limit_one: u128,
    sqrt_price_limit_two: u128,
) -> Result<()> {
    ctx.accounts.solves_config.require_swaps_enabled()?;
    require_keys_eq!(ctx.accounts.solve_two.solves_config, ctx.accounts.solves_config.key(), ErrorCode::SolvesConfigMismatch);
    let clock = Clock::get()?;
    // Update the global reward growth which increases as a function of time.
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    let solve_one = &mut ctx.accounts.solve_one;
    let solve_two = &mut ctx.accounts.solve_two;

    // Don't allow swaps on the same solve
    if solve_one.key() == solve_two.key() {
        return Err(ErrorCode::DuplicateTwoHopPool.into());
    }

    let swap_one_output_mint = if a_to_b_one {
        solve_one.token_mint_b
    } else {
        solve_one.token_mint_a
    };

    let swap_two_input_mint = if a_to_b_two {
        solve_two.token_mint_a
    } else {
        solve_two.token_mint_b
    };
    if swap_one_output_mint != swap_two_input_mint {
        return Err(ErrorCode::InvalidIntermediaryMint.into());
    }

    let builder_one = SparseSwapTickSequenceBuilder::try_from(
        solve_one,
        a_to_b_one,
        vec![
            ctx.accounts.tick_array_one_0.to_account_info(),
            ctx.accounts.tick_array_one_1.to_account_info(),
            ctx.accounts.tick_array_one_2.to_account_info(),
        ],
        None,
    )?;
    let mut swap_tick_sequence_one = builder_one.build()?;

    let builder_two = SparseSwapTickSequenceBuilder::try_from(
        solve_two,
        a_to_b_two,
        vec![
            ctx.accounts.tick_array_two_0.to_account_info(),
            ctx.accounts.tick_array_two_1.to_account_info(),
            ctx.accounts.tick_array_two_2.to_account_info(),
        ],
        None,
    )?;
    let mut swap_tick_sequence_two = builder_two.build()?;

    // TODO: WLOG, we could extend this to N-swaps, but the account inputs to the instruction would
    // need to be jankier and we may need to programatically map/verify rather than using anchor constraints
    let (swap_update_one, swap_update_two) = if amount_specified_is_input {
        // If the amount specified is input, this means we are doing exact-in
        // and the swap calculations occur from Swap 1 => Swap 2
        // and the swaps occur from Swap 1 => Swap 2
        let swap_calc_one = swap(
            solve_one,
            &mut swap_tick_sequence_one,
            amount,
            sqrt_price_limit_one,
            amount_specified_is_input, // true
            a_to_b_one,
            timestamp,
        )?;

        // Swap two input is the output of swap one
        let swap_two_input_amount = if a_to_b_one {
            swap_calc_one.amount_b
        } else {
            swap_calc_one.amount_a
        };

        let swap_calc_two = swap(
            solve_two,
            &mut swap_tick_sequence_two,
            swap_two_input_amount,
            sqrt_price_limit_two,
            amount_specified_is_input, // true
            a_to_b_two,
            timestamp,
        )?;
        (swap_calc_one, swap_calc_two)
    } else {
        // If the amount specified is output, this means we need to invert the ordering of the calculations
        // and the swap calculations occur from Swap 2 => Swap 1
        // but the actual swaps occur from Swap 1 => Swap 2 (to ensure that the intermediate token exists in the account)
        let swap_calc_two = swap(
            solve_two,
            &mut swap_tick_sequence_two,
            amount,
            sqrt_price_limit_two,
            amount_specified_is_input, // false
            a_to_b_two,
            timestamp,
        )?;

        // The output of swap 1 is input of swap_calc_two
        let swap_one_output_amount = if a_to_b_two {
            swap_calc_two.amount_a
        } else {
            swap_calc_two.amount_b
        };

        let swap_calc_one = swap(
            solve_one,
            &mut swap_tick_sequence_one,
            swap_one_output_amount,
            sqrt_price_limit_one,
            amount_specified_is_input, // false
            a_to_b_one,
            timestamp,
        )?;
        (swap_calc_one, swap_calc_two)
    };

    // All output token should be consumed by the second swap
    let swap_calc_one_output = if a_to_b_one {
        swap_update_one.amount_b
    } else {
        swap_update_one.amount_a
    };
    let swap_calc_two_input = if a_to_b_two {
        swap_update_two.amount_a
    } else {
        swap_update_two.amount_b
    };
    if swap_calc_one_output != swap_calc_two_input {
        return Err(ErrorCode::IntermediateTokenAmountMismatch.into());
    }

    if amount_specified_is_input {
        // If amount_specified_is_input == true, then we have a variable amount of output
        // The slippage we care about is the output of the second swap.
        let output_amount = if a_to_b_two {
            swap_update_two.amount_b
        } else {
            swap_update_two.amount_a
        };

        // If we have received less than the minimum out, throw an error
        if other_amount_threshold > output_amount {
            return Err(ErrorCode::AmountOutBelowMinimum.into());
        }
    } else {
        // amount_specified_is_output == false, then we have a variable amount of input
        // The slippage we care about is the input of the first swap
        let input_amount = if a_to_b_one {
            swap_update_one.amount_a
        } else {
            swap_update_one.amount_b
        };
        if other_amount_threshold < input_amount {
            return Err(ErrorCode::AmountInAboveMaximum.into());
        }
    }

    update_and_swap_solve(
        solve_one,
        &ctx.accounts.token_authority,
        &ctx.accounts.token_owner_account_one_a,
        &ctx.accounts.token_owner_account_one_b,
        &ctx.accounts.token_vault_one_a,
        &ctx.accounts.token_vault_one_b,
        &ctx.accounts.token_program,
        swap_update_one,
        a_to_b_one,
        timestamp,
    )?;

    update_and_swap_solve(
        solve_two,
        &ctx.accounts.token_authority,
        &ctx.accounts.token_owner_account_two_a,
        &ctx.accounts.token_owner_account_two_b,
        &ctx.accounts.token_vault_two_a,
        &ctx.accounts.token_vault_two_b,
        &ctx.accounts.token_program,
        swap_update_two,
        a_to_b_two,
        timestamp,
    )
}
