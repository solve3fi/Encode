use anchor_lang::prelude::*;

use crate::constants::{ALLOCATION_VOTER_SEED, MAX_GAUGE_VOTES, PROTOCOL_SEED, USER_VOTE_SEED, VE_LOCK_SEED, VOTE_LOCK_SEED, VOTE_WEIGHT_PRECISION};
use crate::errors::ErrorCode;
use crate::events::{AllocationVoteApplied, AllocationVoterSet, AllocationVotesSet};
use crate::instructions::vote::{cast_vote, voting_is_open};
use crate::states::{AllocationVoter, Epoch, Gauge, GaugeVote, Lock, Protocol, UserVote, VoteLockRecord};

/// Admin marks a lock as a protocol allocation, so Admin can cast its votes
/// (the owner can still vote it too). Admin picks the gauges and the share of
/// power for each epoch through `vote`; unassigned power abstains.
#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct RegisterAllocationVoter<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()], bump = lock.bump)]
  pub lock: Box<Account<'info, Lock>>,

  #[account(
    init,
    payer = admin,
    space = 8 + AllocationVoter::INIT_SPACE,
    seeds = [ALLOCATION_VOTER_SEED, lock.key().as_ref()],
    bump
  )]
  pub allocation_voter: Box<Account<'info, AllocationVoter>>,

  pub system_program: Program<'info, System>,
}

pub fn register_allocation_voter(ctx: Context<RegisterAllocationVoter>, _ve_token_id: u64) -> Result<()> {
  let record = &mut ctx.accounts.allocation_voter;
  record.lock = ctx.accounts.lock.key();
  record.owner = ctx.accounts.lock.owner;
  record.bump = ctx.bumps.allocation_voter;
  record.votes = Vec::new();
  record.version = 0;
  record.applied_epoch_plus_one = 0;
  record.applied_version = 0;
  emit!(AllocationVoterSet { lock: record.lock, owner: record.owner, registered: true });
  Ok(())
}

#[derive(Accounts)]
pub struct UnregisterAllocationVoter<'info> {
  #[account(mut, constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    close = admin,
    seeds = [ALLOCATION_VOTER_SEED, allocation_voter.lock.as_ref()],
    bump = allocation_voter.bump
  )]
  pub allocation_voter: Box<Account<'info, AllocationVoter>>,
}

pub fn unregister_allocation_voter(ctx: Context<UnregisterAllocationVoter>) -> Result<()> {
  let record = &ctx.accounts.allocation_voter;
  emit!(AllocationVoterSet { lock: record.lock, owner: record.owner, registered: false });
  Ok(())
}

/// Admin stores the standing split for a registered allocation lock (percent
/// per gauge, total at most 100; empty clears it). Anyone can then apply it
/// each epoch with `apply_allocation_vote`. Changing it bumps `version`, so a
/// changed config can be re-applied even in an epoch that already has a vote.
#[derive(Accounts)]
pub struct SetAllocationVotes<'info> {
  #[account(constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized)]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    seeds = [ALLOCATION_VOTER_SEED, allocation_voter.lock.as_ref()],
    bump = allocation_voter.bump
  )]
  pub allocation_voter: Box<Account<'info, AllocationVoter>>,
}

pub fn set_allocation_votes(ctx: Context<SetAllocationVotes>, votes: Vec<GaugeVote>) -> Result<()> {
  require!(votes.len() <= MAX_GAUGE_VOTES as usize, ErrorCode::InvalidGaugeVotes);
  let mut total: u64 = 0;
  let mut seen = std::collections::HashSet::new();
  for v in &votes {
    require!(seen.insert(v.gauge), ErrorCode::InvalidGaugeVotes);
    require!(v.weight > 0 && v.weight <= VOTE_WEIGHT_PRECISION, ErrorCode::InvalidVotingPower);
    total = total.checked_add(v.weight).ok_or(ErrorCode::ArithmeticOverflow)?;
  }
  require!(total <= VOTE_WEIGHT_PRECISION, ErrorCode::InvalidVotingPower);

  let record = &mut ctx.accounts.allocation_voter;
  record.votes = votes;
  record.version = record.version.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;
  emit!(AllocationVotesSet { lock: record.lock, version: record.version, gauge_count: record.votes.len() as u32 });
  Ok(())
}

