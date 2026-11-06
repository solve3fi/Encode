use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{GAUGE_REWARD_SEED, GAUGE_STAKE_SEED, PROTOCOL_SEED};
use crate::errors::ErrorCode;
use crate::states::{Gauge, GaugeReward, GaugeStake, Protocol};

/// A position only earns gauge rewards while the pool's current price sits
/// inside its range — out-of-range liquidity does nothing for swappers and
/// is cheap to mint arbitrarily large for a narrow, single-sided range, so
/// crediting it the same as real in-range depth lets an attacker dilute
/// every other staker's share for near-zero capital (audit finding: gauge
/// rewards weighted by raw liquidity with no in-range check).
fn position_in_range(position: &solve::state::Position, pool: &solve::state::Solve) -> bool {
    pool.tick_current_index >= position.tick_lower_index
        && pool.tick_current_index < position.tick_upper_index
}

#[derive(Accounts)]
pub struct StakePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    #[account(constraint = gauge.is_active @ ErrorCode::InvalidGauge)]
    pub gauge: Box<Account<'info, Gauge>>,
    #[account(address = gauge.pool_address @ ErrorCode::InvalidGauge)]
    pub pool: Box<Account<'info, solve::state::Solve>>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + GaugeReward::INIT_SPACE,
        seeds = [GAUGE_REWARD_SEED, gauge.key().as_ref()],
        bump,
    )]
    pub gauge_reward: Box<Account<'info, GaugeReward>>,
    #[account(
        constraint = position.solve == gauge.pool_address @ ErrorCode::InvalidGauge,
        constraint = position.position_mint == position_mint.key() @ ErrorCode::InvalidMint,
        constraint = position.liquidity > 0 @ ErrorCode::PositionHasNoLiquidity,
    )]
    pub position: Box<Account<'info, solve::state::Position>>,
    #[account(constraint = position_mint.decimals == 0 @ ErrorCode::InvalidMint)]
    pub position_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = owner,
        space = 8 + GaugeStake::INIT_SPACE,
        seeds = [GAUGE_STAKE_SEED, position_mint.key().as_ref()],
        bump,
    )]
    pub stake: Box<Account<'info, GaugeStake>>,
    #[account(
        mut,
        associated_token::mint = position_mint,
        associated_token::authority = owner,
        constraint = owner_position_token.amount == 1 @ ErrorCode::InvalidOwner,
    )]
    pub owner_position_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = position_mint,
        associated_token::authority = stake,
    )]
    pub custody_position_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn stake_position(ctx: Context<StakePosition>) -> Result<()> {
    // Native-gauge LP positions accrue SOLV directly through DEX reward slot
    // zero, without NFT custody or a separate fee-weighted staking deposit.
    require!(!ctx.accounts.pool.has_gauge_reward(), ErrorCode::NativeGaugeRequired);
    require!(
        position_in_range(&ctx.accounts.position, &ctx.accounts.pool),
        ErrorCode::PositionOutOfRange
    );
    let now = Clock::get()?.unix_timestamp;
    let reward = &mut ctx.accounts.gauge_reward;
    if reward.gauge == Pubkey::default() {
        reward.gauge = ctx.accounts.gauge.key();
        reward.reward_mint = ctx.accounts.protocol.token_mint;
        reward.last_update_time = now;
        reward.period_finish = now;
        reward.bump = ctx.bumps.gauge_reward;
    }
    reward.checkpoint(now)?;

    let stake = &mut ctx.accounts.stake;
    stake.owner = ctx.accounts.owner.key();
    stake.gauge = ctx.accounts.gauge.key();
    stake.position = ctx.accounts.position.key();
    stake.position_mint = ctx.accounts.position_mint.key();
    // Informational only now -- reward weight comes from realized fee
    // activity (see GaugeStake::sync), not this snapshot. Starts at zero
    // weight: a freshly staked position hasn't generated anything yet and
    // needs at least one sync_stake call after some trading activity before
    // it earns a share of the stream.
    stake.liquidity = ctx.accounts.position.liquidity;
    stake.weight = 0;
    stake.last_fee_owed_a = ctx.accounts.position.fee_owed_a;
    stake.last_fee_owed_b = ctx.accounts.position.fee_owed_b;
    stake.is_paused = false;
    stake.reward_per_weight_paid_x64 = reward.reward_per_weight_x64;
    stake.accrued_rewards = 0;
    stake.staked_at = now;
    stake.bump = ctx.bumps.stake;

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.owner_position_token.to_account_info(),
                mint: ctx.accounts.position_mint.to_account_info(),
                to: ctx.accounts.custody_position_token.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        1,
        0,
    )?;
    Ok(())
}

