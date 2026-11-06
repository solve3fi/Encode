use anchor_lang::prelude::*;

declare_id!("HMqzJpD85Z74R1vhor9LWm6KFhK6tYVChzjzyBRyjUmN");

pub mod states;
pub mod errors;
pub mod instructions;
pub mod utils;
pub mod events;
pub mod constants;
pub mod security;
pub mod auth;


use instructions::*;
use crate::states::GaugeVote;

#[program]
pub mod vesolve {
    use super::*;

    pub fn configure_native_gauge(ctx: Context<ConfigureNativeGauge>, active: bool) -> Result<()> {
        instructions::native_gauge::configure_native_gauge(ctx, active)
    }

    pub fn settle_native_gauge_unearned(ctx: Context<SettleNativeGaugeUnearned>) -> Result<()> {
        instructions::native_gauge::settle_native_gauge_unearned(ctx)
    }

    pub fn fund_native_gauge(ctx: Context<FundNativeGauge>, emission_epoch: u64) -> Result<()> {
        instructions::native_gauge::fund_native_gauge(ctx, emission_epoch)
    }

    pub fn migrate_legacy_stake(ctx: Context<MigrateLegacyStake>) -> Result<()> {
        instructions::migrate_legacy_stake::migrate_legacy_stake(ctx)
    }

    pub fn initialize(ctx: Context<Initialize>, mint_token: Pubkey, epoch_reset_time: i64) -> Result<()> {
        instructions::initialize::initialize(ctx, mint_token, epoch_reset_time)
    }

    pub fn create_lock(ctx: Context<CreateLock>, amount: u64, unlock_time: i64) -> Result<()> {
        instructions::create_lock::create_lock(ctx, amount, unlock_time)
    }

    pub fn increase_lock(ctx: Context<IncreaseLock>, ve_token_id: u64, amount: u64) -> Result<()> {
        instructions::increase_lock::increase_lock(ctx, ve_token_id, amount)
    }

    pub fn extend_lock(ctx: Context<ExtendLock>, ve_token_id: u64, unlock_time: i64) -> Result<()> {
        instructions::extend_lock::extend_lock(ctx, ve_token_id, unlock_time)
    }

    pub fn merge_lock(ctx: Context<MergeLock>, primary_ve_token_id: u64, secondary_ve_token_id: u64) -> Result<()> {
        instructions::merge_lock::merge_lock(ctx, primary_ve_token_id, secondary_ve_token_id)
    }

    pub fn split_lock(ctx: Context<SplitLock>, ve_token_id: u64, amount: u64) -> Result<()> {
        instructions::split_lock::split_lock(ctx, ve_token_id, amount)
    }

    pub fn transfer_lock(ctx: Context<TransferLock>, ve_token_id: u64) -> Result<()> {
        instructions::transfer_lock::transfer_lock(ctx, ve_token_id)
    }

    /// Unreachable on permanent locks: it requires `lock.is_expired()`, which
    /// is always false. Superseded by `exit_lock`, which charges the published
    /// exit fee instead of waiting for an expiry that never arrives.
    pub fn unlock_lock(ctx: Context<UnlockLock>, ve_token_id: u64) -> Result<()> {
        instructions::unlock_lock::unlock_lock(ctx, ve_token_id)
    }

    pub fn set_exit_price(ctx: Context<SetExitPrice>, lamports_per_solv3: u64) -> Result<()> {
        instructions::exit_lock::set_exit_price(ctx, lamports_per_solv3)
    }

    pub fn exit_lock(ctx: Context<ExitLock>, ve_token_id: u64) -> Result<()> {
        instructions::exit_lock::exit_lock(ctx, ve_token_id)
    }

    pub fn partial_exit_lock(ctx: Context<PartialExitLock>, ve_token_id: u64, amount: u64) -> Result<()> {
        instructions::exit_lock::partial_exit_lock(ctx, ve_token_id, amount)
    }

    pub fn set_exit_fee_bps(ctx: Context<SetExitFee>, fee_bps: u64) -> Result<()> {
        instructions::exit_lock::set_exit_fee_bps(ctx, fee_bps)
    }

    pub fn withdraw_exit_fees(ctx: Context<WithdrawExitFees>, amount: u64) -> Result<()> {
        instructions::exit_lock::withdraw_exit_fees(ctx, amount)
    }

