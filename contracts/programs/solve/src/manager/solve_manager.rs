use crate::errors::ErrorCode;
use crate::math::{add_liquidity_delta, checked_mul_div};
use crate::state::*;

// Calculates the next global reward growth variables based on the given timestamp.
// The provided timestamp must be greater than or equal to the last updated timestamp.
pub fn next_solve_reward_infos(
    solve: &Solve,
    next_timestamp: u64,
) -> Result<[SolveRewardInfo; NUM_REWARDS], ErrorCode> {
    let curr_timestamp = solve.reward_last_updated_timestamp;
    if next_timestamp < curr_timestamp {
        return Err(ErrorCode::InvalidTimestamp);
    }

    // No-op if no liquidity or no change in timestamp
    if solve.liquidity == 0 || next_timestamp == curr_timestamp {
        return Ok(solve.reward_infos);
    }

    // Calculate new global reward growth
    let mut next_reward_infos = solve.reward_infos;
    for (index, reward_info) in next_reward_infos.iter_mut().enumerate() {
        if !reward_info.initialized() {
            continue;
        }

        // Stop at the on-chain epoch boundary even if the keeper is offline.
        // A tick crossing checkpoints growth before changing active liquidity,
        // so out-of-range positions earn none of the subsequent interval.
        // Gauge emissions clip at the on-chain schedule end even if the keeper
        // is offline, and only the seconds the activity gate was open count.
        let time_delta = if index == 0 && solve.has_gauge_reward() {
            u128::from(solve.gauge_earnable_seconds(next_timestamp).map_or(0, |(earnable, _)| earnable))
        } else {
            u128::from(next_timestamp - curr_timestamp)
        };

        // Calculate the new reward growth delta.
        // If the calculation overflows, set the delta value to zero.
        // This will halt reward distributions for this reward.
        let reward_growth_delta = checked_mul_div(
            time_delta,
            reward_info.emissions_per_second_x64,
            solve.liquidity,
        )
        .unwrap_or(0);

        // Add the reward growth delta to the global reward growth.
        let curr_growth_global = reward_info.growth_global_x64;
        reward_info.growth_global_x64 = curr_growth_global.wrapping_add(reward_growth_delta);
    }

    Ok(next_reward_infos)
}

// Calculates the next global liquidity for a solve depending on its position relative
// to the lower and upper tick indexes and the liquidity_delta.
pub fn next_solve_liquidity(
    solve: &Solve,
    tick_upper_index: i32,
    tick_lower_index: i32,
    liquidity_delta: i128,
) -> Result<u128, ErrorCode> {
    if solve.tick_current_index < tick_upper_index
        && solve.tick_current_index >= tick_lower_index
    {
        add_liquidity_delta(solve.liquidity, liquidity_delta)
    } else {
        Ok(solve.liquidity)
    }
}

#[cfg(test)]
mod native_gauge_tests {
    use super::*;
    use crate::manager::tick_manager::{next_reward_growths_inside, next_tick_cross_update};
    use anchor_lang::prelude::Pubkey;

    fn pool() -> Solve {
        let mut pool = Solve { liquidity: 400, ..Default::default() };
        pool.set_gauge_reward_schedule(Pubkey::new_unique(), Pubkey::new_unique(), 10u128 << 64, 100, 0, 0).unwrap();
        pool
    }
    fn advance(pool: &mut Solve, now: u64) {
        let next = next_solve_reward_infos(pool, now).unwrap();
        pool.update_rewards(next, now);
    }

    #[test]
    fn weekly_budget_is_liquidity_weighted_even_with_zero_lp_fees() {
        let mut pool = pool();
        pool.update_protocol_fee_rate(10_000).unwrap();
        advance(&mut pool, 100);
        let growth = pool.reward_infos[0].growth_global_x64;
        assert_eq!((growth * 100) >> 64, 250);
        assert_eq!((growth * 300) >> 64, 750);
        assert_eq!(pool.fee_growth_global_a, 0);
        advance(&mut pool, 1_000_000);
        assert_eq!(pool.reward_infos[0].growth_global_x64, growth, "an offline keeper cannot extend the week");
    }

