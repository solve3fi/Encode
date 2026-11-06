use anchor_lang::prelude::*;

use crate::constants::{ADMIN_CONFIG_SEED, KEEPER_CONFIG_SEED, PARTNER_VOTER_SEED, PROTOCOL_SEED, TREASURY_CHANGE_DELAY_SECONDS, TREASURY_CHANGE_SEED};
use crate::errors::ErrorCode;
use crate::events::{AdminParamsUpdated, AdminTransferProposed, AdminTransferred, KeeperSet, PartnerVoterRemoved, PartnerVoterSet, PausesUpdated, TreasuryChangeScheduled, TreasuryChanged};
use crate::states::{AdminConfig, KeeperConfig, PartnerVoter, Protocol, TreasuryChange, MAX_GATE_PHI_PPM};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct PauseFlags {
  pub global: bool,
  pub voting: bool,
  pub bribes: bool,
  pub claims: bool,
  pub exit: bool,
  pub gauge_activation: bool,
  pub emissions: bool,
}

#[derive(Accounts)]
pub struct SetPauses<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init_if_needed,
    payer = admin,
    space = 8 + AdminConfig::INIT_SPACE,
    seeds = [ADMIN_CONFIG_SEED],
    bump,
  )]
  pub admin_config: Box<Account<'info, AdminConfig>>,

  pub system_program: Program<'info, System>,
}

/// Sets every pause switch at once. Takes effect immediately, in either
/// direction, so the Admin can pause an incident and unpause after
/// remediation without any delay. It never touches earned amounts.
pub fn set_pauses(ctx: Context<SetPauses>, flags: PauseFlags) -> Result<()> {
  let config = &mut ctx.accounts.admin_config;
  config.bump = ctx.bumps.admin_config;
  config.paused_global = flags.global;
  config.paused_voting = flags.voting;
  config.paused_bribes = flags.bribes;
  config.paused_claims = flags.claims;
  config.paused_exit = flags.exit;
  config.paused_gauge_activation = flags.gauge_activation;
  config.paused_emissions = flags.emissions;

  emit!(PausesUpdated {
    admin: ctx.accounts.admin.key(),
    paused_global: flags.global,
    paused_voting: flags.voting,
    paused_bribes: flags.bribes,
    paused_claims: flags.claims,
    paused_exit: flags.exit,
    paused_gauge_activation: flags.gauge_activation,
    paused_emissions: flags.emissions,
    updated_at: Clock::get()?.unix_timestamp,
  });
  Ok(())
}

#[derive(Accounts)]
pub struct ProposeAdmin<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init_if_needed,
    payer = admin,
    space = 8 + AdminConfig::INIT_SPACE,
    seeds = [ADMIN_CONFIG_SEED],
    bump,
  )]
  pub admin_config: Box<Account<'info, AdminConfig>>,

  pub system_program: Program<'info, System>,
}

/// First half of a two-step transfer: nothing changes until the new wallet
/// signs `accept_admin`, so a typo cannot hand the protocol to a dead key.
/// Proposing `Pubkey::default()` cancels a pending transfer. No program
/// upgrade is needed to move Admin to a multisig.
pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
  let config = &mut ctx.accounts.admin_config;
  config.bump = ctx.bumps.admin_config;
  config.pending_admin = new_admin;
  emit!(AdminTransferProposed {
    admin: ctx.accounts.admin.key(),
    pending_admin: new_admin,
  });
  Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
  #[account(mut)]
  pub new_admin: Signer<'info>,

  #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    seeds = [ADMIN_CONFIG_SEED],
    bump = admin_config.bump,
    constraint = admin_config.pending_admin != Pubkey::default()
      && admin_config.pending_admin == new_admin.key() @ ErrorCode::Unauthorized,
  )]
  pub admin_config: Box<Account<'info, AdminConfig>>,
}

pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
  let old_admin = ctx.accounts.protocol.admin;
  ctx.accounts.protocol.admin = ctx.accounts.new_admin.key();
  ctx.accounts.admin_config.pending_admin = Pubkey::default();
  emit!(AdminTransferred {
    old_admin,
    new_admin: ctx.accounts.protocol.admin,
  });
  Ok(())
}

#[derive(Accounts)]
pub struct SetAdminParams<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init_if_needed,
    payer = admin,
    space = 8 + AdminConfig::INIT_SPACE,
    seeds = [ADMIN_CONFIG_SEED],
    bump,
  )]
  pub admin_config: Box<Account<'info, AdminConfig>>,

  pub system_program: Program<'info, System>,
}

fn emit_params(ctx: &Context<SetAdminParams>) -> Result<()> {
  let config = &ctx.accounts.admin_config;
  emit!(AdminParamsUpdated {
    admin: ctx.accounts.admin.key(),
    gate_phi_set: config.gate_phi_set,
    gate_phi_ppm: config.gate_phi_ppm,
    treasury: config.treasury,
    updated_at: Clock::get()?.unix_timestamp,
  });
  Ok(())
}

/// Sets the activity-gate threshold in parts per million of in-range liquidity
/// value per hour (100 = 1 basis point). 0 turns the gate off. Each gauge picks
/// the value up the next time its schedule is set, which is at its next
/// funding (the next epoch) or when Admin reconfigures it.
pub fn set_gate_threshold(ctx: Context<SetAdminParams>, gate_phi_ppm: u32) -> Result<()> {
  require!(gate_phi_ppm <= MAX_GATE_PHI_PPM, ErrorCode::InvalidGateThreshold);
  let config = &mut ctx.accounts.admin_config;
  config.bump = ctx.bumps.admin_config;
  config.gate_phi_set = true;
  config.gate_phi_ppm = gate_phi_ppm;
  emit_params(&ctx)
}