    pub fn create_gauge(ctx: Context<CreateGauge>, pool_address: Pubkey, token_mint_a: Pubkey, token_mint_b: Pubkey, fee_tier: u16) -> Result<()> {
        instructions::create_gauge::create_gauge(ctx, pool_address, token_mint_a, token_mint_b, fee_tier)
    }

    pub fn schedule_gauge_activation(ctx: Context<ScheduleGaugeActivation>, mint_lo: Pubkey, mint_hi: Pubkey) -> Result<()> {
        instructions::gauge_lifecycle::schedule_gauge_activation(ctx, mint_lo, mint_hi)
    }

    pub fn request_gauge_removal(ctx: Context<RequestGaugeRemoval>) -> Result<()> {
        instructions::gauge_lifecycle::request_gauge_removal(ctx)
    }

    pub fn schedule_gauge_migration(ctx: Context<ScheduleGaugeMigration>, mint_lo: Pubkey, mint_hi: Pubkey) -> Result<()> {
        instructions::gauge_lifecycle::schedule_gauge_migration(ctx, mint_lo, mint_hi)
    }

    pub fn register_allocation_voter(ctx: Context<RegisterAllocationVoter>, ve_token_id: u64) -> Result<()> {
        instructions::allocation_voter::register_allocation_voter(ctx, ve_token_id)
    }

    pub fn unregister_allocation_voter(ctx: Context<UnregisterAllocationVoter>) -> Result<()> {
        instructions::allocation_voter::unregister_allocation_voter(ctx)
    }

    pub fn set_allocation_votes(ctx: Context<SetAllocationVotes>, votes: Vec<GaugeVote>) -> Result<()> {
        instructions::allocation_voter::set_allocation_votes(ctx, votes)
    }