    #[test]
    fn tick_exit_and_reentry_exclude_out_of_range_time() {
        let mut pool = pool();
        let lower = Tick { initialized: true, ..Default::default() };
        let mut upper = Tick { initialized: true, ..Default::default() };
        advance(&mut pool, 40);
        upper.update(&next_tick_cross_update(&upper, 0, 0, &pool.reward_infos).unwrap());
        pool.tick_current_index = 10; pool.liquidity = 300;
        advance(&mut pool, 70);
        let inside = next_reward_growths_inside(10, &lower, -10, &upper, 10, &pool.reward_infos)[0];
        assert_eq!((inside * 100) >> 64, 100, "position earns only before crossing its upper tick");
        upper.update(&next_tick_cross_update(&upper, 0, 0, &pool.reward_infos).unwrap());
        pool.tick_current_index = 9; pool.liquidity = 400;
        advance(&mut pool, 100);
        let inside = next_reward_growths_inside(9, &lower, -10, &upper, 10, &pool.reward_infos)[0];
        assert_eq!((inside * 100) >> 64, 175, "reentry earns from the crossing, never retroactively");
    }

    #[test]
    fn deactivation_preserves_earned_growth_and_stops_new_rewards() {
        let mut pool = pool();
        advance(&mut pool, 40);
        let earned = pool.reward_infos[0].growth_global_x64;
        pool.set_gauge_reward_schedule(pool.reward_infos[0].mint, pool.reward_infos[0].vault, 0, 40, 40, 0).unwrap();
        pool.update_protocol_fee_rate(0).unwrap();
        advance(&mut pool, 100);
        assert_eq!(pool.reward_infos[0].growth_global_x64, earned);
        assert_eq!(pool.protocol_fee_rate, 0);
    }

    #[test]
    fn no_liquidity_does_not_create_future_backpay() {
        let mut pool = pool(); pool.liquidity = 0;
        advance(&mut pool, 40); pool.liquidity = 400;
        advance(&mut pool, 100);
        assert_eq!((pool.reward_infos[0].growth_global_x64 * 400) >> 64, 600);
    }

    #[test]
    fn unearned_plus_earned_equals_funded_and_burn_clears_it() {
        let mut pool = pool(); pool.liquidity = 0;
        advance(&mut pool, 40); pool.liquidity = 400;
        advance(&mut pool, 100);
        let earned = (pool.reward_infos[0].growth_global_x64 * 400) >> 64;
        assert_eq!(pool.gauge_unearned_whole_tokens(), 400);
        assert_eq!(earned + u128::from(pool.gauge_unearned_whole_tokens()), 1_000);
        pool.record_gauge_unearned_burned(400);
        assert_eq!(pool.gauge_unearned_x64(), 0);
        // the schedule end stored beside the counter is untouched
        assert_eq!(pool.gauge_reward_end_timestamp(), Some(100));
    }

    #[test]
    fn unearned_stops_at_schedule_end_and_never_accrues_with_liquidity() {
        let mut pool = pool(); pool.liquidity = 0;
        advance(&mut pool, 250);
        assert_eq!(pool.gauge_unearned_whole_tokens(), 1_000);
        advance(&mut pool, 400);
        assert_eq!(pool.gauge_unearned_whole_tokens(), 1_000);
        let mut busy = self::pool();
        advance(&mut busy, 100);
        assert_eq!(busy.gauge_unearned_x64(), 0);
    }

    #[test]
    fn partial_burn_keeps_the_fraction() {
        let mut pool = pool(); pool.liquidity = 0;
        pool.reward_infos[0].emissions_per_second_x64 = (3u128 << 64) / 2;
        advance(&mut pool, 3);
        assert_eq!(pool.gauge_unearned_whole_tokens(), 4);
        pool.record_gauge_unearned_burned(4);
        assert_eq!(pool.gauge_unearned_x64(), 1u128 << 63);
    }

