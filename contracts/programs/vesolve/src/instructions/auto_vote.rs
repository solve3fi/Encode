use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::{ADMIN_CONFIG_SEED, AUTO_VOTE_DELEGATE_SEED, AUTO_VOTE_SEED, AUTO_VOTER_SEED, PROTOCOL_SEED, USER_VOTE_SEED, VE_LOCK_SEED, VOTE_LOCK_SEED};
use crate::errors::ErrorCode;
use crate::events::{AutoVoteEnrolled, AutoVoteFeesWithdrawn, AutoVoteRevoked, AutoVoterCleared, AutoVoterDeregistered, AutoVoterRegistered, AutoVoterSet};
use crate::instructions::vote::cast_vote;
use crate::states::{AdminConfig, AutoVoteDelegate, AutoVoteEnrollment, AutoVoter, Epoch, GaugeVote, Lock, PausableSystem, Protocol, UserVote, VoteLockRecord};

#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct EnrollAutoVote<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(
    seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()],
    bump = lock.bump,
    constraint = lock.owner == owner.key() @ ErrorCode::InvalidOwner,
  )]
  pub lock: Box<Account<'info, Lock>>,

  #[account(
    init,
    payer = owner,
    space = 8 + AutoVoteEnrollment::INIT_SPACE,
    seeds = [AUTO_VOTE_SEED, lock.key().as_ref()],
    bump
  )]
  pub enrollment: Box<Account<'info, AutoVoteEnrollment>>,

  pub system_program: Program<'info, System>,
}

/// Opts a lock into the public Auto-Vote program: the keeper (see
/// auth::admin::AUTO_VOTE_KEEPER) can then cast votes on its behalf,
/// choosing pools by expected return since the owner never has to. In
/// exchange, AUTO_VOTE_FEE_BPS of the lock's voting rewards route to the
/// protocol treasury instead of the owner (see claim_bribe_reward.rs /
/// claim_pool_reward.rs) — the NFT itself never leaves the owner's wallet,
/// and revoke_auto_vote below undoes this at any time.
pub fn enroll_auto_vote(ctx: Context<EnrollAutoVote>, _ve_token_id: u64) -> Result<()> {
  let clock = Clock::get()?;
  let enrollment = &mut ctx.accounts.enrollment;

  enrollment.lock = ctx.accounts.lock.key();
  enrollment.owner = ctx.accounts.owner.key();
  enrollment.enrolled_at = clock.unix_timestamp;
  enrollment.bump = ctx.bumps.enrollment;

  emit!(AutoVoteEnrolled {
    lock: enrollment.lock,
    owner: enrollment.owner,
    enrolled_at: enrollment.enrolled_at,
  });

  Ok(())
}

#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct RevokeAutoVote<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(
    seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()],
    bump = lock.bump,
    constraint = lock.owner == owner.key() @ ErrorCode::InvalidOwner,
  )]
  pub lock: Box<Account<'info, Lock>>,

  #[account(
    mut,
    close = owner,
    seeds = [AUTO_VOTE_SEED, lock.key().as_ref()],
    bump = enrollment.bump,
  )]
  pub enrollment: Box<Account<'info, AutoVoteEnrollment>>,
}

pub fn revoke_auto_vote(ctx: Context<RevokeAutoVote>, _ve_token_id: u64) -> Result<()> {
  emit!(AutoVoteRevoked {
    lock: ctx.accounts.lock.key(),
    owner: ctx.accounts.owner.key(),
  });
  Ok(())
}

