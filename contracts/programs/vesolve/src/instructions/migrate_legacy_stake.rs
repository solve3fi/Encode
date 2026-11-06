use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::{constants::{GAUGE_STAKE_SEED, GAUGE_REWARD_SEED}, errors::ErrorCode,
    states::{GaugeStake, GaugeReward, NativeGauge, NATIVE_GAUGE_SEED}};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct LegacyLiquidityStake {
    pub owner: Pubkey, pub gauge: Pubkey, pub position: Pubkey, pub position_mint: Pubkey,
    pub liquidity: u128, pub reward_per_liquidity_paid_x64: u128,
    pub accrued_rewards: u64, pub staked_at: i64, pub bump: u8,
}

#[derive(Accounts)]
pub struct MigrateLegacyStake<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    pub position_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,
    /// CHECK: owner, PDA, discriminator and exact legacy/current byte lengths
    /// are checked before decoding. The saved owner and position never change.
    #[account(mut, owner = crate::ID,
        seeds = [GAUGE_STAKE_SEED, position_mint.key().as_ref()], bump)]
    pub stake: UncheckedAccount<'info>,
    #[account(seeds = [NATIVE_GAUGE_SEED, native_gauge.gauge.as_ref()], bump = native_gauge.bump)]
    pub native_gauge: Box<Account<'info, NativeGauge>>,
    #[account(mut, seeds = [GAUGE_REWARD_SEED, native_gauge.gauge.as_ref()], bump = legacy_reward.bump,
        constraint = legacy_reward.gauge == native_gauge.gauge @ ErrorCode::InvalidGauge)]
    pub legacy_reward: Box<Account<'info, GaugeReward>>,
    pub system_program: Program<'info, System>,
}

fn decode_stake(data: &[u8]) -> Result<GaugeStake> {
    require!(data.starts_with(GaugeStake::DISCRIMINATOR), ErrorCode::LegacyStakeMigrationRequired);
    if data.len() == 185 {
        let old = LegacyLiquidityStake::try_from_slice(&data[8..])?;
        Ok(GaugeStake {
            owner: old.owner, gauge: old.gauge, position: old.position, position_mint: old.position_mint,
            liquidity: old.liquidity, weight: old.liquidity,
            reward_per_weight_paid_x64: old.reward_per_liquidity_paid_x64,
            accrued_rewards: old.accrued_rewards, last_fee_owed_a: 0, last_fee_owed_b: 0,
            is_paused: false, staked_at: old.staked_at, bump: old.bump,
        })
    } else {
        require!(data.len() == 8 + GaugeStake::INIT_SPACE, ErrorCode::LegacyStakeMigrationRequired);
        GaugeStake::try_deserialize(&mut &data[..])
    }
}

pub fn migrate_legacy_stake(ctx: Context<MigrateLegacyStake>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let reward = &mut ctx.accounts.legacy_reward;
    require!(reward.reward_rate_x64 == 0 && reward.period_finish <= now, ErrorCode::LegacyStakeMigrationRequired);
    let mut stake = decode_stake(&ctx.accounts.stake.try_borrow_data()?)?;
    require!(stake.gauge == ctx.accounts.native_gauge.gauge && stake.position_mint == ctx.accounts.position_mint.key()
        && stake.bump == ctx.bumps.stake, ErrorCode::InvalidGauge);
    // Settle against the frozen legacy accumulator exactly once. This removes
    // legacy weight but retains accrued rewards for the existing claim/unstake.
    stake.sync(reward, now, false, 0, 0)?;
    let length = 8 + GaugeStake::INIT_SPACE;
    let rent = Rent::get()?.minimum_balance(length).saturating_sub(ctx.accounts.stake.lamports());
    if rent > 0 {
        transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), Transfer {
            from: ctx.accounts.payer.to_account_info(), to: ctx.accounts.stake.to_account_info(),
        }), rent)?;
    }
    ctx.accounts.stake.to_account_info().resize(length)?;
    stake.try_serialize(&mut &mut ctx.accounts.stake.try_borrow_mut_data()?[..])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_both_position_token_programs_but_no_other_owner() {
        use anchor_lang::CheckOwner;
        type PositionMint = anchor_spl::token_interface::Mint;
        assert!(PositionMint::check_owner(&anchor_spl::token::ID).is_ok());
        assert!(PositionMint::check_owner(&anchor_spl::token_2022::ID).is_ok());
        assert!(PositionMint::check_owner(&Pubkey::new_unique()).is_err());
    }
    #[test]
    fn exact_legacy_layout_preserves_claims_and_identity() {
        let old = LegacyLiquidityStake { owner: Pubkey::new_unique(), gauge: Pubkey::new_unique(),
            position: Pubkey::new_unique(), position_mint: Pubkey::new_unique(), liquidity: 100,
            reward_per_liquidity_paid_x64: 2u128 << 64, accrued_rewards: 37, staked_at: 1234, bump: 254 };
        let mut bytes = GaugeStake::DISCRIMINATOR.to_vec();
        old.serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), 185);
        let mut stake = decode_stake(&bytes).unwrap();
        assert_eq!(stake.owner, old.owner); assert_eq!(stake.position, old.position);
        let mut reward = GaugeReward { gauge: old.gauge, reward_mint: Pubkey::default(), total_weight: 100,
            reward_rate_x64: 0, reward_per_weight_x64: 5u128 << 64, last_update_time: 100,
            period_finish: 100, last_funded_epoch: 3, bump: 1 };
        stake.sync(&mut reward, 100, false, 0, 0).unwrap();
        assert_eq!(stake.accrued_rewards, 337); assert_eq!(stake.weight, 0); assert_eq!(reward.total_weight, 0);
        let mut migrated = Vec::new(); stake.try_serialize(&mut migrated).unwrap();
        assert_eq!(migrated.len(), 8 + GaugeStake::INIT_SPACE);
        let mut again = decode_stake(&migrated).unwrap();
        again.sync(&mut reward, 200, false, 0, 0).unwrap();
        assert_eq!(again.accrued_rewards, 337);
        bytes[0] ^= 1; assert!(decode_stake(&bytes).is_err());
        assert!(decode_stake(&migrated[..184]).is_err());
    }
}