/// Refreshes a stake's reward weight against the position's real fee
/// activity and current range status. Permissionless and deliberately so:
/// nothing here moves funds or grants any privilege to the caller, it only
/// records objective on-chain state (mirrors update_epoch's "anyone can
/// crank it forward" pattern). This is what lets a position's accrual
/// actually pause promptly when it drifts out of range, rather than only
/// updating whenever its owner happens to claim or unstake -- a keeper can
/// call this on a schedule for every active stake, closing the gap where a
/// position could otherwise bank out-of-range time and cash it out the next
/// time it drifts back in.
#[derive(Accounts)]
pub struct SyncStake<'info> {
    pub caller: Signer<'info>,
    pub gauge: Box<Account<'info, Gauge>>,
    #[account(address = gauge.pool_address @ ErrorCode::InvalidGauge)]
    pub pool: Box<Account<'info, solve::state::Solve>>,
    #[account(
        constraint = position.position_mint == stake.position_mint @ ErrorCode::InvalidMint,
    )]
    pub position: Box<Account<'info, solve::state::Position>>,
    #[account(
        mut,
        seeds = [GAUGE_REWARD_SEED, gauge.key().as_ref()],
        bump = gauge_reward.bump,
        constraint = gauge_reward.gauge == gauge.key() @ ErrorCode::InvalidGauge,
    )]
    pub gauge_reward: Box<Account<'info, GaugeReward>>,
    #[account(
        mut,
        seeds = [GAUGE_STAKE_SEED, stake.position_mint.as_ref()],
        bump = stake.bump,
        constraint = stake.gauge == gauge.key() @ ErrorCode::InvalidGauge,
    )]
    pub stake: Box<Account<'info, GaugeStake>>,
}

pub fn sync_stake(ctx: Context<SyncStake>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let in_range = !ctx.accounts.pool.has_gauge_reward()
        && ctx.accounts.gauge.is_active && position_in_range(&ctx.accounts.position, &ctx.accounts.pool);
    let fee_owed_a = ctx.accounts.position.fee_owed_a;
    let fee_owed_b = ctx.accounts.position.fee_owed_b;
    let reward = &mut ctx.accounts.gauge_reward;
    let stake = &mut ctx.accounts.stake;
    stake.sync(reward, now, in_range, fee_owed_a, fee_owed_b)
}

#[derive(Accounts)]
pub struct ClaimGaugeRewards<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    pub gauge: Box<Account<'info, Gauge>>,
    #[account(address = gauge.pool_address @ ErrorCode::InvalidGauge)]
    pub pool: Box<Account<'info, solve::state::Solve>>,
    #[account(
        constraint = position.position_mint == stake.position_mint @ ErrorCode::InvalidMint,
    )]
    pub position: Box<Account<'info, solve::state::Position>>,
    #[account(
        mut,
        seeds = [GAUGE_REWARD_SEED, gauge.key().as_ref()],
        bump = gauge_reward.bump,
        constraint = gauge_reward.gauge == gauge.key() @ ErrorCode::InvalidGauge,
    )]
    pub gauge_reward: Box<Account<'info, GaugeReward>>,
    #[account(
        mut,
        seeds = [GAUGE_STAKE_SEED, stake.position_mint.as_ref()],
        bump = stake.bump,
        constraint = stake.owner == owner.key() @ ErrorCode::InvalidStakeOwner,
        constraint = stake.gauge == gauge.key() @ ErrorCode::InvalidGauge,
    )]
    pub stake: Box<Account<'info, GaugeStake>>,
    #[account(address = protocol.token_mint @ ErrorCode::InvalidMint)]
    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = reward_mint,
        associated_token::authority = gauge_reward,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = reward_mint,
        associated_token::authority = owner,
    )]
    pub owner_reward_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

  /// CHECK: canonical AdminConfig PDA; may be uninitialized (= nothing paused).
  #[account(seeds = [crate::constants::ADMIN_CONFIG_SEED], bump)]
  pub admin_config: UncheckedAccount<'info>,
}

