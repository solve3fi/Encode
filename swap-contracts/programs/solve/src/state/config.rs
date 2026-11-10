use anchor_lang::prelude::*;

use crate::{errors::ErrorCode, math::MAX_PROTOCOL_FEE_RATE};

#[account]
pub struct SolvesConfig {
    pub fee_authority: Pubkey,
    pub collect_protocol_fees_authority: Pubkey,
    pub reward_emissions_super_authority: Pubkey,

    pub default_protocol_fee_rate: u16,
    /// Trading pause switches (bit 0: swaps, bit 1: new liquidity). Occupies what used to be
    /// padding, so the account size is unchanged.
    pub trading_pauses: u16,
}

pub const SWAPS_PAUSED: u16 = 0b01;
pub const LIQUIDITY_INCREASES_PAUSED: u16 = 0b10;

impl SolvesConfig {
    pub const LEN: usize = 8 + 96 + 4;

    /// Trading pauses only stop swaps and new liquidity; removing liquidity, collecting fees and
    /// closing positions are never paused.
    pub fn set_trading_pauses(&mut self, swaps: bool, liquidity_increases: bool) {
        let mut flags = 0u16;
        if swaps {
            flags |= SWAPS_PAUSED;
        }
        if liquidity_increases {
            flags |= LIQUIDITY_INCREASES_PAUSED;
        }
        self.trading_pauses = flags;
    }

    pub fn require_swaps_enabled(&self) -> Result<()> {
        require!(self.trading_pauses & SWAPS_PAUSED == 0, ErrorCode::SwapsPaused);
        Ok(())
    }

    pub fn require_liquidity_increases_enabled(&self) -> Result<()> {
        require!(
            self.trading_pauses & LIQUIDITY_INCREASES_PAUSED == 0,
            ErrorCode::LiquidityIncreasesPaused
        );
        Ok(())
    }

    pub fn update_fee_authority(&mut self, fee_authority: Pubkey) {
        self.fee_authority = fee_authority;
    }

    pub fn update_collect_protocol_fees_authority(
        &mut self,
        collect_protocol_fees_authority: Pubkey,
    ) {
        self.collect_protocol_fees_authority = collect_protocol_fees_authority;
    }

    pub fn initialize(
        &mut self,
        fee_authority: Pubkey,
        collect_protocol_fees_authority: Pubkey,
        reward_emissions_super_authority: Pubkey,
        default_protocol_fee_rate: u16,
    ) -> Result<()> {
        self.fee_authority = fee_authority;
        self.collect_protocol_fees_authority = collect_protocol_fees_authority;
        self.reward_emissions_super_authority = reward_emissions_super_authority;
        self.update_default_protocol_fee_rate(default_protocol_fee_rate)?;

        Ok(())
    }

    pub fn update_reward_emissions_super_authority(
        &mut self,
        reward_emissions_super_authority: Pubkey,
    ) {
        self.reward_emissions_super_authority = reward_emissions_super_authority;
    }

    pub fn update_default_protocol_fee_rate(
        &mut self,
        default_protocol_fee_rate: u16,
    ) -> Result<()> {
        // New pools have no native gauge yet. A 100% default would confiscate
        // their fees before gauge/reward configuration; only pool-level native
        // activation may select that rate.
        if default_protocol_fee_rate > 8_000 {
            return Err(ErrorCode::ProtocolFeeRateMaxExceeded.into());
        }
        self.default_protocol_fee_rate = default_protocol_fee_rate;

        Ok(())
    }
}

