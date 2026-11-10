use crate::{
    errors::ErrorCode,
    math::{
        tick_index_from_sqrt_price, MAX_FEE_RATE, MAX_PROTOCOL_FEE_RATE, MAX_SQRT_PRICE_X64,
        MIN_SQRT_PRICE_X64,
    },
};
use anchor_lang::prelude::*;
use bitflags::bitflags;

use super::gate::{self, GateState, MAX_GATE_PHI_PPM};
use super::SolvesConfig;

#[account]
#[derive(Default)]
pub struct Solve {
    pub solves_config: Pubkey, // 32
    pub solve_bump: [u8; 1],   // 1

    pub tick_spacing: u16,          // 2
    pub tick_spacing_seed: [u8; 2], // 2

    // Stored as hundredths of a basis point
    // u16::MAX corresponds to ~6.5%
    pub fee_rate: u16, // 2

    // Portion of fee rate taken stored as basis points
    pub protocol_fee_rate: u16, // 2

    // Maximum amount that can be held by Solana account
    pub liquidity: u128, // 16

    // MAX/MIN at Q32.64, but using Q64.64 for rounder bytes
    // Q64.64
    pub sqrt_price: u128,        // 16
    pub tick_current_index: i32, // 4

    pub protocol_fee_owed_a: u64, // 8
    pub protocol_fee_owed_b: u64, // 8

    pub token_mint_a: Pubkey,  // 32
    pub token_vault_a: Pubkey, // 32

    // Q64.64
    pub fee_growth_global_a: u128, // 16

    pub token_mint_b: Pubkey,  // 32
    pub token_vault_b: Pubkey, // 32

    // Q64.64
    pub fee_growth_global_b: u128, // 16

    pub reward_last_updated_timestamp: u64, // 8

    pub reward_infos: [SolveRewardInfo; NUM_REWARDS], // 384
}

// Number of rewards supported by Solves
pub const NUM_REWARDS: usize = 3;

impl Solve {
    pub const LEN: usize = 8 + 261 + 384;
    pub fn seeds(&self) -> [&[u8]; 6] {
        [
            &b"solve"[..],
            self.solves_config.as_ref(),
            self.token_mint_a.as_ref(),
            self.token_mint_b.as_ref(),
            self.tick_spacing_seed.as_ref(),
            self.solve_bump.as_ref(),
        ]
    }

    pub fn input_token_mint(&self, a_to_b: bool) -> Pubkey {
        if a_to_b {
            self.token_mint_a
        } else {
            self.token_mint_b
        }
    }

    pub fn input_token_vault(&self, a_to_b: bool) -> Pubkey {
        if a_to_b {
            self.token_vault_a
        } else {
            self.token_vault_b
        }
    }

    pub fn output_token_mint(&self, a_to_b: bool) -> Pubkey {
        if a_to_b {
            self.token_mint_b
        } else {
            self.token_mint_a
        }
    }

