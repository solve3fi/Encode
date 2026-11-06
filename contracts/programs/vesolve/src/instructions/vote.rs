use anchor_lang::prelude::*;

use crate::auth::admin::is_auto_vote_keeper;
use crate::constants::{AUTO_VOTE_DELEGATE_SEED, PROTOCOL_SEED, USER_VOTE_SEED, VE_LOCK_SEED, VOTE_LOCK_SEED, VOTE_REVOCATION_DEADLINE, MAX_GAUGE_VOTES, VOTE_WEIGHT_PRECISION};
use crate::errors::ErrorCode;
use crate::instructions::auto_vote::delegate_is_current;
use crate::states::{AllocationVoter, AutoVoteDelegate, AutoVoteEnrollment, Epoch, Gauge, GaugeVote, GaugeWeight, Lock, Protocol, UserVote, VoteLockRecord};

pub(crate) fn voting_is_open(current_time: i64, epoch_end_time: i64) -> bool {
  matches!(
    current_time.checked_add(VOTE_REVOCATION_DEADLINE),
    Some(cutoff_time) if cutoff_time < epoch_end_time
  )
}

// Either the lock's own owner signs directly, or the public Auto-Vote
// keeper signs on an *enrolled* lock's behalf (see instructions/auto_vote.rs).
// `enrollment` is checked by field (`.lock == lock.key()`) rather than by
// re-deriving its PDA here: Anchor's Account<'info, T> deserialization
// already proves it's a genuine AutoVoteEnrollment owned by this program,
// and such an account can only ever have been created (with that seeds
// constraint) by enroll_auto_vote -- so the field match alone is sufficient
// to prove this specific record belongs to this specific lock.
//
// Returns how many leading remaining_accounts are gauge accounts. The Solve3
// keeper path appends one more account after the gauges: the lock's
// AutoVoteDelegate PDA (DEV-12), which must not hold a current choice of
// another voter -- an owner who picked a third-party voter is voted only by
// that voter (instructions/auto_vote.rs, delegated_vote).
fn auto_vote_authorized(
  user: &Pubkey,
  admin: &Pubkey,
  lock_key: &Pubkey,
  lock_owner: &Pubkey,
  enrollment: &Option<Box<Account<AutoVoteEnrollment>>>,
  allocation: &Option<Box<Account<AllocationVoter>>>,
  remaining_accounts: &[AccountInfo],
) -> Result<(usize, Option<Pubkey>)> {
  if lock_owner == user {
    return Ok((remaining_accounts.len(), None));
  }
  // Protocol allocations (A10): Admin votes a registered lock as long as it
  // is still held by the wallet it was registered under.
  if user == admin {
    let record = allocation.as_ref().ok_or(ErrorCode::InvalidOwner)?;
    require!(record.lock == *lock_key && record.owner == *lock_owner, ErrorCode::InvalidOwner);
    return Ok((remaining_accounts.len(), None));
  }
  require!(is_auto_vote_keeper(user), ErrorCode::InvalidOwner);
  let enrollment = enrollment.as_ref().ok_or(ErrorCode::InvalidOwner)?;
  require!(enrollment.lock == *lock_key, ErrorCode::InvalidOwner);
  // An enrollment made by an earlier owner does not carry over to whoever holds the lock now (review M-1).
  require!(enrollment.owner == *lock_owner, ErrorCode::InvalidOwner);

  let delegate_info = remaining_accounts.last().ok_or(ErrorCode::AutoVoterNotChosen)?;
  let (expected, _) = Pubkey::find_program_address(&[AUTO_VOTE_DELEGATE_SEED, lock_key.as_ref()], &crate::ID);
  require_keys_eq!(delegate_info.key(), expected, ErrorCode::AutoVoterNotChosen);
  if delegate_info.owner == &crate::ID && !delegate_info.data_is_empty() {
    let delegate = AutoVoteDelegate::try_deserialize(&mut &delegate_info.try_borrow_data()?[..])
      .map_err(|_| ErrorCode::AutoVoterNotChosen)?;
    require!(
      !delegate_is_current(&delegate, lock_key, enrollment.enrolled_at) || is_auto_vote_keeper(&delegate.voter),
      ErrorCode::AutoVoterNotChosen
    );
  }
  Ok((remaining_accounts.len() - 1, Some(*user)))
}

