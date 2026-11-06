//! What each LP actually receives from a gauge's emissions: shares follow
//! in-range liquidity, out-of-range liquidity earns nothing, the total paid
//! never exceeds what the pool earned, and only whole in-range time counts.
use svm_tests::gauge_world::*;
use svm_tests::*;

struct Lp {
    position: Pubkey,
    token: Pubkey,
    lower_array: Pubkey,
    upper_array: Pubkey,
    reward_account: Pubkey,
}

fn open_lp(d: &mut dex::Dex, solv3: &Pubkey, lower: i32, upper: i32, lower_array: Pubkey, upper_array: Pubkey, liquidity: u128) -> Lp {
    let owner = d.owner;
    let mint = unique();
    let position = pda(SOLVE, &[b"position", mint.as_ref()]);
    let token = ata(&owner, &mint);
    let mut args = vec![255u8];
    args.extend(lower.to_le_bytes());
    args.extend(upper.to_le_bytes());
    let open = d.idl.ix(
        SOLVE,
        "open_position",
        &args,
        &[("funder", owner), ("owner", owner), ("position", position), ("position_mint", mint), ("position_token_account", token), ("solve", d.pool)],
    );
    d.env.ok(&owner, &[open]);
    let mut args = liquidity.to_le_bytes().to_vec();
    args.extend(u64::MAX.to_le_bytes());
    args.extend(u64::MAX.to_le_bytes());
    let add = d.idl.ix(
        SOLVE,
        "increase_liquidity",
        &args,
        &[
            ("solve", d.pool), ("position_authority", owner), ("position", position), ("position_token_account", token),
            ("token_owner_account_a", d.user_a), ("token_owner_account_b", d.user_b),
            ("token_vault_a", d.vault_a), ("token_vault_b", d.vault_b),
            ("tick_array_lower", lower_array), ("tick_array_upper", upper_array), ("solves_config", d.config),
        ],
    );
    d.env.ok(&owner, &[add]);
    let reward_account = unique();
    d.env.set_token_account(&reward_account, solv3, &owner, 0);
    Lp { position, token, lower_array, upper_array, reward_account }
}

fn claim(d: &mut dex::Dex, lp: &Lp, reward_vault: &Pubkey) -> u64 {
    claim_with(d, lp, reward_vault, true)
}

/// `update`: false for a position with no liquidity left (the DEX refuses to
/// update it; decreasing liquidity already settled what it owed).
fn claim_with(d: &mut dex::Dex, lp: &Lp, reward_vault: &Pubkey, update: bool) -> u64 {
    let owner = d.owner;
    let update_ix = d.idl.ix(
        SOLVE,
        "update_fees_and_rewards",
        &[],
        &[("solve", d.pool), ("position", lp.position), ("tick_array_lower", lp.lower_array), ("tick_array_upper", lp.upper_array)],
    );
    let collect = d.idl.ix(
        SOLVE,
        "collect_reward",
        &[0],
        &[
            ("solve", d.pool), ("position_authority", owner), ("position", lp.position), ("position_token_account", lp.token),
            ("reward_owner_account", lp.reward_account), ("reward_vault", *reward_vault), ("token_program", pk(TOKEN_PROGRAM)),
        ],
    );
    if update {
        d.env.ok(&owner, &[update_ix, collect]);
    } else {
        d.env.ok(&owner, &[collect]);
    }
    d.env.token_balance(&lp.reward_account)
}