#[derive(Accounts)]
pub struct SetTreasury<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init_if_needed,
    payer = admin,
    space = 8 + AdminConfig::INIT_SPACE,
    seeds = [ADMIN_CONFIG_SEED],
    bump,
  )]
  pub admin_config: Box<Account<'info, AdminConfig>>,

  #[account(
    init_if_needed,
    payer = admin,
    space = 8 + TreasuryChange::INIT_SPACE,
    seeds = [TREASURY_CHANGE_SEED],
    bump,
  )]
  pub treasury_change: Box<Account<'info, TreasuryChange>>,

  pub system_program: Program<'info, System>,
}

/// Sets where Treasury-bound funds (exit fees, auto-vote fees, unvoted fees and bribes) are sent. The first
/// Treasury takes effect at once; any later change waits TREASURY_CHANGE_DELAY_SECONDS and is then applied
/// by anyone with `apply_treasury_change` (review H-1). Scheduling `Pubkey::default()` cancels a pending change.
pub fn set_treasury(ctx: Context<SetTreasury>, treasury: Pubkey) -> Result<()> {
  let config = &mut ctx.accounts.admin_config;
  config.bump = ctx.bumps.admin_config;
  let change = &mut ctx.accounts.treasury_change;
  change.bump = ctx.bumps.treasury_change;
  if config.treasury == Pubkey::default() {
    require!(treasury != Pubkey::default(), ErrorCode::TreasuryNotSet);
    config.treasury = treasury;
    change.treasury = Pubkey::default();
    change.executable_at = 0;
    emit!(TreasuryChanged { treasury });
    return Ok(());
  }
  if treasury == Pubkey::default() {
    change.treasury = Pubkey::default();
    change.executable_at = 0;
  } else {
    change.treasury = treasury;
    change.executable_at = Clock::get()?
      .unix_timestamp
      .checked_add(TREASURY_CHANGE_DELAY_SECONDS)
      .ok_or(ErrorCode::ArithmeticOverflow)?;
  }
  emit!(TreasuryChangeScheduled { admin: ctx.accounts.admin.key(), treasury: change.treasury, executable_at: change.executable_at });
  Ok(())
}

#[derive(Accounts)]
pub struct ApplyTreasuryChange<'info> {
  pub caller: Signer<'info>,

  #[account(mut, seeds = [ADMIN_CONFIG_SEED], bump = admin_config.bump)]
  pub admin_config: Box<Account<'info, AdminConfig>>,

  #[account(mut, seeds = [TREASURY_CHANGE_SEED], bump = treasury_change.bump)]
  pub treasury_change: Box<Account<'info, TreasuryChange>>,
}

/// Applies a scheduled Treasury change once its delay has passed. Permissionless.
pub fn apply_treasury_change(ctx: Context<ApplyTreasuryChange>) -> Result<()> {
  let change = &mut ctx.accounts.treasury_change;
  let now = Clock::get()?.unix_timestamp;
  require!(
    change.treasury != Pubkey::default() && change.executable_at > 0 && now >= change.executable_at,
    ErrorCode::TreasuryChangeNotDue
  );
  ctx.accounts.admin_config.treasury = change.treasury;
  emit!(TreasuryChanged { treasury: change.treasury });
  change.treasury = Pubkey::default();
  change.executable_at = 0;
  Ok(())
}

#[derive(Accounts)]
pub struct SetKeeper<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init_if_needed,
    payer = admin,
    space = 8 + KeeperConfig::INIT_SPACE,
    seeds = [KEEPER_CONFIG_SEED],
    bump,
  )]
  pub keeper_config: Box<Account<'info, KeeperConfig>>,

  pub system_program: Program<'info, System>,
}

/// Names the price keeper, the only key besides the Admin that may update the exit price (within the step
/// bounds). `Pubkey::default()` removes it.
pub fn set_keeper(ctx: Context<SetKeeper>, keeper: Pubkey) -> Result<()> {
  let config = &mut ctx.accounts.keeper_config;
  config.bump = ctx.bumps.keeper_config;
  config.keeper = keeper;
  emit!(KeeperSet { admin: ctx.accounts.admin.key(), keeper });
  Ok(())
}

#[derive(Accounts)]
#[instruction(voter: Pubkey)]
pub struct SetPartnerVoter<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    init_if_needed,
    payer = admin,
    space = 8 + PartnerVoter::INIT_SPACE,
    seeds = [PARTNER_VOTER_SEED, voter.as_ref()],
    bump,
  )]
  pub partner_voter: Box<Account<'info, PartnerVoter>>,

  pub system_program: Program<'info, System>,
}

/// Flags `voter` as a partner voter: locks it votes for pay no auto-vote fee when they claim.
pub fn set_partner_voter(ctx: Context<SetPartnerVoter>, voter: Pubkey) -> Result<()> {
  let flag = &mut ctx.accounts.partner_voter;
  flag.voter = voter;
  flag.added_at = Clock::get()?.unix_timestamp;
  flag.bump = ctx.bumps.partner_voter;
  emit!(PartnerVoterSet { admin: ctx.accounts.admin.key(), voter });
  Ok(())
}

#[derive(Accounts)]
pub struct RemovePartnerVoter<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    close = admin,
    seeds = [PARTNER_VOTER_SEED, partner_voter.voter.as_ref()],
    bump = partner_voter.bump,
  )]
  pub partner_voter: Box<Account<'info, PartnerVoter>>,
}

/// Removes the partner flag. Claims made afterwards for locks that voter cast pay the standard fee again.
pub fn remove_partner_voter(ctx: Context<RemovePartnerVoter>) -> Result<()> {
  emit!(PartnerVoterRemoved { admin: ctx.accounts.admin.key(), voter: ctx.accounts.partner_voter.voter });
  Ok(())
}
