use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::{self, Mint, MintTo, Token, TokenAccount, Transfer}};
use crate::{constants::{PROTOCOL_SEED, GAUGE_SEED, GAUGE_REWARD_SEED, EPOCH_DATA_SEED, EPOCH_EMISSION_SEED},
    errors::ErrorCode, states::{Protocol, Gauge, GaugeReward, NativeGauge, Epoch, EpochEmission, NATIVE_GAUGE_SEED, remaining_stream, stream_rate}};

#[derive(Accounts)]
pub struct ConfigureNativeGauge<'info> {
    /// Anyone (review H-2): only a change the Admin scheduled can run, and only once its epoch has begun.
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    #[account(mut, seeds = [GAUGE_SEED, protocol.key().as_ref(), pool.key().as_ref()], bump = gauge.bump,
        constraint = gauge.pool_address == pool.key() @ ErrorCode::InvalidGauge,
        constraint = gauge.token_mint_a == pool.token_mint_a && gauge.token_mint_b == pool.token_mint_b @ ErrorCode::InvalidMint)]
    pub gauge: Box<Account<'info, Gauge>>,
    #[account(constraint = solves_config.fee_authority == protocol.key() @ ErrorCode::Unauthorized)]
    pub solves_config: Box<Account<'info, solve::state::SolvesConfig>>,
    #[account(mut, has_one = solves_config)]
    pub pool: Box<Account<'info, solve::state::Solve>>,
    #[account(address = pool.token_mint_a @ ErrorCode::InvalidMint)]
    pub token_mint_a: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,
    #[account(address = pool.token_mint_b @ ErrorCode::InvalidMint)]
    pub token_mint_b: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,
    #[account(init_if_needed, payer = caller, space = 8 + NativeGauge::INIT_SPACE,
        seeds = [NATIVE_GAUGE_SEED, gauge.key().as_ref()], bump)]
    pub native_gauge: Box<Account<'info, NativeGauge>>,
    #[account(init_if_needed, payer = caller, space = 8 + GaugeReward::INIT_SPACE,
        seeds = [GAUGE_REWARD_SEED, gauge.key().as_ref()], bump)]
    pub legacy_reward: Box<Account<'info, GaugeReward>>,
    #[account(address = protocol.token_mint @ ErrorCode::InvalidMint)]
    pub reward_mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = caller, associated_token::mint = reward_mint,
        associated_token::authority = legacy_reward)]
    pub legacy_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: the pinned DEX CPI derives, initializes and validates this token vault.
    #[account(mut, seeds = [solve::instructions::GAUGE_REWARD_VAULT_SEED, pool.key().as_ref()],
        bump, seeds::program = solve_program.key())]
    pub reward_vault: UncheckedAccount<'info>,
    pub solve_program: Program<'info, solve::program::Solve>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn configure_native_gauge(ctx: Context<ConfigureNativeGauge>, active: bool) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::GaugeActivation)?;
    let now = Clock::get()?.unix_timestamp;
    let finish = ctx.accounts.protocol.epoch_start_time.checked_add(ctx.accounts.protocol.epoch_reset_time)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    // A change only runs once it is scheduled and its epoch has begun
    // (activation or removal takes effect at the rollover after the request).
    {
        let gauge = &ctx.accounts.gauge;
        let wanted = if active { crate::states::GAUGE_PENDING_ACTIVATION } else { crate::states::GAUGE_PENDING_REMOVAL };
        require!(gauge.status == wanted, ErrorCode::GaugeStateInvalid);
        require!(ctx.accounts.protocol.current_epoch >= gauge.effective_epoch, ErrorCode::GaugeTransitionNotDue);
    }
    validate_activation(active, finish, now, ctx.accounts.token_mint_a.to_account_info().owner,
        ctx.accounts.token_mint_b.to_account_info().owner, ctx.accounts.pool.tick_spacing)?;
    // Old fees belong to the gauge, not to LPs after removal. Require an atomic
    // route_pool_fees instruction before this one when counters are nonzero.
    // Fees accrued under the old routing must be settled under it: voters' share
    // before removal, the Treasury's 5% (sweep_ungauged_pool_fees) before activation.
    require!(ctx.accounts.pool.protocol_fee_owed_a == 0 && ctx.accounts.pool.protocol_fee_owed_b == 0,
        ErrorCode::GaugeFeesMustBeSwept);
    let protocol_signer: &[&[u8]] = &[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]];
    let gate_phi = crate::states::AdminConfig::gate_phi_ppm(&ctx.accounts.admin_config.to_account_info(), ctx.program_id)?;
    let set_schedule = |rate: u128, end: i64| -> Result<()> {
        solve::cpi::set_gauge_emissions(CpiContext::new_with_signer(ctx.accounts.solve_program.to_account_info(),
            solve::cpi::accounts::SetGaugeEmissions {
                payer: ctx.accounts.caller.to_account_info(), authority: ctx.accounts.protocol.to_account_info(),
                solve: ctx.accounts.pool.to_account_info(), reward_mint: ctx.accounts.reward_mint.to_account_info(),
                reward_vault: ctx.accounts.reward_vault.to_account_info(), token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            }, &[protocol_signer]), rate, u64::try_from(end).map_err(|_| ErrorCode::ArithmeticOverflow)?, gate_phi)
    };
    // Checkpoint the DEX's old range-aware growth before changing its schedule.
    // On first activation this also creates a zero-rate native reward vault.
    set_schedule(0, now)?;
    let native = &mut ctx.accounts.native_gauge;
    if native.gauge == Pubkey::default() {
        native.gauge = ctx.accounts.gauge.key();
        native.pool = ctx.accounts.pool.key();
        native.reward_vault = ctx.accounts.reward_vault.key();
        native.bump = ctx.bumps.native_gauge;
        let legacy = &mut ctx.accounts.legacy_reward;
        if legacy.gauge == Pubkey::default() {
            legacy.gauge = ctx.accounts.gauge.key();
            legacy.reward_mint = ctx.accounts.reward_mint.key();
            legacy.bump = ctx.bumps.legacy_reward;
        }
        require!(legacy.gauge == ctx.accounts.gauge.key() && legacy.reward_mint == ctx.accounts.reward_mint.key(), ErrorCode::InvalidGauge);
        legacy.checkpoint(now)?;
        let unvested = remaining_stream(legacy.reward_rate_x64, legacy.period_finish, now)?;
        require!(ctx.accounts.legacy_vault.amount >= unvested, ErrorCode::InsufficientFunds);
        native.last_funded_epoch = legacy.last_funded_epoch;
        native.carry_amount = unvested;
        legacy.reward_rate_x64 = 0;
        legacy.period_finish = now;
        // Retain every already-earned legacy claim in its original vault. Only
        // the unvested remainder moves; mint supply does not change on migration.
        if unvested > 0 {
            let gauge_key = ctx.accounts.gauge.key();
            let signer: &[&[u8]] = &[GAUGE_REWARD_SEED, gauge_key.as_ref(), &[legacy.bump]];
            token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
                from: ctx.accounts.legacy_vault.to_account_info(), to: ctx.accounts.reward_vault.to_account_info(),
                authority: legacy.to_account_info(),
            }, &[signer]), unvested)?;
        }
    } else {
        require!(native.gauge == ctx.accounts.gauge.key() && native.pool == ctx.accounts.pool.key()
            && native.reward_vault == ctx.accounts.reward_vault.key(), ErrorCode::InvalidGauge);
        native.carry_amount = native.carry_amount.checked_add(remaining_stream(native.rate_x64, native.period_finish, now)?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    native.rate_x64 = 0;
    native.period_finish = now;
    if active && native.last_funded_epoch == ctx.accounts.protocol.current_epoch && native.carry_amount > 0 {
        native.rate_x64 = stream_rate(native.carry_amount, now, finish)?;
        native.period_finish = finish;
        native.carry_amount = 0;
    }
    set_schedule(native.rate_x64, native.period_finish)?;
    solve::cpi::set_protocol_fee_rate(CpiContext::new_with_signer(ctx.accounts.solve_program.to_account_info(),
        solve::cpi::accounts::SetProtocolFeeRate { solves_config: ctx.accounts.solves_config.to_account_info(),
            solve: ctx.accounts.pool.to_account_info(), fee_authority: ctx.accounts.protocol.to_account_info() }, &[protocol_signer]), if active { crate::constants::GAUGED_PROTOCOL_FEE_RATE } else { crate::constants::UNGAUGED_PROTOCOL_FEE_RATE })?;
    ctx.accounts.pool.reload()?;
    let gauge = &mut ctx.accounts.gauge;
    gauge.is_active = active;
    gauge.status = if active { crate::states::GAUGE_ACTIVE } else { crate::states::GAUGE_REMOVED };
    gauge.effective_epoch = 0;
    emit!(crate::events::GaugeStatusChanged {
        gauge: gauge.key(), pool: gauge.pool_address, status: gauge.status, epoch: ctx.accounts.protocol.current_epoch,
    });
    Ok(())
}

fn validate_activation(active: bool, finish: i64, now: i64, owner_a: &Pubkey, owner_b: &Pubkey, tick_spacing: u16) -> Result<()> {
    if active {
        require!(tick_spacing >= crate::constants::MIN_GAUGE_TICK_SPACING, ErrorCode::PoolRangeTooNarrow);
        require!(finish > now, ErrorCode::InvalidEpoch);
        // The fee router currently supports classic SPL only. Never activate a
        // pool whose fees it cannot sweep; allow pausing after a separate sweep.
        require!(*owner_a == token::ID && *owner_b == token::ID, ErrorCode::UnsupportedGaugeTokenProgram);
    }
    Ok(())
}

#[cfg(test)]
mod activation_tests {
    use super::*;
    #[test]
    fn pause_survives_missed_rollover_and_activation_rejects_unsupported_mints() {
        let other = Pubkey::new_unique();
        assert!(validate_activation(false, 100, 101, &other, &token::ID, 64).is_ok());
        assert!(validate_activation(true, 100, 101, &token::ID, &token::ID, 64).is_err());
        assert!(validate_activation(true, 200, 101, &other, &token::ID, 64).is_err());
        assert!(validate_activation(true, 200, 101, &token::ID, &other, 64).is_err());
        assert!(validate_activation(true, 200, 101, &token::ID, &token::ID, 64).is_ok());
        assert!(validate_activation(true, 200, 101, &token::ID, &token::ID, 1).is_ok(), "every fee tier is eligible");
        assert!(validate_activation(true, 200, 101, &token::ID, &token::ID, 0).is_err(), "zero spacing is invalid");
        assert!(validate_activation(false, 200, 101, &token::ID, &token::ID, 1).is_ok(), "pausing needs no floor");
    }
}

#[derive(Accounts)]
#[instruction(emission_epoch: u64)]
pub struct FundNativeGauge<'info> {
    #[account(mut)] pub caller: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump,
        constraint = protocol.current_epoch == emission_epoch @ ErrorCode::InvalidEpoch)]
    pub protocol: Box<Account<'info, Protocol>>,
    #[account(seeds = [EPOCH_DATA_SEED, voting_epoch.epoch.to_le_bytes().as_ref()], bump = voting_epoch.bump,
        constraint = voting_epoch.epoch.checked_add(1) == Some(emission_epoch) @ ErrorCode::InvalidEpoch)]
    pub voting_epoch: Box<Account<'info, Epoch>>,
    #[account(mut, seeds = [EPOCH_EMISSION_SEED, emission_epoch.to_le_bytes().as_ref()], bump = epoch_emission.bump)]
    pub epoch_emission: Box<Account<'info, EpochEmission>>,
    #[account(seeds = [GAUGE_SEED, protocol.key().as_ref(), pool.key().as_ref()], bump = gauge.bump,
        constraint = gauge.is_active @ ErrorCode::GaugeInactive,
        constraint = gauge.pool_address == pool.key() @ ErrorCode::InvalidGauge)]
    pub gauge: Box<Account<'info, Gauge>>,
    #[account(mut, seeds = [NATIVE_GAUGE_SEED, gauge.key().as_ref()], bump = native_gauge.bump,
        constraint = native_gauge.gauge == gauge.key() && native_gauge.pool == pool.key() @ ErrorCode::InvalidGauge)]
    pub native_gauge: Box<Account<'info, NativeGauge>>,
    #[account(mut, constraint = pool.has_gauge_reward() @ ErrorCode::NativeGaugeRequired,
        constraint = pool.protocol_fee_rate == 10_000 @ ErrorCode::NativeGaugeRequired)]
    pub pool: Box<Account<'info, solve::state::Solve>>,
    #[account(mut, address = protocol.token_mint @ ErrorCode::InvalidMint)]
    pub reward_mint: Account<'info, Mint>,
    #[account(mut, address = native_gauge.reward_vault, constraint = reward_vault.mint == reward_mint.key()
        && reward_vault.owner == pool.key() @ ErrorCode::InvalidMint)]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    pub solve_program: Program<'info, solve::program::Solve>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn fund_native_gauge(ctx: Context<FundNativeGauge>, emission_epoch: u64) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Emissions)?;
    let now = Clock::get()?.unix_timestamp;
    require!(now >= ctx.accounts.voting_epoch.end_time, ErrorCode::EpochNotEnded);
    require!(ctx.accounts.native_gauge.last_funded_epoch < emission_epoch, ErrorCode::EmissionAlreadyFunded);
    let epoch = &ctx.accounts.voting_epoch;
    require!(epoch.total_voting_power > 0, ErrorCode::InvalidVotingPower);
    let weight = epoch.gauge_weights.iter().find(|entry| entry.gauge == ctx.accounts.gauge.key())
        .ok_or(ErrorCode::InvalidGaugeVotes)?.weight;
    let amount = (ctx.accounts.epoch_emission.gauge_budget as u128).checked_mul(weight as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)? / epoch.total_voting_power as u128;
    let amount = u64::try_from(amount).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    require!(amount > 0, ErrorCode::InvalidAmount);
    let distributed = ctx.accounts.epoch_emission.distributed_to_gauges.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(distributed <= ctx.accounts.epoch_emission.gauge_budget, ErrorCode::ArithmeticOverflow);
    let finish = ctx.accounts.protocol.epoch_start_time.checked_add(ctx.accounts.protocol.epoch_reset_time).ok_or(ErrorCode::ArithmeticOverflow)?;
    let native = &mut ctx.accounts.native_gauge;
    let stream_amount = amount.checked_add(native.carry_amount).ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_add(remaining_stream(native.rate_x64, native.period_finish, now)?).ok_or(ErrorCode::ArithmeticOverflow)?;
    let rate = stream_rate(stream_amount, now, finish)?;
    let signer: &[&[u8]] = &[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]];
    token::mint_to(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), MintTo {
        mint: ctx.accounts.reward_mint.to_account_info(), to: ctx.accounts.reward_vault.to_account_info(),
        authority: ctx.accounts.protocol.to_account_info(),
    }, &[signer]), amount)?;
    let gate_phi = crate::states::AdminConfig::gate_phi_ppm(&ctx.accounts.admin_config.to_account_info(), ctx.program_id)?;
    solve::cpi::set_gauge_emissions(CpiContext::new_with_signer(ctx.accounts.solve_program.to_account_info(),
        solve::cpi::accounts::SetGaugeEmissions {
            payer: ctx.accounts.caller.to_account_info(), authority: ctx.accounts.protocol.to_account_info(), solve: ctx.accounts.pool.to_account_info(),
            reward_mint: ctx.accounts.reward_mint.to_account_info(), reward_vault: ctx.accounts.reward_vault.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(), system_program: ctx.accounts.system_program.to_account_info(),
        }, &[signer]), rate, u64::try_from(finish).map_err(|_| ErrorCode::ArithmeticOverflow)?, gate_phi)?;
    ctx.accounts.pool.reload()?;
    ctx.accounts.reward_vault.reload()?;
    native.last_funded_epoch = emission_epoch;
    native.rate_x64 = rate;
    native.period_finish = finish;
    native.carry_amount = 0;
    ctx.accounts.epoch_emission.distributed_to_gauges = distributed;
    Ok(())
}