#[derive(Accounts)]
pub struct WithdrawAutoVoteFees<'info> {
  #[account(
    mut,
    constraint = admin.key() == protocol.admin @ ErrorCode::Unauthorized,
  )]
  pub admin: Signer<'info>,

  #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
  pub protocol: Box<Account<'info, Protocol>>,

  pub token_mint: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    associated_token::mint = token_mint,
    associated_token::authority = protocol,
  )]
  pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,

  /// CHECK: must equal the Treasury configured in AdminConfig (checked in the handler).
  pub treasury: UncheckedAccount<'info>,

  /// The Treasury's token account (DEV-15: the fee is protocol revenue, like exit fees, never the Admin's own).
  #[account(
    init_if_needed,
    payer = admin,
    associated_token::mint = token_mint,
    associated_token::authority = treasury,
    associated_token::token_program = token_program,
  )]
  pub destination_token_account: InterfaceAccount<'info, TokenAccount>,

  /// CHECK: canonical AdminConfig PDA, read in the handler.
  #[account(seeds = [ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,

  pub token_program: Interface<'info, TokenInterface>,
  pub associated_token_program: Program<'info, AssociatedToken>,
  pub system_program: Program<'info, System>,
}

/// Sends the 15% fee accumulated from enrolled locks' voting rewards
/// (see claim_bribe_reward.rs / claim_pool_reward.rs) from the Protocol PDA's
/// token account to the Treasury configured in AdminConfig. One call per mint,
/// since fees accrue in whatever token each bribe/trading-fee payout happened
/// to be in.
pub fn withdraw_auto_vote_fees(ctx: Context<WithdrawAutoVoteFees>, amount: u64) -> Result<()> {
  let treasury = AdminConfig::read(&ctx.accounts.admin_config.to_account_info(), ctx.program_id)?
    .map(|c| c.treasury)
    .unwrap_or_default();
  require!(treasury != Pubkey::default(), ErrorCode::TreasuryNotSet);
  require_keys_eq!(ctx.accounts.treasury.key(), treasury, ErrorCode::InvalidTreasury);
  require!(amount > 0, ErrorCode::InvalidAmount);
  require!(
    ctx.accounts.treasury_token_account.amount >= amount,
    ErrorCode::InsufficientFunds
  );
  // The Protocol PDA's SOLV3 account also holds every lock's principal (review H-1). Only the part above
  // the total locked can be fee income, so that is all a withdrawal may take.
  if ctx.accounts.token_mint.key() == ctx.accounts.protocol.token_mint {
    let fees = ctx.accounts.treasury_token_account.amount.saturating_sub(ctx.accounts.protocol.total_locked);
    require!(amount <= fees, ErrorCode::WithdrawalExceedsFees);
  }

  let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]]];
  let cpi_accounts = TransferChecked {
    from: ctx.accounts.treasury_token_account.to_account_info(),
    to: ctx.accounts.destination_token_account.to_account_info(),
    authority: ctx.accounts.protocol.to_account_info(),
    mint: ctx.accounts.token_mint.to_account_info(),
  };
  let cpi_ctx = CpiContext::new_with_signer(
    ctx.accounts.token_program.to_account_info(),
    cpi_accounts,
    signer_seeds,
  );
  transfer_checked(cpi_ctx, amount, ctx.accounts.token_mint.decimals)?;

  emit!(AutoVoteFeesWithdrawn {
    admin: ctx.accounts.admin.key(),
    token_mint: ctx.accounts.token_mint.key(),
    destination: ctx.accounts.destination_token_account.key(),
    amount,
  });

  Ok(())
}

// ---- Public auto-voter registry (DEV-12) ----

#[derive(Accounts)]
pub struct RegisterAutoVoter<'info> {
  #[account(mut)]
  pub authority: Signer<'info>,

  #[account(
    init,
    payer = authority,
    space = 8 + AutoVoter::INIT_SPACE,
    seeds = [AUTO_VOTER_SEED, authority.key().as_ref()],
    bump
  )]
  pub auto_voter: Box<Account<'info, AutoVoter>>,

  pub system_program: Program<'info, System>,
}

/// Registers the signer as an auto-voter that lock owners can choose. Permissionless.
pub fn register_auto_voter(ctx: Context<RegisterAutoVoter>) -> Result<()> {
  let auto_voter = &mut ctx.accounts.auto_voter;
  auto_voter.authority = ctx.accounts.authority.key();
  auto_voter.registered_at = Clock::get()?.unix_timestamp;
  auto_voter.bump = ctx.bumps.auto_voter;
  emit!(AutoVoterRegistered { authority: auto_voter.authority });
  Ok(())
}