/// Permissionless crank: casts the stored split for this epoch. Gauges that no
/// longer accept votes are skipped (their share abstains). Pass one gauge
/// account per stored entry, in stored order, as remaining accounts.
#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct ApplyAllocationVote<'info> {
  #[account(mut)]
  pub payer: Signer<'info>,

  #[account(
    mut,
    seeds = [PROTOCOL_SEED],
    bump = protocol.bump,
    constraint = protocol.current_epoch == epoch.epoch @ ErrorCode::InvalidEpoch,
  )]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(mut, constraint = epoch.epoch == protocol.current_epoch @ ErrorCode::InvalidEpoch)]
  pub epoch: Box<Account<'info, Epoch>>,

  #[account(mut, seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()], bump = lock.bump)]
  pub lock: Box<Account<'info, Lock>>,

  #[account(
    mut,
    seeds = [ALLOCATION_VOTER_SEED, lock.key().as_ref()],
    bump = allocation_voter.bump
  )]
  pub allocation_voter: Box<Account<'info, AllocationVoter>>,

  #[account(
    init_if_needed,
    payer = payer,
    space = 8 + UserVote::INIT_SPACE,
    seeds = [USER_VOTE_SEED, lock.key().as_ref(), protocol.current_epoch.to_le_bytes().as_ref()],
    bump
  )]
  pub user_vote: Box<Account<'info, UserVote>>,

  #[account(
    init_if_needed,
    payer = payer,
    space = 8 + VoteLockRecord::INIT_SPACE,
    seeds = [VOTE_LOCK_SEED, lock.key().as_ref(), protocol.current_epoch.to_le_bytes().as_ref()],
    bump
  )]
  pub vote_lock_record: Box<Account<'info, VoteLockRecord>>,

  pub system_program: Program<'info, System>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn apply_allocation_vote<'info>(
  ctx: Context<'_, '_, 'info, 'info, ApplyAllocationVote<'info>>,
  ve_token_id: u64,
) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Voting)?;
  let current_time = Clock::get()?.unix_timestamp;
  let record = &mut ctx.accounts.allocation_voter;
  let epoch_plus_one = ctx.accounts.protocol.current_epoch.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;

  // Admin voting lapses if the lock changed hands since registration.
  require!(record.owner == ctx.accounts.lock.owner, ErrorCode::InvalidOwner);
  require!(voting_is_open(current_time, ctx.accounts.epoch.end_time), ErrorCode::VoteExpired);
  require!(
    !(record.applied_epoch_plus_one == epoch_plus_one && record.applied_version == record.version),
    ErrorCode::AllocationAlreadyApplied
  );
  require!(ctx.remaining_accounts.len() == record.votes.len(), ErrorCode::InvalidGaugeVotes);

  let mut live: Vec<GaugeVote> = Vec::new();
  let mut live_accounts: Vec<AccountInfo<'info>> = Vec::new();
  for (stored, info) in record.votes.iter().zip(ctx.remaining_accounts.iter()) {
    require!(info.key() == stored.gauge, ErrorCode::InvalidGauge);
    require!(info.owner == &crate::ID, ErrorCode::InvalidGauge);
    let gauge = Gauge::try_deserialize(&mut &info.try_borrow_data()?[..]).map_err(|_| ErrorCode::InvalidGauge)?;
    if gauge.accepts_votes() {
      live.push(stored.clone());
      live_accounts.push(info.clone());
    }
  }
  require!(!live.is_empty(), ErrorCode::NoVotableAllocation);

  let lock_key = ctx.accounts.lock.key();
  cast_vote(
    &mut ctx.accounts.protocol,
    &mut ctx.accounts.epoch,
    &mut ctx.accounts.lock,
    &mut ctx.accounts.user_vote,
    &mut ctx.accounts.vote_lock_record,
    &live_accounts,
    lock_key,
    ve_token_id,
    live,
    current_time,
    ctx.bumps.user_vote,
    ctx.bumps.vote_lock_record,
    None,
  )?;

  record.applied_epoch_plus_one = epoch_plus_one;
  record.applied_version = record.version;
  emit!(AllocationVoteApplied { lock: record.lock, epoch: ctx.accounts.protocol.current_epoch, version: record.version });
  Ok(())
}