#[test]
fn emissions_follow_in_range_liquidity_and_never_overpay() {
    let World { mut d, idl: vesolve, admin, solv3, gauge, native, reward_vault } = world();
    let owner = d.owner;
    let t1 = START + WEEK;

    // LP A (1x) is already in from world(); B (3x, same range) and C (2x, entirely above
    // the current price, so out of range) join before the stream starts.
    let a = Lp {
        position: d.position,
        token: d.position_token,
        lower_array: d.arrays[1],
        upper_array: d.arrays[2],
        reward_account: unique(),
    };
    d.env.set_token_account(&a.reward_account, &solv3, &owner, 0);
    let arrays = d.arrays;
    let b = open_lp(&mut d, &solv3, -640, 640, arrays[1], arrays[2], 3_000_000_000);
    let c = open_lp(&mut d, &solv3, 1_280, 1_920, arrays[2], arrays[2], 2_000_000_000);

    patch_votes(&mut d.env, 0, &gauge, 1_000);
    let emission_pda = pda(VESOLVE, &[b"epoch_emission", &1u64.to_le_bytes()]);
    let init_emission = vesolve.ix(
        VESOLVE, "initialize_epoch_emission", &1u64.to_le_bytes(),
        &[("caller", admin), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission_pda), ("developer_wallet", admin),
          ("token_mint", solv3), ("developer_token_account", ata(&admin, &solv3)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    d.env.ok(&admin, &[init_emission]);
    let fund = vesolve.ix(
        VESOLVE, "fund_native_gauge", &1u64.to_le_bytes(),
        &[("caller", admin), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission_pda), ("gauge", gauge), ("native_gauge", native),
          ("pool", d.pool), ("reward_mint", solv3), ("reward_vault", reward_vault), ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    d.env.ok(&admin, &[fund]);
    let funded: u64 = 1_248_000_000_000_000;
    let rate_x64 = ((funded as u128) << 64) / ((WEEK - 5) as u128);

    // Real trading in hour 0 opens hour 1 (the gate looks one hour back).
    for i in 0..40 {
        d.env.set_time(t1 + 100 + i);
        let s = d.swap_ix(10_000_000, i % 2 == 0);
        d.env.ok(&owner, &[s]);
    }

    // Everyone claims at the same instant, 600 s into hour 1.
    let now = t1 + HOUR + 600;
    d.env.set_time(now);
    let (ra, rb, rc) = (claim(&mut d, &a, &reward_vault), claim(&mut d, &b, &reward_vault), claim(&mut d, &c, &reward_vault));

    let earned = ((rate_x64 * 600) >> 64) as u64; // only the open seconds of hour 1
    assert_eq!(rc, 0, "liquidity outside the range earns nothing");
    assert!(ra > 0 && rb > 0);
    // B holds three times A's liquidity over the same range and the same time.
    assert!((rb as i128 - 3 * ra as i128).abs() <= 3, "B should get 3x A: a={ra} b={rb}");
    let paid = ra + rb + rc;
    assert_eq!(funded - d.env.token_balance(&reward_vault), paid, "the vault only ever pays out what LPs collected");
    assert!(paid <= earned, "never pay more than was earned: paid={paid} earned={earned}");
    assert!(earned - paid <= 10, "only rounding dust is left: paid={paid} earned={earned}");
    // Claiming twice pays nothing more.
    let again = claim(&mut d, &a, &reward_vault);
    assert_eq!(again, ra, "no second payout without new time");
}

/// The whole epoch, end to end: every funded token is either paid to an LP,
/// burned as unearned, or left as sub-unit rounding dust. Nothing is created
/// or lost, and only the hours the gate opened were paid.
#[test]
fn a_whole_epoch_conserves_every_token_and_pays_only_open_hours() {
    let World { mut d, idl: vesolve, admin, solv3, gauge, native, reward_vault } = world();
    let owner = d.owner;
    let t1 = START + WEEK;
    let a = Lp { position: d.position, token: d.position_token, lower_array: d.arrays[1], upper_array: d.arrays[2], reward_account: unique() };
    d.env.set_token_account(&a.reward_account, &solv3, &owner, 0);
    let arrays = d.arrays;
    let b = open_lp(&mut d, &solv3, -640, 640, arrays[1], arrays[2], 3_000_000_000);
    let c = open_lp(&mut d, &solv3, 1_280, 1_920, arrays[2], arrays[2], 2_000_000_000);

    patch_votes(&mut d.env, 0, &gauge, 1_000);
    let emission_pda = pda(VESOLVE, &[b"epoch_emission", &1u64.to_le_bytes()]);
    let init_emission = vesolve.ix(
        VESOLVE, "initialize_epoch_emission", &1u64.to_le_bytes(),
        &[("caller", admin), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission_pda), ("developer_wallet", admin),
          ("token_mint", solv3), ("developer_token_account", ata(&admin, &solv3)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    d.env.ok(&admin, &[init_emission]);
    let fund = vesolve.ix(
        VESOLVE, "fund_native_gauge", &1u64.to_le_bytes(),
        &[("caller", admin), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission_pda), ("gauge", gauge), ("native_gauge", native),
          ("pool", d.pool), ("reward_mint", solv3), ("reward_vault", reward_vault), ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    d.env.ok(&admin, &[fund]);
    let funded: u64 = 1_248_000_000_000_000;
    let rate_x64 = ((funded as u128) << 64) / ((WEEK - 5) as u128);
    let supply_before = supply(&d.env, &solv3);

    // Trading in hours 0, 1 and 5 opens hours 1, 2 and 6 (the gate looks one hour back).
    for hour in [0i64, 1, 5] {
        for i in 0..30 {
            d.env.set_time(t1 + hour * HOUR + 100 + i);
            let s = d.swap_ix(10_000_000, i % 2 == 0);
            d.env.ok(&owner, &[s]);
        }
    }

    // After the stream ends: burn what was never earned, then everyone claims.
    d.env.set_time(t1 + WEEK + 10);
    let settle = vesolve.ix(
        VESOLVE, "settle_native_gauge_unearned", &[],
        &[("caller", admin), ("protocol", protocol()), ("gauge", gauge), ("native_gauge", native), ("pool", d.pool), ("reward_mint", solv3), ("reward_vault", reward_vault), ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM))],
    );
    d.env.ok(&admin, &[settle]);
    let (ra, rb, rc) = (claim(&mut d, &a, &reward_vault), claim(&mut d, &b, &reward_vault), claim(&mut d, &c, &reward_vault));

    let burned = supply_before - supply(&d.env, &solv3);
    let dust = d.env.token_balance(&reward_vault);
    let paid = ra + rb + rc;
    assert_eq!(paid + burned + dust, funded, "paid {paid} + burned {burned} + dust {dust} must equal funded {funded}");
    assert!(dust < 1_000, "only rounding dust may stay in the vault, got {dust}");

    let earned = ((rate_x64 * (3 * HOUR as u128)) >> 64) as u64; // hours 1, 2 and 6
    assert!(paid <= earned && earned - paid <= 1_000, "paid={paid} earned={earned}");
    assert_eq!(rc, 0);
    assert!((rb as i128 - 3 * ra as i128).abs() <= 3, "a={ra} b={rb}");
}

/// Joining is prospective, splitting a position never changes the total, and
/// an LP who withdraws keeps what it already earned.
#[test]
fn late_joiners_are_prospective_splitting_is_neutral_and_withdrawing_keeps_earnings() {
    let World { mut d, idl: vesolve, admin, solv3, gauge, native, reward_vault } = world();
    let owner = d.owner;
    let t1 = START + WEEK;
    let a = Lp { position: d.position, token: d.position_token, lower_array: d.arrays[1], upper_array: d.arrays[2], reward_account: unique() };
    d.env.set_token_account(&a.reward_account, &solv3, &owner, 0);
    let arrays = d.arrays;

    patch_votes(&mut d.env, 0, &gauge, 1_000);
    let emission_pda = pda(VESOLVE, &[b"epoch_emission", &1u64.to_le_bytes()]);
    let init_emission = vesolve.ix(
        VESOLVE, "initialize_epoch_emission", &1u64.to_le_bytes(),
        &[("caller", admin), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission_pda), ("developer_wallet", admin),
          ("token_mint", solv3), ("developer_token_account", ata(&admin, &solv3)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    d.env.ok(&admin, &[init_emission]);
    let fund = vesolve.ix(
        VESOLVE, "fund_native_gauge", &1u64.to_le_bytes(),
        &[("caller", admin), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission_pda), ("gauge", gauge), ("native_gauge", native),
          ("pool", d.pool), ("reward_mint", solv3), ("reward_vault", reward_vault), ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    d.env.ok(&admin, &[fund]);
    let funded: u64 = 1_248_000_000_000_000;
    let rate_x64 = ((funded as u128) << 64) / ((WEEK - 5) as u128);

    for i in 0..40 {
        d.env.set_time(t1 + 100 + i);
        let s = d.swap_ix(10_000_000, i % 2 == 0);
        d.env.ok(&owner, &[s]);
    }

    // 300 s into the open hour: one 3x position, and the same size split in two.
    d.env.set_time(t1 + HOUR + 300);
    let b = open_lp(&mut d, &solv3, -640, 640, arrays[1], arrays[2], 3_000_000_000);
    let s1 = open_lp(&mut d, &solv3, -640, 640, arrays[1], arrays[2], 1_500_000_000);
    let s2 = open_lp(&mut d, &solv3, -640, 640, arrays[1], arrays[2], 1_500_000_000);

    // 600 s later A withdraws everything, then all claim at the same instant.
    d.env.set_time(t1 + HOUR + 900);
    let out = d.liquidity_ix("decrease_liquidity", 1_000_000_000);
    d.env.ok(&owner, &[out]);
    let (ra, rb, r1, r2) = (claim_with(&mut d, &a, &reward_vault, false), claim(&mut d, &b, &reward_vault), claim(&mut d, &s1, &reward_vault), claim(&mut d, &s2, &reward_vault));

    let r = rate_x64;
    let per = |secs: u128, num: u128, den: u128| ((r * secs * num / den) >> 64) as i128;
    let want_a = per(300, 1, 1) + per(600, 1, 7);
    let want_b = per(600, 3, 7);
    assert!((ra as i128 - want_a).abs() <= 5, "A earned alone for 300 s then 1/7: got {ra} want {want_a}");
    assert!((rb as i128 - want_b).abs() <= 5, "B joined late and earns only prospectively: got {rb} want {want_b}");
    assert!(((r1 + r2) as i128 - rb as i128).abs() <= 3, "splitting a position must not change the total: {} vs {}", r1 + r2, rb);
    assert_eq!(claim_with(&mut d, &a, &reward_vault, false), ra, "withdrawn LP keeps what it earned, and nothing more accrues");
}

fn tick(d: &dex::Dex) -> i32 {
    i32::from_le_bytes(d.env.account(&d.pool).unwrap().data[81..85].try_into().unwrap())
}

/// A swap that moves the price across ticks: the LPs it pushes out of range
/// stop earning and the ones it pushes into range start, with the pool's
/// active liquidity changing at the crossings.
#[test]
fn price_moves_across_ranges_shift_emissions_to_the_lps_in_range() {
    let World { mut d, idl: vesolve, admin, solv3, gauge, native, reward_vault } = world();
    let owner = d.owner;
    let t1 = START + WEEK;
    let a = Lp { position: d.position, token: d.position_token, lower_array: d.arrays[1], upper_array: d.arrays[2], reward_account: unique() };
    d.env.set_token_account(&a.reward_account, &solv3, &owner, 0);
    let arrays = d.arrays;
    let b = open_lp(&mut d, &solv3, -640, 640, arrays[1], arrays[2], 3_000_000_000);
    let c = open_lp(&mut d, &solv3, 1_280, 1_920, arrays[2], arrays[2], 2_000_000_000);

    patch_votes(&mut d.env, 0, &gauge, 1_000);
    let emission_pda = pda(VESOLVE, &[b"epoch_emission", &1u64.to_le_bytes()]);
    let init_emission = vesolve.ix(
        VESOLVE, "initialize_epoch_emission", &1u64.to_le_bytes(),
        &[("caller", admin), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission_pda), ("developer_wallet", admin),
          ("token_mint", solv3), ("developer_token_account", ata(&admin, &solv3)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    d.env.ok(&admin, &[init_emission]);
    let fund = vesolve.ix(
        VESOLVE, "fund_native_gauge", &1u64.to_le_bytes(),
        &[("caller", admin), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission_pda), ("gauge", gauge), ("native_gauge", native),
          ("pool", d.pool), ("reward_mint", solv3), ("reward_vault", reward_vault), ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    d.env.ok(&admin, &[fund]);

    for i in 0..40 {
        d.env.set_time(t1 + 100 + i);
        let s = d.swap_ix(10_000_000, i % 2 == 0);
        d.env.ok(&owner, &[s]);
    }
    // One big swap at the start of the open hour pushes the price up through A and B's range.
    d.env.set_time(t1 + HOUR);
    let big = d.swap_ix(150_000_000, false);
    d.env.ok(&owner, &[big]);
    let t = tick(&d);

    d.env.set_time(t1 + HOUR + 600);
    let (ra, rb, rc) = (claim(&mut d, &a, &reward_vault), claim(&mut d, &b, &reward_vault), claim(&mut d, &c, &reward_vault));
    assert!(t >= 1_280 && t < 1_920, "the swap should land the price inside C's range, got tick {t}");
    assert_eq!((ra, rb), (0, 0), "A and B were pushed out of range at the start of the hour and earn nothing");
    let funded: u128 = 1_248_000_000_000_000;
    let earned = (((funded << 64) / ((WEEK - 5) as u128) * 600) >> 64) as u64;
    assert!(rc <= earned && earned - rc <= 5, "C is the only LP in range, so it takes the whole stream: c={rc} earned={earned}");
}

/// The gate measures fee yield on the pool's real capital, not on its leveraged
/// virtual depth: this ±6% pool has ~30x leverage, and a swap whose fees are
/// ~3 bp of real capital (0.1 bp of virtual depth) must still open the gate,
/// while one of ~0.25 bp must not.
#[test]
fn the_gate_asks_the_same_of_concentrated_and_wide_liquidity() {
    let World { mut d, idl: vesolve, admin, solv3, gauge, native, reward_vault } = world();
    let owner = d.owner;
    let t1 = START + WEEK;
    let a = Lp { position: d.position, token: d.position_token, lower_array: d.arrays[1], upper_array: d.arrays[2], reward_account: unique() };
    d.env.set_token_account(&a.reward_account, &solv3, &owner, 0);

    patch_votes(&mut d.env, 0, &gauge, 1_000);
    let emission_pda = pda(VESOLVE, &[b"epoch_emission", &1u64.to_le_bytes()]);
    let init_emission = vesolve.ix(
        VESOLVE, "initialize_epoch_emission", &1u64.to_le_bytes(),
        &[("caller", admin), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission_pda), ("developer_wallet", admin),
          ("token_mint", solv3), ("developer_token_account", ata(&admin, &solv3)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    d.env.ok(&admin, &[init_emission]);
    let fund = vesolve.ix(
        VESOLVE, "fund_native_gauge", &1u64.to_le_bytes(),
        &[("caller", admin), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission_pda), ("gauge", gauge), ("native_gauge", native),
          ("pool", d.pool), ("reward_mint", solv3), ("reward_vault", reward_vault), ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    d.env.ok(&admin, &[fund]);
    let funded: u128 = 1_248_000_000_000_000;
    let rate_x64 = (funded << 64) / ((WEEK - 5) as u128);

    // real capital in the pool's vaults (price ~1): about 6.3e7 base units
    let tvl = d.env.token_balance(&d.vault_a) + d.env.token_balance(&d.vault_b);
    let fee_bp = |amount: u64| amount as f64 * 0.003 / tvl as f64 * 10_000.0;
    assert!(fee_bp(500_000) < 1.0 && fee_bp(6_300_000) > 1.0, "tvl={tvl}");

    // Hour 0: a swap of ~0.25 bp of real capital. The gate stays closed for hour 1.
    d.env.set_time(t1 + 100);
    let s = d.swap_ix(500_000, true);
    d.env.ok(&owner, &[s]);
    d.env.set_time(t1 + HOUR + 600);
    assert_eq!(claim(&mut d, &a, &reward_vault), 0, "too little yield in hour 0: hour 1 earns nothing");

    // Hour 1: a swap of ~3 bp of real capital (0.1 bp of virtual depth). Hour 2 opens.
    let s = d.swap_ix(6_300_000, false);
    d.env.ok(&owner, &[s]);
    d.env.set_time(t1 + 2 * HOUR + 600);
    let got = claim(&mut d, &a, &reward_vault);
    let earned = ((rate_x64 * 600) >> 64) as u64;
    assert!(got <= earned && earned - got <= 5, "hour 2 is open: got={got} earned={earned}");
}
