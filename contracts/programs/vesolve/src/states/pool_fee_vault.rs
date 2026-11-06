use anchor_lang::prelude::*;
use crate::errors::ErrorCode;
use crate::states::emission::isqrt;

/// Holds a pool's share of swept protocol trading fees for LPs to claim
/// directly, for pools that don't (yet) have a Gauge. Once a Gauge exists,
/// new fee sweeps are expected to go through distribute_pool_reward instead
/// -- this vault isn't disabled automatically (nothing here reads Gauge
/// state), it simply stops receiving new funding once an admin/keeper
/// switches which instruction they call. Existing balances here stay
/// claimable either way.
#[account]
#[derive(InitSpace)]
pub struct PoolFeeVault {
    pub pool: Pubkey,
    pub token_mint_a: Pubkey,
    pub token_mint_b: Pubkey,
    // Sum of every registered position's current weight (see
    // PoolFeePosition::weight) -- same fee-generation-weighted design as
    // GaugeReward/GaugeStake, just funded in discrete lump sums (whenever
    // someone sweeps protocol fees in) rather than a continuous rate.
    pub total_weight: u128,
    pub reward_per_weight_a_x64: u128,
    pub reward_per_weight_b_x64: u128,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PoolFeePosition {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub position: Pubkey,
    pub position_mint: Pubkey,
    pub weight: u128,
    pub reward_per_weight_a_paid_x64: u128,
    pub reward_per_weight_b_paid_x64: u128,
    pub accrued_a: u64,
    pub accrued_b: u64,
    // Position.fee_owed_a/b as of the last sync, so sync() measures NEW
    // fee activity since then rather than the position's whole lifetime
    // total -- same reasoning as GaugeStake's identical fields.
    pub last_fee_owed_a: u64,
    pub last_fee_owed_b: u64,
    pub is_paused: bool,
    pub registered_at: i64,
    pub bump: u8,
}

impl PoolFeeVault {
    /// Folds a swept lump sum into the per-weight index. Unlike
    /// GaugeReward's continuous reward_rate_x64, there's no time dimension
    /// here -- each fund() call is a discrete deposit, indexed against
    /// whatever total_weight is registered *right now*.
    ///
    /// Requires total_weight > 0 rather than silently absorbing the deposit
    /// into an index nobody can move: a lump sum funded while total_weight
    /// is 0 would permanently vanish (no future sync moves the index
    /// retroactively for a position that registers later), unlike
    /// GaugeReward's continuous rate, which at least keeps distributing
    /// once total_weight becomes nonzero again within the same period.
    pub fn fund(&mut self, amount_a: u64, amount_b: u64) -> Result<()> {
        require!(self.total_weight > 0, ErrorCode::PoolFeeVaultHasNoRegisteredWeight);

        if amount_a > 0 {
            let increment = (amount_a as u128)
                .checked_shl(64)
                .ok_or(ErrorCode::ArithmeticOverflow)?
                .checked_div(self.total_weight)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            self.reward_per_weight_a_x64 = self.reward_per_weight_a_x64
                .checked_add(increment)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }

        if amount_b > 0 {
            let increment = (amount_b as u128)
                .checked_shl(64)
                .ok_or(ErrorCode::ArithmeticOverflow)?
                .checked_div(self.total_weight)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            self.reward_per_weight_b_x64 = self.reward_per_weight_b_x64
                .checked_add(increment)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }

        Ok(())
    }
}

impl PoolFeePosition {
    /// Credits whatever this position earned at its OLD weight against both
    /// token indices, then reweights from realized new fee_owed activity --
    /// identical shape to GaugeStake::sync, just against two independent
    /// per-weight indices (one per token) instead of one reward mint.
    pub fn sync(
        &mut self,
        vault: &mut PoolFeeVault,
        in_range: bool,
        fee_owed_a: u64,
        fee_owed_b: u64,
    ) -> Result<()> {
        let delta_a_idx = vault.reward_per_weight_a_x64
            .checked_sub(self.reward_per_weight_a_paid_x64)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let earned_a = self.weight
            .checked_mul(delta_a_idx)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_shr(64)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.accrued_a = self.accrued_a
            .checked_add(u64::try_from(earned_a).map_err(|_| ErrorCode::ArithmeticOverflow)?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let delta_b_idx = vault.reward_per_weight_b_x64
            .checked_sub(self.reward_per_weight_b_paid_x64)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let earned_b = self.weight
            .checked_mul(delta_b_idx)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_shr(64)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.accrued_b = self.accrued_b
            .checked_add(u64::try_from(earned_b).map_err(|_| ErrorCode::ArithmeticOverflow)?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        // fee_owed only ever grows between the owner's own collect_fees
        // calls; a decrease means they collected since our last snapshot --
        // treat it as zero new activity rather than underflowing.
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

        vault.total_weight = vault.total_weight
            .checked_sub(self.weight)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_add(new_weight)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.weight = new_weight;
        self.reward_per_weight_a_paid_x64 = vault.reward_per_weight_a_x64;
        self.reward_per_weight_b_paid_x64 = vault.reward_per_weight_b_x64;
        self.is_paused = !in_range;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_vault(total_weight: u128) -> PoolFeeVault {
        PoolFeeVault {
            pool: Pubkey::default(),
            token_mint_a: Pubkey::default(),
            token_mint_b: Pubkey::default(),
            total_weight,
            reward_per_weight_a_x64: 0,
            reward_per_weight_b_x64: 0,
            bump: 0,
        }
    }

    fn test_position(weight: u128) -> PoolFeePosition {
        PoolFeePosition {
            owner: Pubkey::default(),
            pool: Pubkey::default(),
            position: Pubkey::default(),
            position_mint: Pubkey::default(),
            weight,
            reward_per_weight_a_paid_x64: 0,
            reward_per_weight_b_paid_x64: 0,
            accrued_a: 0,
            accrued_b: 0,
            last_fee_owed_a: 0,
            last_fee_owed_b: 0,
            is_paused: false,
            registered_at: 0,
            bump: 0,
        }
    }

    #[test]
    fn fund_rejects_a_vault_with_no_registered_weight() {
        let mut vault = test_vault(0);
        assert!(vault.fund(1_000, 1_000).is_err());
    }

    #[test]
    fn fund_indexes_each_token_independently_by_weight_share() {
        let mut vault = test_vault(100);
        vault.fund(1_000, 500).unwrap();

        // reward_per_weight_x64 = (amount << 64) / total_weight
        assert_eq!(vault.reward_per_weight_a_x64, (1_000u128 << 64) / 100);
        assert_eq!(vault.reward_per_weight_b_x64, (500u128 << 64) / 100);
    }

    #[test]
    fn sync_credits_old_weight_on_both_tokens_then_reweights() {
        let mut vault = test_vault(100);
        vault.fund(1_000, 1_000).unwrap();
        let mut position = test_position(100);

        // in_range, delta_a=9, delta_b=16 -> isqrt(144) = 12
        position.sync(&mut vault, true, 9, 16).unwrap();

        // This position holds the vault's entire 100-of-100 weight, so it
        // earns the full 1,000 funded on each side.
        assert_eq!(position.accrued_a, 1_000);
        assert_eq!(position.accrued_b, 1_000);
        assert_eq!(position.weight, 12);
        assert_eq!(vault.total_weight, 12);
        assert!(!position.is_paused);
    }

    #[test]
    fn sync_zeroes_weight_and_pauses_when_out_of_range() {
        let mut vault = test_vault(100);
        let mut position = test_position(100);

        position.sync(&mut vault, false, 5, 5).unwrap();

        assert_eq!(position.weight, 0);
        assert!(position.is_paused);
        assert_eq!(vault.total_weight, 0);
    }
}
