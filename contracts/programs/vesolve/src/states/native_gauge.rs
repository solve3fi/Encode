use anchor_lang::prelude::*;
use crate::errors::ErrorCode;

pub const NATIVE_GAUGE_SEED: &[u8] = b"native_gauge";

/// Versioned separately from GaugeReward: legacy liabilities stay in the old
/// vault and can never earn a second share of the new native LP stream.
#[account]
#[derive(InitSpace, Default)]
pub struct NativeGauge {
    pub gauge: Pubkey,
    pub pool: Pubkey,
    pub reward_vault: Pubkey,
    pub last_funded_epoch: u64,
    pub rate_x64: u128,
    pub period_finish: i64,
    pub carry_amount: u64,
    pub bump: u8,
}

pub fn remaining_stream(rate: u128, finish: i64, now: i64) -> Result<u64> {
    let seconds = finish.saturating_sub(now).max(0) as u128;
    let amount = rate.checked_mul(seconds).ok_or(ErrorCode::ArithmeticOverflow)? >> 64;
    u64::try_from(amount).map_err(|_| ErrorCode::ArithmeticOverflow.into())
}

pub fn stream_rate(amount: u64, now: i64, finish: i64) -> Result<u128> {
    require!(finish > now, ErrorCode::InvalidEpoch);
    Ok(((amount as u128) << 64) / (finish - now) as u128)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stream_stops_and_conserves_budget() {
        let rate = stream_rate(1_000, 0, 100).unwrap();
        assert_eq!(remaining_stream(rate, 100, 40).unwrap(), 600);
        assert_eq!(remaining_stream(rate, 100, 100).unwrap(), 0);
        assert_eq!(remaining_stream(rate, 100, 200).unwrap(), 0);
        assert!(stream_rate(1, 100, 100).is_err());
        assert!(remaining_stream(u128::MAX, 3, 0).is_err());
    }
    #[test]
    fn rate_rounding_never_spends_more_than_allocated() {
        for amount in [1, 17, 1_300_000_000_000_000, u64::MAX] {
            for duration in [1, 7, 604_800] {
                let rate = stream_rate(amount, 0, duration).unwrap();
                assert!(remaining_stream(rate, duration, 0).unwrap() <= amount);
            }
        }
    }
}
