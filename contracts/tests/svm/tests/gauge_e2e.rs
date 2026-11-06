//! End to end across both programs: a real gauge on a real pool, funded from a
//! (patched) vote result, with the activity gate and the burn of unearned
//! emissions. Time is driven with the SVM clock.
use svm_tests::gauge_world::*;
use svm_tests::*;

#[test]
fn closed_gate_hours_are_burned_and_a_productive_hour_opens_only_the_next() {
    let World { mut d, idl: vesolve, admin, solv3, gauge, native, reward_vault } = world();
    let owner = d.owner;
    let t1 = START + WEEK;
    patch_votes(&mut d.env, 0, &gauge, 1_000);

    let emission_pda = pda(VESOLVE, &[b"epoch_emission", &1u64.to_le_bytes()]);
    let init_emission = vesolve.ix(
        VESOLVE,
        "initialize_epoch_emission",
        &1u64.to_le_bytes(),
        &[
            ("caller", admin),
            ("protocol", protocol()),
            ("voting_epoch", epoch(0)),
            ("epoch_emission", emission_pda),
            ("developer_wallet", admin),
            ("token_mint", solv3),
            ("developer_token_account", ata(&admin, &solv3)),
            ("token_program", pk(TOKEN_PROGRAM)),
            ("admin_config", admin_config()),
        ],
    );
    d.env.ok(&admin, &[init_emission]);
    let fund = vesolve.ix(
        VESOLVE,
        "fund_native_gauge",
        &1u64.to_le_bytes(),
        &[
            ("caller", admin),
            ("protocol", protocol()),
            ("voting_epoch", epoch(0)),
            ("epoch_emission", emission_pda),
            ("gauge", gauge),
            ("native_gauge", native),
            ("pool", d.pool),
            ("reward_mint", solv3),
            ("reward_vault", reward_vault),
            ("solve_program", pk(SOLVE)),
            ("token_program", pk(TOKEN_PROGRAM)),
            ("admin_config", admin_config()),
        ],
    );
    d.env.ok(&admin, &[fund]);

    // 96% of E(0) = 1.3M SOLV3 goes to the one gauge
    let funded: u64 = 1_248_000_000_000_000;
    assert_eq!(d.env.token_balance(&reward_vault), funded);
    let dev = 52_000_000_000_000u64;
    assert_eq!(supply(&d.env, &solv3), dev + funded);

    let duration = (WEEK - 5) as u128;
    let rate_x64 = ((funded as u128) << 64) / duration;
    let settle = |idl: &Idl| {
        idl.ix(
            VESOLVE,
            "settle_native_gauge_unearned",
            &[],
            &[("caller", admin), ("protocol", protocol()), ("gauge", gauge), ("native_gauge", native), ("pool", d.pool), ("reward_mint", solv3), ("reward_vault", reward_vault), ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM))],
        )
    };

    // Hour 0 of the stream: the gate is closed (nothing traded in the hour before),
    // but real trading happens now and clears the yield bar for the NEXT hour.
    for i in 0..40 {
        d.env.set_time(t1 + 100 + i);
        let s = d.swap_ix(10_000_000, i % 2 == 0);
        d.env.ok(&owner, &[s]);
    }

    // First checkpoint inside hour 1: only the seconds of hour 1 are earnable.
    d.env.set_time(t1 + HOUR + 10);
    let before = d.env.token_balance(&reward_vault);
    d.env.ok(&admin, &[settle(&vesolve)]);
    let burned_1 = before - d.env.token_balance(&reward_vault);
    let lost_1 = (HOUR + 10 - 5 - 10) as u128; // hour 0 closed; 10 s of hour 1 open
    let expect_1 = ((rate_x64 * lost_1) >> 64) as u64;
    assert_eq!(burned_1, expect_1, "closed-gate seconds are burned");
    assert_eq!(supply(&d.env, &solv3), dev + funded - burned_1, "the burn reduces total supply");

    // No trading in hour 1 means hour 2 is closed. Settling in hour 2 burns the
    // seconds of hour 2 so far; hour 1 itself was open and stays earnable.
    d.env.set_time(t1 + 2 * HOUR + 10);
    d.env.ok(&admin, &[settle(&vesolve)]);
    let burned_total = funded - d.env.token_balance(&reward_vault);
    let lost_total = lost_1 + 10;
    assert_eq!(burned_total, ((rate_x64 * lost_total) >> 64) as u64);

    // Nothing new is unearned right after: settling again burns nothing and succeeds.
    let again = d.env.token_balance(&reward_vault);
    d.env.ok(&admin, &[settle(&vesolve)]);
    assert_eq!(d.env.token_balance(&reward_vault), again);
}