    pub fn output_token_vault(&self, a_to_b: bool) -> Pubkey {
        if a_to_b {
            self.token_vault_b
        } else {
            self.token_vault_a
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        solves_config: &Account<SolvesConfig>,
        bump: u8,
        tick_spacing: u16,
        sqrt_price: u128,
        default_fee_rate: u16,
        token_mint_a: Pubkey,
        token_vault_a: Pubkey,
        token_mint_b: Pubkey,
        token_vault_b: Pubkey,
    ) -> Result<()> {
        if token_mint_a.ge(&token_mint_b) {
            return Err(ErrorCode::InvalidTokenMintOrder.into());
        }

        if !(MIN_SQRT_PRICE_X64..=MAX_SQRT_PRICE_X64).contains(&sqrt_price) {
            return Err(ErrorCode::SqrtPriceOutOfBounds.into());
        }

        self.solves_config = solves_config.key();
        self.solve_bump = [bump];

        self.tick_spacing = tick_spacing;
        self.tick_spacing_seed = self.tick_spacing.to_le_bytes();

        self.update_fee_rate(default_fee_rate)?;
        self.update_protocol_fee_rate(solves_config.default_protocol_fee_rate)?;

        self.liquidity = 0;
        self.sqrt_price = sqrt_price;
        self.tick_current_index = tick_index_from_sqrt_price(&sqrt_price);

        self.protocol_fee_owed_a = 0;
        self.protocol_fee_owed_b = 0;

        self.token_mint_a = token_mint_a;
        self.token_vault_a = token_vault_a;
        self.fee_growth_global_a = 0;

        self.token_mint_b = token_mint_b;
        self.token_vault_b = token_vault_b;
        self.fee_growth_global_b = 0;

        self.reward_infos =
            [SolveRewardInfo::new(solves_config.reward_emissions_super_authority);
                NUM_REWARDS];

        Ok(())
    }

    /// Update all reward values for the Solve.
    ///
    /// # Parameters
    /// - `reward_infos` - An array of all updated solve rewards
    /// - `reward_last_updated_timestamp` - The timestamp when the rewards were last updated
    pub fn update_rewards(
        &mut self,
        reward_infos: [SolveRewardInfo; NUM_REWARDS],
        reward_last_updated_timestamp: u64,
    ) {
        // Emissions that streamed while the pool had no liquidity, or while the
        // activity gate was closed, earn nobody anything. Record them (against
        // the OLD rate, liquidity and timestamp) and roll the gate before the
        // state moves on. The incoming reward_infos was computed earlier, so
        // the updated records are carried across the overwrite.
        let (unearned, gate) = self.gauge_records_after(reward_last_updated_timestamp);
        self.reward_last_updated_timestamp = reward_last_updated_timestamp;
        self.reward_infos = reward_infos;
        if let Some(unearned) = unearned {
            self.set_gauge_unearned_x64(unearned);
        }
        if let Some(gate) = gate {
            self.set_gate_state(gate);
        }
    }

    /// Unearned gauge emissions, Q64.64 tokens, kept in the primary extension's
    /// reserved bytes [8..24] (bytes [..8] hold the schedule end).
    pub fn gauge_unearned_x64(&self) -> u128 {
        u128::from_le_bytes(self.extension_segment_primary().reserved[8..24].try_into().unwrap())
    }

    fn set_gauge_unearned_x64(&mut self, value: u128) {
        let mut extension = self.extension_segment_primary();
        extension.reserved[8..24].copy_from_slice(&value.to_le_bytes());
        self.reward_infos[1].authority = Pubkey::from(extension.to_bytes());
    }

    /// Seconds of [last update, next_timestamp) that are earnable (liquidity
    /// present and gate open) and the total seconds up to the schedule end.
    pub fn gauge_earnable_seconds(&self, next_timestamp: u64) -> Option<(u64, u64)> {
        if next_timestamp <= self.reward_last_updated_timestamp {
            return None;
        }
        let end = self.gauge_reward_end_timestamp()?;
        let from = self.reward_last_updated_timestamp.min(end);
        let to = next_timestamp.min(end);
        let total = to.saturating_sub(from);
        let earnable = if self.liquidity == 0 {
            0
        } else {
            match self.gate_state() {
                Some(gate) if gate.phi_ppm != 0 => gate.open_seconds(from, to),
                _ => total,
            }
        };
        Some((earnable, total))
    }

    /// The unearned counter and the rolled gate as of `next_timestamp`.
    fn gauge_records_after(&self, next_timestamp: u64) -> (Option<u128>, Option<GateState>) {
        let mut unearned = None;
        if let Some((earnable, total)) = self.gauge_earnable_seconds(next_timestamp) {
            let lost = u128::from(total - earnable);
            if lost > 0 {
                unearned = self.reward_infos[0]
                    .emissions_per_second_x64
                    .checked_mul(lost)
                    .map(|x| self.gauge_unearned_x64().saturating_add(x));
            }
        }
        let gate = self.gate_state().map(|mut gate| {
            gate.roll(next_timestamp);
            gate
        });
        (unearned, gate)
    }

    /// Whole tokens of unearned emissions that can be burned now. The
    /// fractional part stays recorded.
    pub fn gauge_unearned_whole_tokens(&self) -> u64 {
        u64::try_from(self.gauge_unearned_x64() >> 64).unwrap_or(u64::MAX)
    }

    pub fn record_gauge_unearned_burned(&mut self, tokens: u64) {
        let remaining = self.gauge_unearned_x64().saturating_sub(u128::from(tokens) << 64);
        self.set_gauge_unearned_x64(remaining);
    }

    pub fn update_rewards_and_liquidity(
        &mut self,
        reward_infos: [SolveRewardInfo; NUM_REWARDS],
        liquidity: u128,
        reward_last_updated_timestamp: u64,
    ) {
        self.update_rewards(reward_infos, reward_last_updated_timestamp);
        self.liquidity = liquidity;
    }

    /// Update the reward authority at the specified Solve reward index.
    pub fn update_reward_authority(&mut self, index: usize, authority: Pubkey) -> Result<()> {
        if index >= NUM_REWARDS {
            return Err(ErrorCode::InvalidRewardIndex.into());
        }
        // Slots 1 and 2 of a gauge-managed pool hold the schedule and the gate,
        // not an authority; nobody may overwrite them.
        require!(!(index != 0 && self.has_gauge_reward()), ErrorCode::GaugeRewardManaged);
        self.reward_infos[index].authority = authority;

        Ok(())
    }

    pub fn update_emissions(
        &mut self,
        index: usize,
        reward_infos: [SolveRewardInfo; NUM_REWARDS],
        timestamp: u64,
        emissions_per_second_x64: u128,
    ) -> Result<()> {
        if index >= NUM_REWARDS {
            return Err(ErrorCode::InvalidRewardIndex.into());
        }
        require!(!(index == 0 && self.has_gauge_reward()), ErrorCode::GaugeRewardManaged);
        self.update_rewards(reward_infos, timestamp);
        self.reward_infos[index].emissions_per_second_x64 = emissions_per_second_x64;

        Ok(())
    }

    pub fn initialize_reward(&mut self, index: usize, mint: Pubkey, vault: Pubkey) -> Result<()> {
        if index >= NUM_REWARDS {
            return Err(ErrorCode::InvalidRewardIndex.into());
        }
        require!(!(index == 0 && self.has_gauge_reward()), ErrorCode::GaugeRewardManaged);

        let lowest_index = match self.reward_infos.iter().position(|r| !r.initialized()) {
            Some(lowest_index) => lowest_index,
            None => return Err(ErrorCode::InvalidRewardIndex.into()),
        };

        if lowest_index != index {
            return Err(ErrorCode::InvalidRewardIndex.into());
        }

        self.reward_infos[index].mint = mint;
        self.reward_infos[index].vault = vault;

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_after_swap(
        &mut self,
        liquidity: u128,
        tick_index: i32,
        sqrt_price: u128,
        fee_growth_global: u128,
        reward_infos: [SolveRewardInfo; NUM_REWARDS],
        protocol_fee: u64,
        is_token_fee_in_a: bool,
        reward_last_updated_timestamp: u64,
        gate_fee_value_b: u128,
        vault_a_amount: u64,
        vault_b_amount: u64,
    ) {
        // Checkpoint rewards against the pre-swap liquidity, then take the
        // swap's fee yield into the (possibly just rolled) gate bucket.
        self.update_rewards(reward_infos, reward_last_updated_timestamp);
        // The gate measures fee yield on the pool's real capital (vault balances
        // before this swap's transfers, at the pre-swap price).
        let value = gate::pool_value_b(
            vault_a_amount,
            vault_b_amount,
            self.protocol_fee_owed_a,
            self.protocol_fee_owed_b,
            self.sqrt_price,
        );
        self.record_gate_yield(gate::fee_yield(gate_fee_value_b, value));
        self.tick_current_index = tick_index;
        self.sqrt_price = sqrt_price;
        self.liquidity = liquidity;
        if is_token_fee_in_a {
            // Add fees taken via a
            self.fee_growth_global_a = fee_growth_global;
            self.protocol_fee_owed_a += protocol_fee;
        } else {
            // Add fees taken via b
            self.fee_growth_global_b = fee_growth_global;
            self.protocol_fee_owed_b += protocol_fee;
        }
    }

    pub fn update_fee_rate(&mut self, fee_rate: u16) -> Result<()> {
        if fee_rate > MAX_FEE_RATE {
            return Err(ErrorCode::FeeRateMaxExceeded.into());
        }
        self.fee_rate = fee_rate;

        Ok(())
    }

    pub fn update_protocol_fee_rate(&mut self, protocol_fee_rate: u16) -> Result<()> {
        if protocol_fee_rate > MAX_PROTOCOL_FEE_RATE {
            return Err(ErrorCode::ProtocolFeeRateMaxExceeded.into());
        }
        require!(protocol_fee_rate < 10_000 || self.has_gauge_reward(), ErrorCode::GaugeRewardManaged);
        self.protocol_fee_rate = protocol_fee_rate;

        Ok(())
    }

    pub fn reset_protocol_fees_owed(&mut self) {
        self.protocol_fee_owed_a = 0;
        self.protocol_fee_owed_b = 0;
    }

    /// Slot 1's authority bytes hold the gauge schedule segment.
    pub fn extension_segment_primary(&self) -> SolveExtensionSegmentPrimary {
        SolveExtensionSegmentPrimary::from_bytes(&self.reward_infos[1].authority.to_bytes())
    }

    /// Gauge emissions use reward slot 0. Slots 1 and 2 are the schedule and the
    /// activity gate, stored in their authority bytes; a managed pool is
    /// recognised by a valid gate in slot 2 plus the managed flag in slot 1.
    pub fn has_gauge_reward(&self) -> bool {
        GateState::from_bytes(&self.reward_infos[2].authority.to_bytes()).is_some()
            && self
                .extension_segment_primary()
                .control_flags()
                .contains(SolveControlFlags::GAUGE_REWARD_MANAGED)
    }

    /// The activity gate, if this pool is gauge-managed.
    pub fn gate_state(&self) -> Option<GateState> {
        if !self.has_gauge_reward() {
            return None;
        }
        GateState::from_bytes(&self.reward_infos[2].authority.to_bytes())
    }

    fn set_gate_state(&mut self, gate: GateState) {
        self.reward_infos[2].authority = Pubkey::from(gate.to_bytes());
    }

    pub fn record_gate_yield(&mut self, y: u64) {
        if let Some(mut gate) = self.gate_state() {
            gate.add_yield(y);
            self.set_gate_state(gate);
        }
    }

    pub fn gauge_reward_end_timestamp(&self) -> Option<u64> {
        self.has_gauge_reward().then(|| {
            u64::from_le_bytes(self.reward_infos[1].authority.to_bytes()[2..10].try_into().unwrap())
        })
    }

    /// `gate_phi_ppm`: activity-gate threshold in parts per million of the pool's
    /// capital per hour; 0 disables the gate.
    pub fn set_gauge_reward_schedule(
        &mut self,
        mint: Pubkey,
        vault: Pubkey,
        rate: u128,
        end: u64,
        now: u64,
        gate_phi_ppm: u32,
    ) -> Result<()> {
        require!(gate_phi_ppm <= MAX_GATE_PHI_PPM, ErrorCode::InvalidTimestamp);
        if self.has_gauge_reward() {
            require!(
                self.reward_infos[0].mint == mint && self.reward_infos[0].vault == vault,
                ErrorCode::GaugeRewardManaged
            );
        } else {
            // Never overwrite an existing third-party reward: its slot, and the
            // authority bytes of slots 1 and 2 that we are about to repurpose, must be unused.
            let reward = &self.reward_infos[0];
            require!(
                !reward.initialized()
                    && reward.vault == Pubkey::default()
                    && reward.growth_global_x64 == 0
                    && reward.emissions_per_second_x64 == 0,
                ErrorCode::GaugeRewardManaged
            );
            require!(
                !self.reward_infos[1].initialized() && !self.reward_infos[2].initialized(),
                ErrorCode::GaugeRewardMigrationRequired
            );
        }
        let mut extension = if self.has_gauge_reward() {
            self.extension_segment_primary()
        } else {
            SolveExtensionSegmentPrimary::new(SolveControlFlags::empty())
        };
        extension.control_flags |= SolveControlFlags::GAUGE_REWARD_MANAGED.bits();
        extension.reserved[..8].copy_from_slice(&end.to_le_bytes());
        self.reward_infos[1].authority = Pubkey::from(extension.to_bytes());
        self.reward_infos[0].mint = mint;
        self.reward_infos[0].vault = vault;
        self.reward_infos[0].emissions_per_second_x64 = rate;
        let mut gate = self.gate_state().unwrap_or_else(|| GateState::new(now, gate_phi_ppm));
        gate.phi_ppm = gate_phi_ppm;
        self.set_gate_state(gate);
        Ok(())
    }
}

/// Stores the state relevant for tracking liquidity mining rewards at the `Solve` level.
/// These values are used in conjunction with `PositionRewardInfo`, `Tick.reward_growths_outside`,
/// and `Solve.reward_last_updated_timestamp` to determine how many rewards are earned by open
/// positions.
#[derive(Copy, Clone, AnchorSerialize, AnchorDeserialize, Default, Debug, PartialEq)]
pub struct SolveRewardInfo {
    /// Reward token mint.
    pub mint: Pubkey,
    /// Reward vault token account.
    pub vault: Pubkey,
    /// Authority account that has permission to initialize the reward and set emissions.
    pub authority: Pubkey,
    /// Q64.64 number that indicates how many tokens per second are earned per unit of liquidity.
    pub emissions_per_second_x64: u128,
    /// Q64.64 number that tracks the total tokens earned per unit of liquidity since the reward
    /// emissions were turned on.
    pub growth_global_x64: u128,
}

impl SolveRewardInfo {
    /// Creates a new `SolveRewardInfo` with the authority set
    pub fn new(authority: Pubkey) -> Self {
        Self {
            authority,
            ..Default::default()
        }
    }

    /// Returns true if this reward is initialized.
    /// Once initialized, a reward cannot transition back to uninitialized.
    pub fn initialized(&self) -> bool {
        self.mint.ne(&Pubkey::default())
    }

    /// Maps all reward data to only the reward growth accumulators
    pub fn to_reward_growths(
        reward_infos: &[SolveRewardInfo; NUM_REWARDS],
    ) -> [u128; NUM_REWARDS] {
        let mut reward_growths = [0u128; NUM_REWARDS];
        for i in 0..NUM_REWARDS {
            reward_growths[i] = reward_infos[i].growth_global_x64;
        }
        reward_growths
    }
}

#[derive(Copy, Clone, Default, Debug, PartialEq)]
pub struct SolveControlFlags(u16);

bitflags! {
    impl SolveControlFlags: u16 {
        const GAUGE_REWARD_MANAGED = 0b0000_0000_0000_0010;
    }
}

/// 32-byte gauge schedule segment, kept in reward slot 1's authority bytes:
/// control flags (u16 LE), then 30 reserved bytes: [0..8] schedule end
/// timestamp, [8..24] unearned emissions (Q64.64).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SolveExtensionSegmentPrimary {
    pub control_flags: u16,
    pub reserved: [u8; 30],
}

impl SolveExtensionSegmentPrimary {
    pub fn new(control_flags: SolveControlFlags) -> Self {
        Self {
            control_flags: control_flags.bits(),
            reserved: [0; 30],
        }
    }

    pub fn from_bytes(bytes: &[u8; 32]) -> Self {
        Self {
            control_flags: u16::from_le_bytes([bytes[0], bytes[1]]),
            reserved: bytes[2..32].try_into().unwrap(),
        }
    }

    pub fn to_bytes(&self) -> [u8; 32] {
        let mut bytes = [0u8; 32];
        bytes[0..2].copy_from_slice(&self.control_flags.to_le_bytes());
        bytes[2..32].copy_from_slice(&self.reserved);
        bytes
    }

    pub fn control_flags(&self) -> SolveControlFlags {
        SolveControlFlags::from_bits_truncate(self.control_flags)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Copy)]
pub struct SolveBumps {
    pub solve_bump: u8,
}