#[derive(Accounts)]
#[instruction(ve_token_id: u64, gauge_votes: Vec<GaugeVote>)]
pub struct Vote<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  #[account(
    mut,
    seeds = [PROTOCOL_SEED],
    bump = protocol.bump,
    constraint = protocol.current_epoch == epoch.epoch @ ErrorCode::InvalidEpoch,
  )]
  pub protocol: Box<Account<'info, Protocol>>,

  #[account(
    mut,
    constraint = epoch.epoch == protocol.current_epoch @ ErrorCode::InvalidEpoch,
  )]
  pub epoch: Box<Account<'info, Epoch>>,

  #[account(
    mut,
    seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()],
    bump = lock.bump,
  )]
  pub lock: Box<Account<'info, Lock>>,

  /// Only required when `user` is the AUTO_VOTE_KEEPER voting on someone
  /// else's behalf. The owner voting directly passes None.
  pub auto_vote_enrollment: Option<Box<Account<'info, AutoVoteEnrollment>>>,

  /// Only required when `user` is the protocol Admin voting a registered
  /// protocol allocation.
  #[account(mut)]
  pub allocation_voter: Option<Box<Account<'info, AllocationVoter>>>,

  #[account(
      init_if_needed,
      payer = user,
      space = 8 + UserVote::INIT_SPACE,
      seeds = [USER_VOTE_SEED, lock.key().as_ref(), protocol.current_epoch.to_le_bytes().as_ref()],
      bump
  )]
  pub user_vote: Box<Account<'info, UserVote>>,

  #[account(
      init_if_needed,
      payer = user,
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

pub fn vote<'info>(
  ctx: Context<'_, '_, 'info, 'info, Vote<'info>>,
  ve_token_id: u64,
  gauge_votes: Vec<GaugeVote>,
) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Voting)?;
  let clock = Clock::get()?;
  let current_time = clock.unix_timestamp;

  let (gauge_account_count, auto_voter) = auto_vote_authorized(
    &ctx.accounts.user.key(),
    &ctx.accounts.protocol.admin,
    &ctx.accounts.lock.key(),
    &ctx.accounts.lock.owner,
    &ctx.accounts.auto_vote_enrollment,
    &ctx.accounts.allocation_voter,
    ctx.remaining_accounts,
  )?;

  let lock_key = ctx.accounts.lock.key();
  cast_vote(
    &mut ctx.accounts.protocol,
    &mut ctx.accounts.epoch,
    &mut ctx.accounts.lock,
    &mut ctx.accounts.user_vote,
    &mut ctx.accounts.vote_lock_record,
    &ctx.remaining_accounts[..gauge_account_count],
    lock_key,
    ve_token_id,
    gauge_votes,
    current_time,
    ctx.bumps.user_vote,
    ctx.bumps.vote_lock_record,
    auto_voter,
  )?;

  // An Admin vote on a registered allocation lock counts as this epoch's
  // application of the standing config, so a later crank does not override it.
  if ctx.accounts.user.key() == ctx.accounts.protocol.admin {
    if let Some(record) = ctx.accounts.allocation_voter.as_mut() {
      if record.lock == lock_key {
        record.applied_epoch_plus_one = ctx.accounts.protocol.current_epoch.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;
        record.applied_version = record.version;
      }
    }
  }

  Ok(())
}