pub fn claim_gauge_rewards(ctx: Context<ClaimGaugeRewards>) -> Result<()> {
  crate::states::AdminConfig::require_not_paused(&ctx.accounts.admin_config.to_account_info(), ctx.program_id, crate::states::PausableSystem::Claims)?;
    // No in-range gate here anymore: sync() below already stops crediting
    // NEW earnings the moment a position goes out of range (its weight
    // drops to zero), but whatever was genuinely earned while in range
    // beforehand is real and should stay claimable even after price moves
    // away -- unlike the old raw-liquidity model, there's nothing left to
    // "unfairly" pay out here once accrual itself is gated correctly.
    let now = Clock::get()?.unix_timestamp;
    let in_range = !ctx.accounts.pool.has_gauge_reward()
        && ctx.accounts.gauge.is_active && position_in_range(&ctx.accounts.position, &ctx.accounts.pool);
    let fee_owed_a = ctx.accounts.position.fee_owed_a;
    let fee_owed_b = ctx.accounts.position.fee_owed_b;
    let reward = &mut ctx.accounts.gauge_reward;
    let stake = &mut ctx.accounts.stake;
    stake.sync(reward, now, in_range, fee_owed_a, fee_owed_b)?;
    let amount = stake.accrued_rewards;
    require!(amount > 0, ErrorCode::InsufficientFunds);
    require!(ctx.accounts.reward_vault.amount >= amount, ErrorCode::InsufficientFunds);

    let gauge_key = ctx.accounts.gauge.key();
    let signer_seeds: &[&[u8]] = &[GAUGE_REWARD_SEED, gauge_key.as_ref(), &[reward.bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reward_vault.to_account_info(),
                mint: ctx.accounts.reward_mint.to_account_info(),
                to: ctx.accounts.owner_reward_token.to_account_info(),
                authority: reward.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
        ctx.accounts.reward_mint.decimals,
    )?;
    stake.accrued_rewards = 0;
    Ok(())
}

#[derive(Accounts)]
pub struct UnstakePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    pub gauge: Box<Account<'info, Gauge>>,
    #[account(address = gauge.pool_address @ ErrorCode::InvalidGauge)]
    pub pool: Box<Account<'info, solve::state::Solve>>,
    #[account(
        constraint = position.position_mint == position_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub position: Box<Account<'info, solve::state::Position>>,
    #[account(
        mut,
        seeds = [GAUGE_REWARD_SEED, gauge.key().as_ref()],
        bump = gauge_reward.bump,
        constraint = gauge_reward.gauge == gauge.key() @ ErrorCode::InvalidGauge,
    )]
    pub gauge_reward: Box<Account<'info, GaugeReward>>,
    #[account(
        mut,
        close = owner,
        seeds = [GAUGE_STAKE_SEED, position_mint.key().as_ref()],
        bump = stake.bump,
        constraint = stake.owner == owner.key() @ ErrorCode::InvalidStakeOwner,
        constraint = stake.gauge == gauge.key() @ ErrorCode::InvalidGauge,
        constraint = stake.position_mint == position_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub stake: Box<Account<'info, GaugeStake>>,
    pub position_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = position_mint,
        associated_token::authority = stake,
        constraint = custody_position_token.amount == 1 @ ErrorCode::InvalidOwner,
    )]
    pub custody_position_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = position_mint,
        associated_token::authority = owner,
    )]
    pub owner_position_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = protocol.token_mint @ ErrorCode::InvalidMint)]
    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = reward_mint,
        associated_token::authority = gauge_reward,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = reward_mint,
        associated_token::authority = owner,
    )]
    pub owner_reward_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn unstake_position(ctx: Context<UnstakePosition>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let in_range = !ctx.accounts.pool.has_gauge_reward()
        && ctx.accounts.gauge.is_active && position_in_range(&ctx.accounts.position, &ctx.accounts.pool);
    let fee_owed_a = ctx.accounts.position.fee_owed_a;
    let fee_owed_b = ctx.accounts.position.fee_owed_b;
    {
        let reward = &mut ctx.accounts.gauge_reward;
        let stake = &mut ctx.accounts.stake;
        stake.sync(reward, now, in_range, fee_owed_a, fee_owed_b)?;
    }

    // Unlike claim_gauge_rewards, unstaking must never trap a user's
    // position just because price moved away from their range — so this
    // never blocks on range status. sync() above already means
    // accrued_rewards only reflects genuinely in-range earnings; there's
    // nothing left to separately forfeit here the way the old raw-liquidity
    // model needed to.
    let amount = ctx.accounts.stake.accrued_rewards;
    let gauge_key = ctx.accounts.gauge.key();
    let reward_bump = ctx.accounts.gauge_reward.bump;
    let reward_signer: &[&[u8]] = &[GAUGE_REWARD_SEED, gauge_key.as_ref(), &[reward_bump]];
    if amount > 0 {
        require!(ctx.accounts.reward_vault.amount >= amount, ErrorCode::InsufficientFunds);
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    mint: ctx.accounts.reward_mint.to_account_info(),
                    to: ctx.accounts.owner_reward_token.to_account_info(),
                    authority: ctx.accounts.gauge_reward.to_account_info(),
                },
                &[reward_signer],
            ),
            amount,
            ctx.accounts.reward_mint.decimals,
        )?;
    }

    // Remove this stake's (now up-to-date, post-sync) weight from the total
    // entirely, since it's closing.
    let stake_weight = ctx.accounts.stake.weight;
    ctx.accounts.gauge_reward.total_weight = ctx.accounts.gauge_reward.total_weight
        .checked_sub(stake_weight).ok_or(ErrorCode::ArithmeticOverflow)?;

    let mint_key = ctx.accounts.position_mint.key();
    let stake_bump = ctx.accounts.stake.bump;
    let stake_signer: &[&[u8]] = &[GAUGE_STAKE_SEED, mint_key.as_ref(), &[stake_bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.custody_position_token.to_account_info(),
                mint: ctx.accounts.position_mint.to_account_info(),
                to: ctx.accounts.owner_position_token.to_account_info(),
                authority: ctx.accounts.stake.to_account_info(),
            },
            &[stake_signer],
        ),
        1,
        0,
    )?;
    Ok(())
}