    fn gated_pool(phi_ppm: u32) -> Solve {
        let mut pool = Solve { liquidity: 400, ..Default::default() };
        pool.set_gauge_reward_schedule(Pubkey::new_unique(), Pubkey::new_unique(), 10u128 << 64, 3 * 3_600, 0, phi_ppm).unwrap();
        pool
    }

    #[test]
    fn closed_gate_earns_nothing_and_everything_is_unearned() {
        let mut pool = gated_pool(100);
        advance(&mut pool, 3_600);
        assert_eq!(pool.reward_infos[0].growth_global_x64, 0);
        assert_eq!(pool.gauge_unearned_whole_tokens(), 36_000);
    }

    // Hour-scale offsets assume the 3600 s release bucket (fast-epochs uses 7 s).
    #[cfg(not(feature = "fast-epochs"))]
    #[test]
    fn a_productive_hour_opens_the_next_hour_only() {
        let mut pool = gated_pool(100);
        advance(&mut pool, 1_800);
        let thr = pool.gate_state().unwrap().threshold_acc();
        pool.record_gate_yield(thr);
        advance(&mut pool, 7_200);
        let earned = (pool.reward_infos[0].growth_global_x64 * 400) >> 64;
        assert_eq!(earned, 36_000, "hour 1 earned, hour 0 did not");
        assert_eq!(pool.gauge_unearned_whole_tokens(), 36_000);
        assert_eq!(earned + u128::from(pool.gauge_unearned_whole_tokens()), 72_000);
        // no yield in hour 1 closes hour 2
        advance(&mut pool, 10_800);
        assert_eq!((pool.reward_infos[0].growth_global_x64 * 400) >> 64, 36_000);
        assert_eq!(pool.gauge_unearned_whole_tokens(), 72_000);
    }

    // Hour-scale offsets assume the 3600 s release bucket (fast-epochs uses 7 s).
    #[cfg(not(feature = "fast-epochs"))]
    #[test]
    fn gate_state_survives_reward_overwrites_and_zero_threshold_disables_it() {
        let mut pool = gated_pool(100);
        advance(&mut pool, 100);
        pool.record_gate_yield(7);
        advance(&mut pool, 200);
        assert_eq!(pool.gate_state().unwrap().acc, 7);
        assert_eq!(pool.gate_state().unwrap().phi_ppm, 100);
        let mut off = gated_pool(0);
        advance(&mut off, 3_600);
        assert_eq!((off.reward_infos[0].growth_global_x64 * 400) >> 64, 36_000);
        assert_eq!(off.gauge_unearned_x64(), 0);
    }

    #[test]
    fn enabling_requires_unused_reward_and_migrated_extension() {
        let mut pool = Solve::default();
        assert!(pool.update_protocol_fee_rate(10_000).is_err());
        // slots 1 and 2 hold their authority bytes, which a schedule would overwrite:
        // a third-party reward already living there blocks enabling.
        pool.reward_infos[2].mint = Pubkey::new_unique();
        assert!(pool.set_gauge_reward_schedule(Pubkey::new_unique(), Pubkey::new_unique(), 0, 0, 0, 0).is_err());
        pool.reward_infos[2].mint = Pubkey::default();
        pool.reward_infos[0].mint = Pubkey::new_unique();
        assert!(pool.set_gauge_reward_schedule(Pubkey::new_unique(), Pubkey::new_unique(), 0, 0, 0, 0).is_err());
        let mut managed = super::native_gauge_tests::pool();
        assert!(managed.initialize_reward(0, Pubkey::new_unique(), Pubkey::new_unique()).is_err());
        assert!(managed.update_emissions(0, managed.reward_infos, 0, 100).is_err());
        assert!(managed.update_protocol_fee_rate(10_001).is_err());
        assert!(managed.initialize_reward(1, Pubkey::new_unique(), Pubkey::new_unique()).is_ok(), "other reward slots remain available");
        // the secondary extension now holds only the activity gate record
        assert!(managed.gate_state().is_some());
        assert_eq!(managed.reward_infos[2].mint, Pubkey::default());
    }
}

