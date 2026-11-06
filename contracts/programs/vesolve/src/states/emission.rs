use anchor_lang::prelude::*;
use crate::constants::{
    BPS_DENOMINATOR, DEVELOPER_ALLOCATION_BPS, EMISSION_DECAY_DENOMINATOR,
    EMISSION_DECAY_NUMERATOR, INITIAL_WEEKLY_EMISSION,
};
use crate::errors::ErrorCode;

pub fn weekly_emission(epoch: u64) -> Result<u64> {
    // Full Launch rule B2: E(n+1) = floor(E(n) * 98 / 100), deterministic
    // round-down at token precision, indefinitely. The recurrence is the
    // definition; a closed-form fixed-point power is not equivalent (it drifts
    // above the recurrence by a few base units from epoch 11). The schedule
    // reaches zero after roughly 1,700 epochs, so the loop is bounded and
    // exits early once nothing remains to decay.
    // u64 throughout: 1.3e15 * 98 stays far below u64::MAX, and native 64-bit
    // division keeps the worst case (~1,700 iterations) cheap on-chain.
    let numerator = u64::try_from(EMISSION_DECAY_NUMERATOR).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let denominator = u64::try_from(EMISSION_DECAY_DENOMINATOR).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let mut emission = INITIAL_WEEKLY_EMISSION;
    let mut remaining = epoch;
    while remaining > 0 && emission > 0 {
        emission = emission
            .checked_mul(numerator)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            / denominator;
        remaining -= 1;
    }
    Ok(emission)
}

pub fn emission_split(epoch: u64) -> Result<(u64, u64, u64)> {
    let total = weekly_emission(epoch)?;
    let developer = total
        .checked_mul(DEVELOPER_ALLOCATION_BPS)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let gauges = total
        .checked_sub(developer)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((total, gauges, developer))
}

#[account]
#[derive(InitSpace)]
pub struct EpochEmission {
    pub epoch: u64,
    pub total_emission: u64,
    pub gauge_budget: u64,
    pub developer_allocation: u64,
    pub distributed_to_gauges: u64,
    pub developer_wallet: Pubkey,
    pub bump: u8,
}

/// Integer square root via Newton's method. Used to combine a position's two
/// fee streams (token A and token B, generally different tokens with no
/// shared price) into one scale-invariant weight without needing an oracle —
/// the same trick Uniswap V2 uses for LP share value via sqrt(x*y).
pub fn isqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

