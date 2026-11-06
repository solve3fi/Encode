use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{BRIBE_SEED, BRIBE_TOKEN_SEED, EPOCH_DATA_SEED, GAUGE_SEED, MAX_BRIBES_PER_GAUGE, PROTOCOL_SEED, VAULT_SEED};
use crate::errors::ErrorCode;
use crate::instructions::vote::voting_is_open;
use crate::states::{Bribe, BribeToken, BribeWeight, Gauge, Epoch, Protocol, VaultData};
use crate::utils::transfer_token_to_vault;

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct CreateBribe<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  // Pinned to the current epoch: a bribe can only be deposited into the epoch
  // that is open for voting, never into a finalized one.
  #[account(
    mut,
    seeds = [EPOCH_DATA_SEED, protocol.current_epoch.to_le_bytes().as_ref()],
    bump = epoch.bump,
    constraint = epoch.epoch == protocol.current_epoch @ ErrorCode::InvalidEpoch,
  )]
  pub epoch: Box<Account<'info, Epoch>>,

  // Only a genuine, active gauge of this protocol can receive bribes.
  #[account(
    seeds = [GAUGE_SEED, protocol.key().as_ref(), gauge.pool_address.as_ref()],
    bump = gauge.bump,
    constraint = gauge.accepts_bribes() @ ErrorCode::GaugeInactive,
  )]
  pub gauge: Box<Account<'info, Gauge>>,

  // Bribing is permissionless (see create_bribe below), so the first bribe
  // for a given (epoch, gauge) pair may be the only thing that ever touches
  // this vault — previously only the admin-only distribute_pool_reward
  // instruction could create it, and that instruction skips any pool with
  // zero swept trading fees, silently blocking bribes on every low/no-volume
  // pool. init_if_needed lets the first briber create it instead; the seeds
  // already bind the PDA to this exact (epoch, gauge) pair, so the old
  // manual vault.gauge/vault.epoch constraint is redundant (and would have
  // rejected a freshly-initialized, still-zeroed vault anyway).
  #[account(
    init_if_needed,
    payer = user,
    space = 8 + VaultData::INIT_SPACE,
    seeds = [VAULT_SEED, epoch.epoch.to_le_bytes().as_ref(), gauge.key().as_ref()],
    bump
  )]
  pub vault: Box<Account<'info, VaultData>>,

  #[account(mut)]
  pub token_mint: InterfaceAccount<'info, Mint>,

  // Admin-approved reward tokens only (rule A12). An unlisted mint has no
  // such account, so deserialization fails and the deposit is rejected.
  #[account(
    seeds = [BRIBE_TOKEN_SEED, token_mint.key().as_ref()],
    bump = bribe_token.bump,
    constraint = bribe_token.mint == token_mint.key() && bribe_token.accepts_deposits() @ ErrorCode::BribeTokenNotAllowed,
  )]
  pub bribe_token: Box<Account<'info, BribeToken>>,

  #[account(
    init_if_needed,
    payer = user,
    space = 8 + Bribe::INIT_SPACE,
    seeds = [BRIBE_SEED, gauge.key().as_ref(), token_mint.key().as_ref(), user.key().as_ref()],
    bump
  )]
  pub bribe: Box<Account<'info, Bribe>>,

  #[account(
    mut,
    constraint = user_token_account.mint == token_mint.key() @ ErrorCode::InvalidMint,
    constraint = user_token_account.owner == user.key() @ ErrorCode::InvalidOwner,
    constraint = user_token_account.amount >= amount @ ErrorCode::InsufficientFunds,
  )]
  pub user_token_account: InterfaceAccount<'info, TokenAccount>,

  // Same reasoning as `vault` above: this is the vault's own ATA for the
  // bribe token, which can't exist yet if the vault was just created by
  // this same instruction.
  #[account(
    init_if_needed,
    payer = user,
    associated_token::mint = token_mint,
    associated_token::authority = vault,
  )]
  pub bribe_token_account: InterfaceAccount<'info, TokenAccount>,

  pub system_program: Program<'info, System>,
  pub token_program: Interface<'info, TokenInterface>,
  pub associated_token_program: Program<'info, AssociatedToken>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn create_bribe<'info>(
  ctx: Context<CreateBribe>,
  amount: u64,
) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Bribes)?;
  require!(amount > 0, ErrorCode::InvalidAmount);

  // Same cutoff as voting (Wednesday 23:55 UTC), read from chain time.
  let now = Clock::get()?.unix_timestamp;
  require!(voting_is_open(now, ctx.accounts.epoch.end_time), ErrorCode::BribeWindowClosed);

  let bribe = &mut ctx.accounts.bribe;
  let epoch = &mut ctx.accounts.epoch;
  let vault = &mut ctx.accounts.vault;
  let gauge_key = ctx.accounts.gauge.key();
  let token_mint_key = ctx.accounts.token_mint.key();

  // A freshly init_if_needed'd vault deserializes as all-zero; a real vault
  // (from a prior bribe, or from distribute_pool_reward) always has a real
  // gauge pubkey. Only stamp identity fields on first creation so we never
  // clobber pool_rewards_a/b accumulated by distribute_pool_reward.
  if vault.gauge == Pubkey::default() {
    vault.admin = ctx.accounts.user.key();
    vault.gauge = gauge_key;
    vault.epoch = epoch.epoch;
    vault.bump = ctx.bumps.vault;
  }

  // Account for what the vault actually received, not what was requested:
  // a Token-2022 mint with a transfer fee delivers less than `amount`, and
  // recording the requested amount would promise voters more than the vault
  // holds.
  let balance_before = ctx.accounts.bribe_token_account.amount;
  transfer_token_to_vault(
    &ctx.accounts.user,
    &ctx.accounts.token_mint,
    &ctx.accounts.user_token_account,
    &ctx.accounts.bribe_token_account,
    &ctx.accounts.token_program,
    amount,
  )?;
  ctx.accounts.bribe_token_account.reload()?;
  let amount = ctx
    .accounts
    .bribe_token_account
    .amount
    .checked_sub(balance_before)
    .ok_or(ErrorCode::ArithmeticOverflow)?;
  require!(amount > 0, ErrorCode::InvalidAmount);


  match epoch.bribes.iter_mut().find(|b| b.gauge == gauge_key && b.token_mint == token_mint_key) {
    Some(b) => {
      b.amount = b.amount.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    None => {
      // Cap the number of distinct bribe (gauge, token_mint) entries per gauge
      // per epoch so a single gauge cannot be spammed with dummy-token bribes
      // to fill up the shared `epoch.bribes` vector and block bribes for
      // every other gauge for the rest of the epoch.
      let gauge_bribe_count = epoch.bribes.iter().filter(|b| b.gauge == gauge_key).count() as u64;
      require!(gauge_bribe_count < MAX_BRIBES_PER_GAUGE, ErrorCode::MaxBribesPerGaugeReached);

      epoch.bribes.push(BribeWeight {
        gauge: gauge_key,
        token_mint: token_mint_key,
        amount,
      });
    }
  }

  let total_amount = bribe.total_amount.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)?;

  bribe.gauge = gauge_key;
  bribe.token_mint = token_mint_key;
  bribe.creator = ctx.accounts.user.key();
  bribe.total_amount = total_amount;
  bribe.bump = ctx.bumps.bribe;

  Ok(())
}