#[derive(Accounts)]
pub struct DeregisterAutoVoter<'info> {
  #[account(mut)]
  pub authority: Signer<'info>,

  #[account(
    mut,
    close = authority,
    seeds = [AUTO_VOTER_SEED, authority.key().as_ref()],
    bump = auto_voter.bump,
    has_one = authority @ ErrorCode::Unauthorized,
  )]
  pub auto_voter: Box<Account<'info, AutoVoter>>,
}

/// Stops being an auto-voter. Locks that chose this voter can no longer be voted by it (delegated_vote
/// requires the registration) until their owners pick another voter or clear the choice.
pub fn deregister_auto_voter(ctx: Context<DeregisterAutoVoter>) -> Result<()> {
  emit!(AutoVoterDeregistered { authority: ctx.accounts.authority.key() });
  Ok(())
}

#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct SetAutoVoter<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(
    seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()],
    bump = lock.bump,
    constraint = lock.owner == owner.key() @ ErrorCode::InvalidOwner,
  )]
  pub lock: Box<Account<'info, Lock>>,

  /// The lock must be enrolled in auto-vote: the choice only says who votes it.
  #[account(seeds = [AUTO_VOTE_SEED, lock.key().as_ref()], bump = enrollment.bump)]
  pub enrollment: Box<Account<'info, AutoVoteEnrollment>>,

  #[account(seeds = [AUTO_VOTER_SEED, auto_voter.authority.as_ref()], bump = auto_voter.bump)]
  pub auto_voter: Box<Account<'info, AutoVoter>>,

  #[account(
    init_if_needed,
    payer = owner,
    space = 8 + AutoVoteDelegate::INIT_SPACE,
    seeds = [AUTO_VOTE_DELEGATE_SEED, lock.key().as_ref()],
    bump
  )]
  pub delegate: Box<Account<'info, AutoVoteDelegate>>,

  pub system_program: Program<'info, System>,
}

/// The lock owner picks which registered auto-voter votes their enrolled lock (replacing any earlier choice).
pub fn set_auto_voter(ctx: Context<SetAutoVoter>, _ve_token_id: u64) -> Result<()> {
  let delegate = &mut ctx.accounts.delegate;
  delegate.lock = ctx.accounts.lock.key();
  delegate.voter = ctx.accounts.auto_voter.authority;
  delegate.set_at = Clock::get()?.unix_timestamp;
  delegate.bump = ctx.bumps.delegate;
  emit!(AutoVoterSet { lock: delegate.lock, owner: ctx.accounts.owner.key(), voter: delegate.voter });
  Ok(())
}

#[derive(Accounts)]
#[instruction(ve_token_id: u64)]
pub struct ClearAutoVoter<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  #[account(
    seeds = [VE_LOCK_SEED, ve_token_id.to_le_bytes().as_ref()],
    bump = lock.bump,
    constraint = lock.owner == owner.key() @ ErrorCode::InvalidOwner,
  )]
  pub lock: Box<Account<'info, Lock>>,

  #[account(
    mut,
    close = owner,
    seeds = [AUTO_VOTE_DELEGATE_SEED, lock.key().as_ref()],
    bump = delegate.bump,
  )]
  pub delegate: Box<Account<'info, AutoVoteDelegate>>,
}

/// Removes the owner's voter choice, handing the lock back to the Solve3 keeper (if still enrolled).
pub fn clear_auto_voter(ctx: Context<ClearAutoVoter>, _ve_token_id: u64) -> Result<()> {
  emit!(AutoVoterCleared { lock: ctx.accounts.lock.key(), owner: ctx.accounts.owner.key() });
  Ok(())
}

/// Whether a delegate record is the owner's current choice: it must belong to this lock and have been made
/// during the lock's current enrollment (a choice left over from an earlier enrollment is ignored).
pub(crate) fn delegate_is_current(delegate: &AutoVoteDelegate, lock_key: &Pubkey, enrolled_at: i64) -> bool {
  delegate.lock == *lock_key && delegate.set_at >= enrolled_at
}

