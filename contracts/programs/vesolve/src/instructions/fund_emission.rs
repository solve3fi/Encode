use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, TokenAccount, TokenInterface};

use crate::constants::{
    EPOCH_DATA_SEED, EPOCH_EMISSION_SEED, GAUGE_REWARD_SEED, PROTOCOL_SEED, WEEK,
};
use crate::errors::ErrorCode;
use crate::states::{emission_split, Epoch, EpochEmission, Gauge, GaugeReward, Protocol};

#[derive(Accounts)]
#[instruction(emission_epoch: u64)]
pub struct InitializeEpochEmission<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    #[account(
        seeds = [EPOCH_DATA_SEED, voting_epoch.epoch.to_le_bytes().as_ref()],
        bump = voting_epoch.bump,
        constraint = voting_epoch.epoch.checked_add(1) == Some(emission_epoch) @ ErrorCode::InvalidEpoch,
    )]
    pub voting_epoch: Box<Account<'info, Epoch>>,
    #[account(
        init,
        payer = caller,
        space = 8 + EpochEmission::INIT_SPACE,
        seeds = [EPOCH_EMISSION_SEED, emission_epoch.to_le_bytes().as_ref()],
        bump,
    )]
    pub epoch_emission: Box<Account<'info, EpochEmission>>,
    /// CHECK: constrained to the protocol's configured developer wallet.
    #[account(address = protocol.admin)]
    pub developer_wallet: UncheckedAccount<'info>,
    #[account(mut, address = protocol.token_mint @ ErrorCode::InvalidMint)]
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = developer_wallet,
    )]
    pub developer_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn initialize_epoch_emission(
    ctx: Context<InitializeEpochEmission>,
    emission_epoch: u64,
) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Emissions)?;
    let now = Clock::get()?.unix_timestamp;
    require!(now >= ctx.accounts.voting_epoch.end_time, ErrorCode::EpochNotEnded);
    require!(ctx.accounts.protocol.current_epoch == emission_epoch, ErrorCode::InvalidEpoch);
    let (total, gauge_budget, developer) = emission_split(ctx.accounts.voting_epoch.epoch)?;

    let cpi_accounts = MintTo {
        mint: ctx.accounts.token_mint.to_account_info(),
        to: ctx.accounts.developer_token_account.to_account_info(),
        authority: ctx.accounts.protocol.to_account_info(),
    };
    let protocol_signer: &[&[u8]] = &[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]];
    mint_to(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(), cpi_accounts, &[protocol_signer]
    ), developer)?;

    let record = &mut ctx.accounts.epoch_emission;
    record.epoch = emission_epoch;
    record.total_emission = total;
    record.gauge_budget = gauge_budget;
    record.developer_allocation = developer;
    record.distributed_to_gauges = 0;
    record.developer_wallet = ctx.accounts.developer_wallet.key();
    record.bump = ctx.bumps.epoch_emission;
    Ok(())
}

#[derive(Accounts)]
#[instruction(emission_epoch: u64)]
pub struct FundGaugeEmission<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    #[account(
        seeds = [EPOCH_DATA_SEED, voting_epoch.epoch.to_le_bytes().as_ref()],
        bump = voting_epoch.bump,
        constraint = voting_epoch.epoch.checked_add(1) == Some(emission_epoch) @ ErrorCode::InvalidEpoch,
    )]
    pub voting_epoch: Box<Account<'info, Epoch>>,
    #[account(
        mut,
        seeds = [EPOCH_EMISSION_SEED, emission_epoch.to_le_bytes().as_ref()],
        bump = epoch_emission.bump,
        constraint = epoch_emission.epoch == emission_epoch @ ErrorCode::InvalidEpoch,
    )]
    pub epoch_emission: Box<Account<'info, EpochEmission>>,
    #[account(constraint = gauge.is_active @ ErrorCode::InvalidGauge)]
    pub gauge: Box<Account<'info, Gauge>>,
    #[account(
        init_if_needed,
        payer = caller,
        space = 8 + GaugeReward::INIT_SPACE,
        seeds = [GAUGE_REWARD_SEED, gauge.key().as_ref()],
        bump,
    )]
    pub gauge_reward: Box<Account<'info, GaugeReward>>,
    #[account(mut, address = protocol.token_mint @ ErrorCode::InvalidMint)]
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = gauge_reward,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn fund_gauge_emission(ctx: Context<FundGaugeEmission>, emission_epoch: u64) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Emissions)?;
    let now = Clock::get()?.unix_timestamp;
    let protocol = &ctx.accounts.protocol;
    let voting_epoch = &ctx.accounts.voting_epoch;
    require!(now >= voting_epoch.end_time, ErrorCode::EpochNotEnded);
    require!(protocol.current_epoch == emission_epoch, ErrorCode::InvalidEpoch);
    require!(voting_epoch.total_voting_power > 0, ErrorCode::InvalidVotingPower);

    let gauge_weight = voting_epoch.gauge_weights.iter()
        .find(|entry| entry.gauge == ctx.accounts.gauge.key())
        .ok_or(ErrorCode::InvalidGaugeVotes)?;
    let amount = (ctx.accounts.epoch_emission.gauge_budget as u128)
        .checked_mul(gauge_weight.weight as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(voting_epoch.total_voting_power as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let amount = u64::try_from(amount).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    require!(amount > 0, ErrorCode::InvalidAmount);

    let reward = &mut ctx.accounts.gauge_reward;
    if reward.gauge != Pubkey::default() {
        require!(reward.last_funded_epoch != emission_epoch, ErrorCode::EmissionAlreadyFunded);
    } else {
        reward.gauge = ctx.accounts.gauge.key();
        reward.reward_mint = ctx.accounts.token_mint.key();
        reward.bump = ctx.bumps.gauge_reward;
    }

    let finish = protocol.epoch_start_time
        .checked_add(WEEK)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    reward.start_period(amount, now, finish, emission_epoch)?;

    let cpi_accounts = MintTo {
        mint: ctx.accounts.token_mint.to_account_info(),
        to: ctx.accounts.reward_vault.to_account_info(),
        authority: ctx.accounts.protocol.to_account_info(),
    };
    let protocol_signer: &[&[u8]] = &[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]];
    mint_to(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(), cpi_accounts, &[protocol_signer]
    ), amount)?;

    ctx.accounts.epoch_emission.distributed_to_gauges = ctx.accounts.epoch_emission
        .distributed_to_gauges.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        ctx.accounts.epoch_emission.distributed_to_gauges <= ctx.accounts.epoch_emission.gauge_budget,
        ErrorCode::ArithmeticOverflow
    );
    Ok(())
}