pub(crate) fn cast_vote<'info>(
  protocol: &mut Protocol,
  epoch: &mut Epoch,
  lock: &mut Lock,
  user_vote: &mut UserVote,
  vote_lock_record: &mut VoteLockRecord,
  remaining_accounts: &[AccountInfo<'info>],
  lock_key: Pubkey,
  ve_token_id: u64,
  gauge_votes: Vec<GaugeVote>,
  current_time: i64,
  user_vote_bump: u8,
  vote_lock_record_bump: u8,
  auto_voter: Option<Pubkey>,
) -> Result<()> {
  require!(ve_token_id == lock.ve_token_id, ErrorCode::InvalidVeTokenId);
  require!(voting_is_open(current_time, epoch.end_time), ErrorCode::VoteExpired);
  require!(gauge_votes.len() > 0, ErrorCode::InvalidGaugeVotes);
  require!(gauge_votes.len() <= MAX_GAUGE_VOTES as usize, ErrorCode::InvalidGaugeVotes);

  // Each gauge_votes entry must be backed by its real Gauge account, passed
  // in the same order via remaining_accounts, so we can reject arbitrary
  // pubkeys (see audit finding H-04). Deserializing as Account<Gauge>
  // already enforces the account is owned by this program and carries the
  // Gauge discriminator, which only create_gauge's `init` can produce.
  require!(remaining_accounts.len() == gauge_votes.len(), ErrorCode::InvalidGaugeVotes);

  // Validate individual vote weights and calculate total percentage
  let mut total_weight_percentage: u64 = 0;
  let mut unique_gauges = std::collections::HashSet::new();

  for (i, vote) in gauge_votes.iter().enumerate() {
    require!(unique_gauges.insert(vote.gauge), ErrorCode::InvalidGaugeVotes);
    // A zero-weight entry contributes no voting power but still burns a
    // slot in epoch.gauge_weights (capped at MAX_VOTE_WEIGHT) and a vote
    // count towards epoch.total_votes for a gauge the caller never
    // meaningfully voted for.
    require!(vote.weight > 0, ErrorCode::InvalidVotingPower);
    require!(vote.weight <= VOTE_WEIGHT_PRECISION, ErrorCode::InvalidVotingPower);

    let gauge_account_info = &remaining_accounts[i];
    require!(gauge_account_info.key() == vote.gauge, ErrorCode::InvalidGauge);
    require!(gauge_account_info.owner == &crate::ID, ErrorCode::InvalidGauge);
    let gauge_account = Gauge::try_deserialize(&mut &gauge_account_info.try_borrow_data()?[..])
      .map_err(|_| ErrorCode::InvalidGauge)?;
    require!(gauge_account.accepts_votes(), ErrorCode::InvalidGauge);

    total_weight_percentage = total_weight_percentage
        .checked_add(vote.weight)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
  }

  // A voter may only ever allocate up to 100% of their voting power across
  // all gauges in a single vote call (see audit finding C-02). Per-gauge
  // validation (genuine, active Gauge account, supplied in order via
  // remaining_accounts — audit finding H-04) already happened above, in
  // the same pass that summed total_weight_percentage.
  require!(
    total_weight_percentage <= VOTE_WEIGHT_PRECISION,
    ErrorCode::InvalidVotingPower
  );

  // Calculate actual voting power allocation based on percentages
  let current_voting_power = lock.calculate_voting_power(current_time);
  require!(current_voting_power > 0, ErrorCode::InvalidVotingPower);

  // Convert gauge votes from percentages to actual voting power
  let mut actual_gauge_votes = Vec::new();
  for vote in &gauge_votes {
    let actual_weight = (current_voting_power as u128)
        .checked_mul(vote.weight as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(VOTE_WEIGHT_PRECISION as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)? as u64;

    actual_gauge_votes.push(GaugeVote {
        gauge: vote.gauge,
        weight: actual_weight,
    });
  }

  if user_vote.epoch == protocol.current_epoch {
    // Remove previous votes
    for vote in &user_vote.votes {
      match epoch.gauge_weights.iter_mut().find(|gauge_weight| gauge_weight.gauge.eq(&vote.gauge)) {
        Some(gauge_weight) => {
          gauge_weight.weight = gauge_weight.weight.checked_sub(vote.weight).ok_or(ErrorCode::ArithmeticOverflow)?;
          gauge_weight.votes = gauge_weight.votes.checked_sub(1).ok_or(ErrorCode::ArithmeticOverflow)?;
        },
        None => {},
      }
    }
  }

  // Add new votes with actual voting power
  for vote in &actual_gauge_votes {
    match epoch.gauge_weights.iter_mut().find(|gauge_weight| gauge_weight.gauge.eq(&vote.gauge)) {
      Some(gauge_weight) => {
        gauge_weight.weight = gauge_weight.weight.checked_add(vote.weight).ok_or(ErrorCode::ArithmeticOverflow)?;
        gauge_weight.votes = gauge_weight.votes.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;
      },
      None => {
        epoch.gauge_weights.push(GaugeWeight {
          gauge: vote.gauge,
          weight: vote.weight,
          votes: 1,
        });
      },
    }
  }


  epoch.update_total_power();
  epoch.update_total_votes();

  user_vote.user = lock.owner;
  user_vote.epoch = protocol.current_epoch;
  user_vote.total_voting_power = current_voting_power;
  user_vote.votes = actual_gauge_votes;
  user_vote.last_vote_time = current_time;
  user_vote.bump = user_vote_bump;

  // Records which lock this call's vote came from, so claim_pool_reward and
  // claim_bribe_reward can bind their auto-vote fee check to it rather than
  // trusting whatever lock the claimer later chooses to cite. `user` is who
  // cast the vote: the owner (also for Admin allocation votes), or the
  // auto-voter that voted on the owner's behalf. The 15% fee follows that
  // fact, fixed at vote time, so revoking or transferring before claiming
  // does not skip it (review M-3).
  vote_lock_record.user = auto_voter.unwrap_or(lock.owner);
  vote_lock_record.epoch = protocol.current_epoch;
  vote_lock_record.lock = lock_key;
  vote_lock_record.ve_token_id = ve_token_id;
  vote_lock_record.bump = vote_lock_record_bump;

  lock.last_vote_epoch = protocol.current_epoch;

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn voting_closes_exactly_five_minutes_before_epoch_end() {
    let epoch_end_time = 1_800_000_000;

    assert!(voting_is_open(
      epoch_end_time - VOTE_REVOCATION_DEADLINE - 1,
      epoch_end_time,
    ));
    assert!(!voting_is_open(
      epoch_end_time - VOTE_REVOCATION_DEADLINE,
      epoch_end_time,
    ));
    assert!(!voting_is_open(epoch_end_time - 1, epoch_end_time));
    // Wednesday 23:55 UTC: five minutes before the Thursday 00:00 rollover
    // (the fast-epochs test build uses a 20 second cutoff).
    #[cfg(not(feature = "fast-epochs"))]
    assert_eq!(VOTE_REVOCATION_DEADLINE, 300);
    #[cfg(feature = "fast-epochs")]
    assert_eq!(VOTE_REVOCATION_DEADLINE, 20);
  }

  #[test]
  fn voting_cutoff_check_handles_timestamp_overflow() {
    assert!(!voting_is_open(i64::MAX, i64::MAX));
  }
}