#[derive(Accounts)]
#[instruction(ve_token_id: u64, gauge_votes: Vec<GaugeVote>)]
pub struct DelegatedVote<'info> {
  #[account(mut)]
  pub voter: Signer<'info>,

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

  /// Must have been made by the lock's current owner (review M-1).
  #[account(
    seeds = [AUTO_VOTE_SEED, lock.key().as_ref()],
    bump = enrollment.bump,
    constraint = enrollment.owner == lock.owner @ ErrorCode::InvalidOwner,
  )]
  pub enrollment: Box<Account<'info, AutoVoteEnrollment>>,

  #[account(
    seeds = [AUTO_VOTE_DELEGATE_SEED, lock.key().as_ref()],
    bump = delegate.bump,
    constraint = delegate_is_current(&delegate, &lock.key(), enrollment.enrolled_at) @ ErrorCode::AutoVoterNotChosen,
    constraint = delegate.voter == voter.key() @ ErrorCode::AutoVoterNotChosen,
  )]
  pub delegate: Box<Account<'info, AutoVoteDelegate>>,

  /// The voter must still be registered.
  #[account(seeds = [AUTO_VOTER_SEED, voter.key().as_ref()], bump = auto_voter.bump)]
  pub auto_voter: Box<Account<'info, AutoVoter>>,

  #[account(
    init_if_needed,
    payer = voter,
    space = 8 + UserVote::INIT_SPACE,
    seeds = [USER_VOTE_SEED, lock.key().as_ref(), protocol.current_epoch.to_le_bytes().as_ref()],
    bump
  )]
  pub user_vote: Box<Account<'info, UserVote>>,

  #[account(
    init_if_needed,
    payer = voter,
    space = 8 + VoteLockRecord::INIT_SPACE,
    seeds = [VOTE_LOCK_SEED, lock.key().as_ref(), protocol.current_epoch.to_le_bytes().as_ref()],
    bump
  )]
  pub vote_lock_record: Box<Account<'info, VoteLockRecord>>,

  pub system_program: Program<'info, System>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

/// A registered auto-voter votes an enrolled lock whose owner chose it. Same rules as `vote` (gauge accounts in
/// remaining_accounts, in order); the auto-vote fee on the lock's rewards is unchanged.
pub fn delegated_vote<'info>(
  ctx: Context<'_, '_, 'info, 'info, DelegatedVote<'info>>,
  ve_token_id: u64,
  gauge_votes: Vec<GaugeVote>,
) -> Result<()> {
  AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, PausableSystem::Voting)?;
  let lock_key = ctx.accounts.lock.key();
  cast_vote(
    &mut ctx.accounts.protocol,
    &mut ctx.accounts.epoch,
    &mut ctx.accounts.lock,
    &mut ctx.accounts.user_vote,
    &mut ctx.accounts.vote_lock_record,
    ctx.remaining_accounts,
    lock_key,
    ve_token_id,
    gauge_votes,
    Clock::get()?.unix_timestamp,
    ctx.bumps.user_vote,
    ctx.bumps.vote_lock_record,
    Some(ctx.accounts.voter.key()),
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  fn delegate(lock: Pubkey, set_at: i64) -> AutoVoteDelegate {
    AutoVoteDelegate { lock, voter: Pubkey::new_unique(), set_at, bump: 255 }
  }

  #[test]
  fn delegate_counts_only_for_its_lock_and_the_current_enrollment() {
    let lock = Pubkey::new_unique();
    assert!(delegate_is_current(&delegate(lock, 100), &lock, 100));
    assert!(delegate_is_current(&delegate(lock, 150), &lock, 100));
    assert!(!delegate_is_current(&delegate(lock, 99), &lock, 100), "a choice from an earlier enrollment is stale");
    assert!(!delegate_is_current(&delegate(Pubkey::new_unique(), 150), &lock, 100));
  }
}