#[account]
#[derive(InitSpace)]
pub struct GaugeReward {
    pub gauge: Pubkey,
    pub reward_mint: Pubkey,
    // Sum of every active stake's current weight (see GaugeStake::weight) —
    // NOT raw liquidity. Renamed from total_staked_liquidity when rewards
    // moved from liquidity-weighted to fee-generation-weighted.
    pub total_weight: u128,
    pub reward_rate_x64: u128,
    pub reward_per_weight_x64: u128,
    pub last_update_time: i64,
    pub period_finish: i64,
    pub last_funded_epoch: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct GaugeStake {
    pub owner: Pubkey,
    pub gauge: Pubkey,
    pub position: Pubkey,
    pub position_mint: Pubkey,
    // Informational only (the position's liquidity at stake time) — no
    // longer used in the reward math.
    pub liquidity: u128,
    // This stake's current contribution to reward.total_weight. Zero
    // whenever the position is out of range (is_paused) or hasn't realized
    // any new fees since its last sync.
    pub weight: u128,
    pub reward_per_weight_paid_x64: u128,
    pub accrued_rewards: u64,
    // Position.fee_owed_a/b as of the last sync, so sync() can compute how
    // much NEW fee activity happened since then rather than double-counting
    // the position's whole lifetime total on every call.
    pub last_fee_owed_a: u64,
    pub last_fee_owed_b: u64,
    // True whenever the position was out of range as of the last sync —
    // means this stake is contributing zero weight and earning nothing.
    pub is_paused: bool,
    pub staked_at: i64,
    pub bump: u8,
}

impl GaugeReward {
    pub fn checkpoint(&mut self, now: i64) -> Result<()> {
        let applicable_time = now.min(self.period_finish);
        if applicable_time <= self.last_update_time {
            return Ok(());
        }
        if self.total_weight > 0 && self.reward_rate_x64 > 0 {
            let elapsed = u128::try_from(applicable_time - self.last_update_time)
                .map_err(|_| ErrorCode::ArithmeticOverflow)?;
            let increment = self.reward_rate_x64
                .checked_mul(elapsed)
                .ok_or(ErrorCode::ArithmeticOverflow)?
                .checked_div(self.total_weight)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            self.reward_per_weight_x64 = self.reward_per_weight_x64
                .checked_add(increment)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        self.last_update_time = applicable_time;
        Ok(())
    }

    pub fn start_period(&mut self, amount: u64, now: i64, finish: i64, epoch: u64) -> Result<()> {
        require!(finish > now, ErrorCode::InvalidEpoch);
        // checkpoint() consumes the OLD reward_rate_x64 for whatever elapsed
        // between last_update_time and now (capped at the old period_finish)
        // before we overwrite it below.
        self.checkpoint(now)?;
        let duration = u128::try_from(finish - now)
            .map_err(|_| ErrorCode::ArithmeticOverflow)?;

        // If the previous period hasn't finished yet, its rate still has
        // reward left to emit between `now` and the old period_finish.
        // Overwriting reward_rate_x64 outright would silently orphan that
        // remainder — nothing would ever account for it again once
        // period_finish is replaced. Fold it into the new rate instead, the
        // same way Synthetix's StakingRewards.notifyRewardAmount carries a
        // still-active period's leftover into a freshly funded one.
        let leftover_x64 = if now < self.period_finish {
            let remaining = u128::try_from(self.period_finish - now)
                .map_err(|_| ErrorCode::ArithmeticOverflow)?;
            self.reward_rate_x64
                .checked_mul(remaining)
                .ok_or(ErrorCode::ArithmeticOverflow)?
        } else {
            0
        };

        self.reward_rate_x64 = (amount as u128)
            .checked_shl(64)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_add(leftover_x64)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_div(duration)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.last_update_time = now;
        self.period_finish = finish;
        self.last_funded_epoch = epoch;
        Ok(())
    }
}

impl GaugeStake {
    /// Credits whatever this stake earned at its OLD weight up through now,
    /// then recomputes its weight from real, newly-realized fee activity
    /// (zero if out of range) and updates reward.total_weight to match.
    /// Called from stake/claim/unstake and from the standalone permissionless
    /// sync_stake instruction (so a keeper — or anyone — can pause a
    /// position's accrual promptly after it drifts out of range, rather than
    /// only whenever its owner happens to interact with it again).
    pub fn sync(
        &mut self,
        reward: &mut GaugeReward,
        now: i64,
        in_range: bool,
        fee_owed_a: u64,
        fee_owed_b: u64,
    ) -> Result<()> {
        reward.checkpoint(now)?;

        let delta = reward.reward_per_weight_x64
            .checked_sub(self.reward_per_weight_paid_x64)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let newly_earned = self.weight
            .checked_mul(delta)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_shr(64)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.accrued_rewards = self.accrued_rewards
            .checked_add(u64::try_from(newly_earned).map_err(|_| ErrorCode::ArithmeticOverflow)?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        // fee_owed only ever grows between the owner's own collect_fees
        // calls; a decrease means they collected since our last snapshot,
        // which we can no longer see — treat it as zero new activity for
        // this sync rather than underflowing. This under-counts the window
        // in which a collect happened, but never double-counts or panics.
        let delta_a = fee_owed_a.saturating_sub(self.last_fee_owed_a);
        let delta_b = fee_owed_b.saturating_sub(self.last_fee_owed_b);
        self.last_fee_owed_a = fee_owed_a;
        self.last_fee_owed_b = fee_owed_b;

        let new_weight = if in_range {
            isqrt(
                (delta_a as u128)
                    .checked_mul(delta_b as u128)
                    .ok_or(ErrorCode::ArithmeticOverflow)?,
            )
        } else {
            0
        };

        reward.total_weight = reward.total_weight
            .checked_sub(self.weight)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_add(new_weight)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.weight = new_weight;
        self.reward_per_weight_paid_x64 = reward.reward_per_weight_x64;
        self.is_paused = !in_range;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emissions_follow_published_compounded_decay() {
        assert_eq!(weekly_emission(0).unwrap(), 1_300_000_000_000_000);
        assert_eq!(weekly_emission(1).unwrap(), 1_274_000_000_000_000);
        assert_eq!(weekly_emission(2).unwrap(), 1_248_520_000_000_000);
    }

    #[test]
    fn emissions_match_the_floor_recurrence_at_every_epoch() {
        // Independent restatement of B2 with the first drift epoch (11) pinned.
        let mut expected: u128 = 1_300_000_000_000_000;
        for epoch in 0..=5_000u64 {
            assert_eq!(weekly_emission(epoch).unwrap() as u128, expected, "epoch {epoch}");
            expected = expected * 98 / 100;
        }
        assert_eq!(weekly_emission(11).unwrap(), 1_040_950_755_974_733);
    }

    #[test]
    fn emissions_never_increase_and_terminate_at_zero() {
        let mut previous = weekly_emission(0).unwrap();
        for epoch in 1..=2_000u64 {
            let current = weekly_emission(epoch).unwrap();
            assert!(current <= previous);
            previous = current;
        }
        assert_eq!(weekly_emission(2_000).unwrap(), 0);
        assert_eq!(weekly_emission(u64::MAX).unwrap(), 0);
    }

    #[test]
    fn developer_allocation_is_four_percent_of_weekly_total() {
        let (total, gauges, developer) = emission_split(0).unwrap();
        assert_eq!(developer, 52_000_000_000_000);
        assert_eq!(gauges, 1_248_000_000_000_000);
        assert_eq!(total, gauges + developer);
    }

    #[test]
    fn lifetime_minting_stays_inside_the_schedule_whatever_the_votes() {
        // Pseudo-random vote splits every epoch: developer share plus all gauge
        // budgets never exceed the scheduled emission, and the sum over the whole
        // schedule never passes the geometric bound 1.3M / 0.02 = 65M SOLV3.
        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let mut lifetime: u128 = 0;
        for epoch in 0..2_100u64 {
            let (total, gauges, developer) = emission_split(epoch).unwrap();
            let count = 1 + next() % 12;
            let votes: Vec<u64> = (0..count).map(|_| 1 + next() % 1_000_000_000_000).collect();
            let all: u128 = votes.iter().map(|v| *v as u128).sum();
            let budgets: u128 = votes.iter().map(|v| gauges as u128 * *v as u128 / all).sum();
            assert!(budgets <= gauges as u128, "epoch {epoch}");
            assert!(developer as u128 + budgets <= total as u128, "epoch {epoch}");
            lifetime += developer as u128 + budgets;
        }
        assert!(lifetime <= 65_000_000_000_000_000, "lifetime {lifetime}");
    }

    #[test]
    fn final_vote_weight_assigns_gauge_budget() {
        let (_, gauges, _) = emission_split(1).unwrap();
        let bonk = (gauges as u128 * 6_800u128 / 20_000u128) as u64;
        assert_eq!(bonk, 415_833_600_000_000);
    }

    fn test_reward(total_weight: u128) -> GaugeReward {
        GaugeReward {
            gauge: Pubkey::default(), reward_mint: Pubkey::default(),
            total_weight, reward_rate_x64: 0,
            reward_per_weight_x64: 0, last_update_time: 0,
            period_finish: 0, last_funded_epoch: 0, bump: 0,
        }
    }

    fn test_stake(weight: u128) -> GaugeStake {
        GaugeStake {
            owner: Pubkey::default(), gauge: Pubkey::default(), position: Pubkey::default(),
            position_mint: Pubkey::default(), liquidity: 0, weight,
            reward_per_weight_paid_x64: 0, accrued_rewards: 0,
            last_fee_owed_a: 0, last_fee_owed_b: 0, is_paused: false,
            staked_at: 0, bump: 0,
        }
    }

    #[test]
    fn isqrt_matches_known_values() {
        assert_eq!(isqrt(0), 0);
        assert_eq!(isqrt(1), 1);
        assert_eq!(isqrt(99), 9);
        assert_eq!(isqrt(100), 10);
        assert_eq!(isqrt(10_000), 100);
    }

    #[test]
    fn weight_earns_pro_rata_of_the_reward_stream() {
        let mut reward = test_reward(400);
        reward.start_period(1_000, 0, 100, 1).unwrap();
        reward.checkpoint(100).unwrap();
        let mut stake = test_stake(100);
        stake.reward_per_weight_paid_x64 = 0;
        // Direct low-level checkpoint math (no sync/position involved) --
        // confirms the streaming formula itself is unaffected by the
        // liquidity -> fee-weight rename.
        let delta = reward.reward_per_weight_x64 - stake.reward_per_weight_paid_x64;
        let earned = (stake.weight * delta) >> 64;
        assert_eq!(earned, 250);
    }

    #[test]
    fn start_period_carries_forward_an_unfinished_periods_remainder() {
        let mut reward = test_reward(0);
        // 1,000 over 100s -> old_rate = (1000 << 64) / 100.
        reward.start_period(1_000, 0, 100, 1).unwrap();
        let old_rate = reward.reward_rate_x64;

        // Re-funded halfway through the still-active period: 500 of the
        // original 1,000 remain unspent (50 of 100 seconds elapsed).
        // Without carrying that forward, this 500 would be silently
        // orphaned in the vault the moment period_finish is overwritten.
        reward.start_period(500, 50, 150, 2).unwrap();

        // New rate covers the fresh 500 plus the carried-forward 500 over
        // the new 100s window -- 1,000 total over 100s is the same rate as
        // the original, uninterrupted period.
        assert_eq!(reward.reward_rate_x64, old_rate);
        assert_eq!(reward.period_finish, 150);
        assert_eq!(reward.last_funded_epoch, 2);
    }

    #[test]
    fn start_period_ignores_remainder_once_the_old_period_has_finished() {
        let mut reward = test_reward(0);
        reward.start_period(1_000, 0, 100, 1).unwrap();
        let old_rate = reward.reward_rate_x64;

        // Funded well after the old period_finish (100) -- nothing left to
        // carry forward, so the new rate is exactly the new amount/duration.
        reward.start_period(1_000, 200, 300, 2).unwrap();

        assert_eq!(reward.reward_rate_x64, old_rate);
    }

    #[test]
    fn sync_credits_old_weight_then_reweights_by_new_fee_activity() {
        let mut reward = test_reward(100);
        reward.start_period(1_000, 0, 100, 1).unwrap();
        // Establish a nonzero baseline weight as if a previous sync had run.
        let mut stake = test_stake(100);

        reward.checkpoint(50).unwrap();
        // in_range, delta_a=9, delta_b=16 -> isqrt(144) = 12
        stake.sync(&mut reward, 50, true, 9, 16).unwrap();

        // Credited at the OLD weight (100) for the first half of the period.
        assert_eq!(stake.accrued_rewards, 500);
        // Reweighted from realized fee activity.
        assert_eq!(stake.weight, 12);
        assert_eq!(stake.last_fee_owed_a, 9);
        assert_eq!(stake.last_fee_owed_b, 16);
        assert!(!stake.is_paused);
        // total_weight reflects the new weight (100 removed, 12 added).
        assert_eq!(reward.total_weight, 12);
    }

    #[test]
    fn sync_zeroes_weight_and_pauses_when_out_of_range() {
        let mut reward = test_reward(100);
        reward.start_period(1_000, 0, 100, 1).unwrap();
        let mut stake = test_stake(100);

        stake.sync(&mut reward, 10, false, 5, 5).unwrap();

        assert_eq!(stake.weight, 0);
        assert!(stake.is_paused);
        assert_eq!(reward.total_weight, 0);
    }

    #[test]
    fn sync_ignores_a_fee_owed_decrease_from_the_owner_collecting() {
        let mut reward = test_reward(0);
        reward.start_period(1_000, 0, 100, 1).unwrap();
        let mut stake = test_stake(0);
        stake.last_fee_owed_a = 50;
        stake.last_fee_owed_b = 50;

        // fee_owed dropped (owner called collect_fees) -- treated as zero
        // new activity, not a panic or a negative weight.
        stake.sync(&mut reward, 10, true, 5, 5).unwrap();

        assert_eq!(stake.weight, 0);
        assert_eq!(stake.last_fee_owed_a, 5);
        assert_eq!(stake.last_fee_owed_b, 5);
    }
}
