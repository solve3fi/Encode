use solana_program::msg;

use crate::{
    errors::ErrorCode,
    manager::{
        tick_manager::next_tick_cross_update, solve_manager::next_solve_reward_infos,
    },
    math::*,
    state::*,
    util::SwapTickSequence,
};
use anchor_lang::prelude::*;
use std::convert::TryInto;

#[derive(Debug)]
pub struct PostSwapUpdate {
    pub amount_a: u64,
    pub amount_b: u64,
    pub next_liquidity: u128,
    pub next_tick_index: i32,
    pub next_sqrt_price: u128,
    pub next_fee_growth_global: u128,
    pub next_reward_infos: [SolveRewardInfo; NUM_REWARDS],
    pub next_protocol_fee: u64,
    /// Value of this swap's fees in token B (raw units), for the pool's activity
    /// gate. The caller divides by the pool's vault value to get a yield.
    pub gate_fee_value_b: u128,
}

pub fn swap(
    solve: &Solve,
    swap_tick_sequence: &mut SwapTickSequence,
    amount: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
    timestamp: u64,
) -> Result<PostSwapUpdate> {
    let adjusted_sqrt_price_limit = if sqrt_price_limit == NO_EXPLICIT_SQRT_PRICE_LIMIT {
        if a_to_b {
            MIN_SQRT_PRICE_X64
        } else {
            MAX_SQRT_PRICE_X64
        }
    } else {
        sqrt_price_limit
    };

    if !(MIN_SQRT_PRICE_X64..=MAX_SQRT_PRICE_X64).contains(&adjusted_sqrt_price_limit) {
        return Err(ErrorCode::SqrtPriceOutOfBounds.into());
    }

    if a_to_b && adjusted_sqrt_price_limit > solve.sqrt_price
        || !a_to_b && adjusted_sqrt_price_limit < solve.sqrt_price
    {
        return Err(ErrorCode::InvalidSqrtPriceLimitDirection.into());
    }

    if amount == 0 {
        return Err(ErrorCode::ZeroTradableAmount.into());
    }

    let tick_spacing = solve.tick_spacing;
    let fee_rate = solve.fee_rate;
    let protocol_fee_rate = solve.protocol_fee_rate;
    let next_reward_infos = next_solve_reward_infos(solve, timestamp)?;

    let mut amount_remaining: u64 = amount;
    let mut amount_calculated: u64 = 0;
    let mut curr_sqrt_price = solve.sqrt_price;
    let mut curr_tick_index = solve.tick_current_index;
    let mut curr_liquidity = solve.liquidity;
    let mut curr_protocol_fee: u64 = 0;
    let mut gate_fee_value_b: u128 = 0;
    let mut curr_array_index: usize = 0;
    let mut curr_fee_growth_global_input = if a_to_b {
        solve.fee_growth_global_a
    } else {
        solve.fee_growth_global_b
    };

    while amount_remaining > 0 && adjusted_sqrt_price_limit != curr_sqrt_price {
        let (next_array_index, next_tick_index) = swap_tick_sequence
            .get_next_initialized_tick_index(
                curr_tick_index,
                tick_spacing,
                a_to_b,
                curr_array_index,
            )?;

        let (next_tick_sqrt_price, sqrt_price_target) =
            get_next_sqrt_prices(next_tick_index, adjusted_sqrt_price_limit, a_to_b);

        let swap_computation = compute_swap(
            amount_remaining,
            fee_rate,
            curr_liquidity,
            curr_sqrt_price,
            sqrt_price_target,
            amount_specified_is_input,
            a_to_b,
        )?;

        if amount_specified_is_input {
            amount_remaining = amount_remaining
                .checked_sub(swap_computation.amount_in)
                .ok_or(ErrorCode::AmountRemainingOverflow)?;
            amount_remaining = amount_remaining
                .checked_sub(swap_computation.fee_amount)
                .ok_or(ErrorCode::AmountRemainingOverflow)?;

            amount_calculated = amount_calculated
                .checked_add(swap_computation.amount_out)
                .ok_or(ErrorCode::AmountCalcOverflow)?;
        } else {
            amount_remaining = amount_remaining
                .checked_sub(swap_computation.amount_out)
                .ok_or(ErrorCode::AmountRemainingOverflow)?;

            amount_calculated = amount_calculated
                .checked_add(swap_computation.amount_in)
                .ok_or(ErrorCode::AmountCalcOverflow)?;
            amount_calculated = amount_calculated
                .checked_add(swap_computation.fee_amount)
                .ok_or(ErrorCode::AmountCalcOverflow)?;
        }

        gate_fee_value_b = gate_fee_value_b.saturating_add(crate::state::gate::step_fee_value_b(
            swap_computation.fee_amount,
            curr_sqrt_price,
            a_to_b,
        ));

        let (next_protocol_fee, next_fee_growth_global_input) = calculate_fees(
            swap_computation.fee_amount,
            protocol_fee_rate,
            curr_liquidity,
            curr_protocol_fee,
            curr_fee_growth_global_input,
        );
        curr_protocol_fee = next_protocol_fee;
        curr_fee_growth_global_input = next_fee_growth_global_input;

        if swap_computation.next_price == next_tick_sqrt_price {
            let (next_tick, next_tick_initialized) = swap_tick_sequence
                .get_tick(next_array_index, next_tick_index, tick_spacing)
                .map_or_else(|_| (None, false), |tick| (Some(tick), tick.initialized));

            if next_tick_initialized {
                let (fee_growth_global_a, fee_growth_global_b) = if a_to_b {
                    (curr_fee_growth_global_input, solve.fee_growth_global_b)
                } else {
                    (solve.fee_growth_global_a, curr_fee_growth_global_input)
                };

                let (update, next_liquidity) = calculate_update(
                    next_tick.unwrap(),
                    a_to_b,
                    curr_liquidity,
                    fee_growth_global_a,
                    fee_growth_global_b,
                    &next_reward_infos,
                )?;

                curr_liquidity = next_liquidity;
                swap_tick_sequence.update_tick(
                    next_array_index,
                    next_tick_index,
                    tick_spacing,
                    &update,
                )?;
            }

            let tick_offset = swap_tick_sequence.get_tick_offset(
                next_array_index,
                next_tick_index,
                tick_spacing,
            )?;

            // Increment to the next tick array if either condition is true:
            //  - Price is moving left and the current tick is the start of the tick array
            //  - Price is moving right and the current tick is the end of the tick array
            curr_array_index = if (a_to_b && tick_offset == 0)
                || (!a_to_b && tick_offset == TICK_ARRAY_SIZE as isize - 1)
            {
                next_array_index + 1
            } else {
                next_array_index
            };

            // The get_init_tick search is inclusive of the current index in an a_to_b trade.
            // We therefore have to shift the index by 1 to advance to the next init tick to the left.
            curr_tick_index = if a_to_b {
                next_tick_index - 1
            } else {
                next_tick_index
            };
        } else if swap_computation.next_price != curr_sqrt_price {
            curr_tick_index = tick_index_from_sqrt_price(&swap_computation.next_price);
        }

        curr_sqrt_price = swap_computation.next_price;
    }

    // Reject partial fills if no explicit sqrt price limit is set and trade is exact out mode
    if amount_remaining > 0
        && !amount_specified_is_input
        && sqrt_price_limit == NO_EXPLICIT_SQRT_PRICE_LIMIT
    {
        return Err(ErrorCode::PartialFillError.into());
    }

    let (amount_a, amount_b) = if a_to_b == amount_specified_is_input {
        (amount - amount_remaining, amount_calculated)
    } else {
        (amount_calculated, amount - amount_remaining)
    };

    let fee_growth = if a_to_b {
        curr_fee_growth_global_input - solve.fee_growth_global_a
    } else {
        curr_fee_growth_global_input - solve.fee_growth_global_b
    };

    // Log delta in fee growth to track pool usage over time with off-chain analytics
    msg!("fee_growth: {}", fee_growth);

    Ok(PostSwapUpdate {
        amount_a,
        amount_b,
        next_liquidity: curr_liquidity,
        next_tick_index: curr_tick_index,
        next_sqrt_price: curr_sqrt_price,
        next_fee_growth_global: curr_fee_growth_global_input,
        next_reward_infos,
        next_protocol_fee: curr_protocol_fee,
        gate_fee_value_b,
    })
}