    pub fn apply_allocation_vote<'info>(
        ctx: Context<'_, '_, 'info, 'info, ApplyAllocationVote<'info>>,
        ve_token_id: u64,
    ) -> Result<()> {
        instructions::allocation_voter::apply_allocation_vote(ctx, ve_token_id)
    }

    pub fn schedule_upgrade(ctx: Context<ScheduleUpgrade>, target_program: Pubkey) -> Result<()> {
        instructions::upgrade_timelock::schedule_upgrade(ctx, target_program)
    }

    pub fn cancel_upgrade(ctx: Context<CancelUpgrade>) -> Result<()> {
        instructions::upgrade_timelock::cancel_upgrade(ctx)
    }

    pub fn execute_upgrade(ctx: Context<ExecuteUpgrade>) -> Result<()> {
        instructions::upgrade_timelock::execute_upgrade(ctx)
    }

    pub fn vote<'info>(ctx: Context<'_, '_, 'info, 'info, Vote<'info>>, ve_token_id: u64, gauge_votes: Vec<GaugeVote>) -> Result<()> {
        instructions::vote::vote(ctx, ve_token_id, gauge_votes)
    }

    pub fn update_epoch(ctx: Context<UpdateEpoch>) -> Result<()> {
        instructions::update_epoch::update_epoch(ctx)
    }

    pub fn initialize_epoch_emission(ctx: Context<InitializeEpochEmission>, emission_epoch: u64) -> Result<()> {
        instructions::fund_emission::initialize_epoch_emission(ctx, emission_epoch)
    }

    pub fn fund_gauge_emission(ctx: Context<FundGaugeEmission>, emission_epoch: u64) -> Result<()> {
        // Keep the old discriminator for an explicit error, never two funding
        // endpoints that could mint the same gauge allocation in one epoch.
        let _ = (ctx, emission_epoch);
        err!(crate::errors::ErrorCode::NativeGaugeRequired)
    }

    pub fn stake_position(ctx: Context<StakePosition>) -> Result<()> {
        // Switched off (review I-1): no live pool uses this reward path. Existing records can still be
        // claimed and closed through their other instructions.
        let _ = ctx;
        err!(crate::errors::ErrorCode::NativeGaugeRequired)
    }

    pub fn sync_stake(ctx: Context<SyncStake>) -> Result<()> {
        instructions::gauge_stake::sync_stake(ctx)
    }

    pub fn claim_gauge_rewards(ctx: Context<ClaimGaugeRewards>) -> Result<()> {
        instructions::gauge_stake::claim_gauge_rewards(ctx)
    }

    pub fn unstake_position(ctx: Context<UnstakePosition>) -> Result<()> {
        instructions::gauge_stake::unstake_position(ctx)
    }

    pub fn distribute_pool_reward(ctx: Context<DistributePoolReward>, token_a_amount: u64, token_b_amount: u64) -> Result<()> {
        instructions::distribute_pool_reward::distribute_pool_reward(ctx, token_a_amount, token_b_amount)
    }

    pub fn route_pool_fees(ctx: Context<RoutePoolFees>, expected_epoch: u64) -> Result<()> {
        instructions::route_pool_fees::route_pool_fees(ctx, expected_epoch)
    }

    pub fn claim_reward(ctx: Context<Reward>, ve_token_id: u64) -> Result<()> {
        instructions::claim_reward::claim_reward(ctx, ve_token_id)
    }

    pub fn claim_pool_reward(ctx: Context<PoolReward>, ve_token_id: u64, sides: u8) -> Result<()> {
        instructions::claim_pool_reward::claim_pool_reward(ctx, ve_token_id, sides)
    }

    pub fn claim_bribe_reward(ctx: Context<BribesReward>, ve_token_id: u64) -> Result<()> {
        instructions::claim_bribe_reward::claim_bribe_reward(ctx, ve_token_id)
    }

    pub fn sweep_ungauged_pool_fees(ctx: Context<SweepUngaugedPoolFees>) -> Result<()> {
        instructions::sweep_ungauged_fees::sweep_ungauged_pool_fees(ctx)
    }

    pub fn sweep_unvoted_bribe(ctx: Context<SweepUnvotedBribe>) -> Result<()> {
        instructions::sweep_bribe::sweep_unvoted_bribe(ctx)
    }

    pub fn sweep_unvoted_pool_fees(ctx: Context<SweepUnvotedPoolFees>) -> Result<()> {
        instructions::sweep_bribe::sweep_unvoted_pool_fees(ctx)
    }

    pub fn create_bribe(ctx: Context<CreateBribe>, amount: u64) -> Result<()> {
        instructions::create_bribe::create_bribe(ctx, amount)
    }

    pub fn set_pauses(ctx: Context<SetPauses>, flags: PauseFlags) -> Result<()> {
        instructions::admin_config::set_pauses(ctx, flags)
    }

    pub fn set_gate_threshold(ctx: Context<SetAdminParams>, gate_phi_ppm: u32) -> Result<()> {
        instructions::admin_config::set_gate_threshold(ctx, gate_phi_ppm)
    }

    pub fn set_treasury(ctx: Context<SetTreasury>, treasury: Pubkey) -> Result<()> {
        instructions::admin_config::set_treasury(ctx, treasury)
    }

    pub fn apply_treasury_change(ctx: Context<ApplyTreasuryChange>) -> Result<()> {
        instructions::admin_config::apply_treasury_change(ctx)
    }

    pub fn set_keeper(ctx: Context<SetKeeper>, keeper: Pubkey) -> Result<()> {
        instructions::admin_config::set_keeper(ctx, keeper)
    }

    pub fn set_partner_voter(ctx: Context<SetPartnerVoter>, voter: Pubkey) -> Result<()> {
        instructions::admin_config::set_partner_voter(ctx, voter)
    }

    pub fn remove_partner_voter(ctx: Context<RemovePartnerVoter>) -> Result<()> {
        instructions::admin_config::remove_partner_voter(ctx)
    }

    pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::admin_config::propose_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin_config::accept_admin(ctx)
    }

    pub fn set_bribe_token(ctx: Context<SetBribeToken>, allowed: bool, paused: bool) -> Result<()> {
        instructions::bribe_token::set_bribe_token(ctx, allowed, paused)
    }

    pub fn register_pool_fee_position(ctx: Context<RegisterPoolFeePosition>) -> Result<()> {
        // Switched off (review I-1): no live pool uses this reward path. Existing records can still be
        // claimed and closed through their other instructions.
        let _ = ctx;
        err!(crate::errors::ErrorCode::NativeGaugeRequired)
    }

    pub fn sync_pool_fee_position(ctx: Context<SyncPoolFeePosition>) -> Result<()> {
        instructions::pool_fee_vault::sync_pool_fee_position(ctx)
    }

    pub fn fund_pool_fee_vault(ctx: Context<FundPoolFeeVault>, amount_a: u64, amount_b: u64) -> Result<()> {
        // Switched off (review I-1): see register_pool_fee_position.
        let _ = (ctx, amount_a, amount_b);
        err!(crate::errors::ErrorCode::NativeGaugeRequired)
    }

    pub fn claim_pool_fees(ctx: Context<ClaimPoolFees>) -> Result<()> {
        instructions::pool_fee_vault::claim_pool_fees(ctx)
    }

    pub fn enroll_auto_vote(ctx: Context<EnrollAutoVote>, ve_token_id: u64) -> Result<()> {
        instructions::auto_vote::enroll_auto_vote(ctx, ve_token_id)
    }

    pub fn revoke_auto_vote(ctx: Context<RevokeAutoVote>, ve_token_id: u64) -> Result<()> {
        instructions::auto_vote::revoke_auto_vote(ctx, ve_token_id)
    }

    pub fn withdraw_auto_vote_fees(ctx: Context<WithdrawAutoVoteFees>, amount: u64) -> Result<()> {
        instructions::auto_vote::withdraw_auto_vote_fees(ctx, amount)
    }

    pub fn register_auto_voter(ctx: Context<RegisterAutoVoter>) -> Result<()> {
        instructions::auto_vote::register_auto_voter(ctx)
    }

    pub fn deregister_auto_voter(ctx: Context<DeregisterAutoVoter>) -> Result<()> {
        instructions::auto_vote::deregister_auto_voter(ctx)
    }

    pub fn set_auto_voter(ctx: Context<SetAutoVoter>, ve_token_id: u64) -> Result<()> {
        instructions::auto_vote::set_auto_voter(ctx, ve_token_id)
    }

    pub fn clear_auto_voter(ctx: Context<ClearAutoVoter>, ve_token_id: u64) -> Result<()> {
        instructions::auto_vote::clear_auto_voter(ctx, ve_token_id)
    }

    pub fn delegated_vote<'info>(ctx: Context<'_, '_, 'info, 'info, DelegatedVote<'info>>, ve_token_id: u64, gauge_votes: Vec<GaugeVote>) -> Result<()> {
        instructions::auto_vote::delegated_vote(ctx, ve_token_id, gauge_votes)
    }

    pub fn settle_removed_gauge_fees(ctx: Context<SettleRemovedGaugeFees>) -> Result<()> {
        instructions::sweep_ungauged_fees::settle_removed_gauge_fees(ctx)
    }

    pub fn sync_pool_fee_rate(ctx: Context<SyncPoolFeeRate>) -> Result<()> {
        instructions::dex_admin::sync_pool_fee_rate(ctx)
    }

    pub fn dex_initialize_fee_tier(ctx: Context<DexAdmin>, tick_spacing: u16, default_fee_rate: u16) -> Result<()> {
        instructions::dex_admin::dex_initialize_fee_tier(ctx, tick_spacing, default_fee_rate)
    }

    pub fn dex_set_default_fee_rate(ctx: Context<DexAdmin>, default_fee_rate: u16) -> Result<()> {
        instructions::dex_admin::dex_set_default_fee_rate(ctx, default_fee_rate)
    }

    pub fn dex_set_default_protocol_fee_rate(ctx: Context<DexAdmin>, default_protocol_fee_rate: u16) -> Result<()> {
        instructions::dex_admin::dex_set_default_protocol_fee_rate(ctx, default_protocol_fee_rate)
    }

    pub fn dex_set_fee_rate(ctx: Context<DexAdmin>, fee_rate: u16) -> Result<()> {
        instructions::dex_admin::dex_set_fee_rate(ctx, fee_rate)
    }

    pub fn dex_set_trading_pauses(ctx: Context<DexAdmin>, swaps_paused: bool, liquidity_increases_paused: bool) -> Result<()> {
        instructions::dex_admin::dex_set_trading_pauses(ctx, swaps_paused, liquidity_increases_paused)
    }
}

#[cfg(test)]
mod program_id_consistency {
    use super::*;

    /// `solve` pins the gauge-reward authority to this program's Protocol PDA by
    /// hardcoding this program's ID. If `declare_id!` changes (a redeploy or a
    /// rehearsal) and that constant is not updated, gauge funding silently fails
    /// with `InvalidGaugeRewardAuthority`; this catches it at test time.
    #[test]
    fn solve_pins_the_gauge_reward_authority_to_this_programs_protocol_pda() {
        let expected = Pubkey::find_program_address(&[constants::PROTOCOL_SEED], &crate::ID).0;
        assert_eq!(
            solve::instructions::gauge_reward_authority(),
            expected,
            "update the vesolve ID hardcoded in programs/solve/src/instructions/set_gauge_emissions.rs"
        );
    }
}