/// Burns the part of a pool's gauge emissions that streamed while it had no
/// liquidity and therefore earned nobody anything. Permissionless: it can only
/// destroy tokens the pool has recorded as unearned, and every earned or
/// still-streaming token stays in the vault.
#[derive(Accounts)]
pub struct SettleNativeGaugeUnearned<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    #[account(seeds = [GAUGE_SEED, protocol.key().as_ref(), pool.key().as_ref()], bump = gauge.bump,
        constraint = gauge.pool_address == pool.key() @ ErrorCode::InvalidGauge)]
    pub gauge: Box<Account<'info, Gauge>>,
    #[account(seeds = [NATIVE_GAUGE_SEED, gauge.key().as_ref()], bump = native_gauge.bump,
        constraint = native_gauge.gauge == gauge.key() && native_gauge.pool == pool.key() @ ErrorCode::InvalidGauge)]
    pub native_gauge: Box<Account<'info, NativeGauge>>,
    #[account(mut)]
    pub pool: Box<Account<'info, solve::state::Solve>>,
    #[account(mut, address = protocol.token_mint @ ErrorCode::InvalidMint)]
    pub reward_mint: Account<'info, Mint>,
    #[account(mut, address = native_gauge.reward_vault)]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    pub solve_program: Program<'info, solve::program::Solve>,
    pub token_program: Program<'info, Token>,
}

pub fn settle_native_gauge_unearned(ctx: Context<SettleNativeGaugeUnearned>) -> Result<()> {
    let signer: &[&[u8]] = &[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]];
    solve::cpi::burn_unearned_gauge_emissions(CpiContext::new_with_signer(
        ctx.accounts.solve_program.to_account_info(),
        solve::cpi::accounts::BurnUnearnedGaugeEmissions {
            authority: ctx.accounts.protocol.to_account_info(),
            solve: ctx.accounts.pool.to_account_info(),
            reward_mint: ctx.accounts.reward_mint.to_account_info(),
            reward_vault: ctx.accounts.reward_vault.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        &[signer],
    ))
}