fn calculate_fees(
    fee_amount: u64,
    protocol_fee_rate: u16,
    curr_liquidity: u128,
    curr_protocol_fee: u64,
    curr_fee_growth_global_input: u128,
) -> (u64, u128) {
    let mut next_protocol_fee = curr_protocol_fee;
    let mut next_fee_growth_global_input = curr_fee_growth_global_input;
    let mut global_fee = fee_amount;
    if protocol_fee_rate > 0 {
        let delta = calculate_protocol_fee(global_fee, protocol_fee_rate);
        global_fee -= delta;
        next_protocol_fee = next_protocol_fee.wrapping_add(delta);
    }

    if curr_liquidity > 0 {
        next_fee_growth_global_input = next_fee_growth_global_input
            .wrapping_add(((global_fee as u128) << Q64_RESOLUTION) / curr_liquidity);
    }
    (next_protocol_fee, next_fee_growth_global_input)
}

fn calculate_protocol_fee(global_fee: u64, protocol_fee_rate: u16) -> u64 {
    ((global_fee as u128) * (protocol_fee_rate as u128) / PROTOCOL_FEE_RATE_MUL_VALUE)
        .try_into()
        .unwrap()
}

fn calculate_update(
    tick: &Tick,
    a_to_b: bool,
    liquidity: u128,
    fee_growth_global_a: u128,
    fee_growth_global_b: u128,
    reward_infos: &[SolveRewardInfo; NUM_REWARDS],
) -> Result<(TickUpdate, u128)> {
    // Use updated fee_growth for crossing tick
    // Use -liquidity_net if going left, +liquidity_net going right
    let signed_liquidity_net = if a_to_b {
        -tick.liquidity_net
    } else {
        tick.liquidity_net
    };

    let update =
        next_tick_cross_update(tick, fee_growth_global_a, fee_growth_global_b, reward_infos)?;

    // Update the global liquidity to reflect the new current tick
    let next_liquidity = add_liquidity_delta(liquidity, signed_liquidity_net)?;

    Ok((update, next_liquidity))
}

fn get_next_sqrt_prices(
    next_tick_index: i32,
    sqrt_price_limit: u128,
    a_to_b: bool,
) -> (u128, u128) {
    let next_tick_price = sqrt_price_from_tick_index(next_tick_index);
    let next_sqrt_price_limit = if a_to_b {
        sqrt_price_limit.max(next_tick_price)
    } else {
        sqrt_price_limit.min(next_tick_price)
    };
    (next_tick_price, next_sqrt_price_limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_gauge_routes_all_fees_without_lp_fee_growth() {
        let (protocol_fee, fee_growth) = calculate_fees(
            1_000,
            MAX_PROTOCOL_FEE_RATE,
            1u128 << Q64_RESOLUTION,
            0,
            0,
        );

        assert_eq!(protocol_fee, 1_000);
        assert_eq!(fee_growth, 0);
        let (protocol_fee, fee_growth) = calculate_fees(1_000, 0, 1u128 << Q64_RESOLUTION, 0, 0);
        assert_eq!(protocol_fee, 0);
        assert_eq!(fee_growth, 1_000);
    }
}
