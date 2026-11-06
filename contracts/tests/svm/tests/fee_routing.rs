//! Full Launch A2 fee routing on a real pool: 95% LP / 5% Treasury without an
//! active gauge, 100% voters with one, and fees are always settled under the
//! routing they accrued under.
use svm_tests::gauge_world::*;
use svm_tests::*;

const ATA_PROGRAM: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const RATE_AT: usize = 47; // protocol_fee_rate (u16) in the Solve account
const OWED_A_AT: usize = 85;
const OWED_B_AT: usize = 93;

fn rate(d: &dex::Dex) -> u16 {
    u16::from_le_bytes(d.env.account(&d.pool).unwrap().data[RATE_AT..RATE_AT + 2].try_into().unwrap())
}
fn owed(d: &dex::Dex) -> (u64, u64) {
    let data = d.env.account(&d.pool).unwrap().data;
    (u64::from_le_bytes(data[OWED_A_AT..OWED_A_AT + 8].try_into().unwrap()), u64::from_le_bytes(data[OWED_B_AT..OWED_B_AT + 8].try_into().unwrap()))
}

#[test]
fn fees_are_settled_under_the_routing_they_accrued_under() {
    let World { mut d, idl: vesolve, admin, solv3, gauge, native, reward_vault } = world();
    let owner = d.owner;
    let treasury = unique();
    let set_treasury = vesolve.ix(VESOLVE, "set_treasury", &key_bytes(&treasury), &[("admin", admin), ("protocol", protocol()), ("admin_config", admin_config()), ("treasury_change", treasury_change())]);
    d.env.ok(&admin, &[set_treasury]);
    d.env.set_time(START + WEEK + 100);

    let configure = |d: &dex::Dex, active: bool| {
        vesolve.ix(
            VESOLVE,
            "configure_native_gauge",
            &[active as u8],
            &[
                ("caller", admin), ("protocol", protocol()), ("gauge", gauge), ("solves_config", d.config), ("pool", d.pool),
                ("token_mint_a", d.mint_a), ("token_mint_b", d.mint_b), ("native_gauge", native),
                ("legacy_reward", pda(VESOLVE, &[b"gauge_reward", gauge.as_ref()])),
                ("reward_mint", solv3), ("legacy_vault", ata(&pda(VESOLVE, &[b"gauge_reward", gauge.as_ref()]), &solv3)),
                ("reward_vault", reward_vault), ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config()),
            ],
        )
    };
    let schedule = |d: &dex::Dex| {
        let (lo, hi) = if d.mint_a.to_bytes() < d.mint_b.to_bytes() { (d.mint_a, d.mint_b) } else { (d.mint_b, d.mint_a) };
        let mut a = key_bytes(&lo);
        a.extend(key_bytes(&hi));
        vesolve.ix(
            VESOLVE,
            "schedule_gauge_activation",
            &a,
            &[
                ("admin", admin), ("protocol", protocol()), ("gauge", gauge), ("pool", d.pool),
                ("pair", pda(VESOLVE, &[b"pair", lo.as_ref(), hi.as_ref()])), ("occupant", pk(VESOLVE)),
                ("system_program", pk(SYSTEM_PROGRAM)), ("admin_config", admin_config()),
            ],
        )
    };
    let request_removal = || vesolve.ix(VESOLVE, "request_gauge_removal", &[], &[("admin", admin), ("protocol", protocol()), ("gauge", gauge), ("admin_config", admin_config())]);
    let roll = |d: &mut dex::Dex, n: u64| {
        d.env.set_time(START + (n as i64) * WEEK + 100);
        let ix = vesolve.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(n))]);
        d.env.ok(&admin, &[ix]);
    };
    let route = |d: &dex::Dex, n: u64| {
        let vault = pda(VESOLVE, &[b"vault", &n.to_le_bytes(), gauge.as_ref()]);
        vesolve.ix(
            VESOLVE,
            "route_pool_fees",
            &n.to_le_bytes(),
            &[
                ("epoch", epoch(n)),
                ("caller", admin), ("protocol", protocol()), ("gauge", gauge), ("solves_config", d.config), ("pool", d.pool),
                ("vault", vault), ("token_mint_a", d.mint_a), ("token_mint_b", d.mint_b),
                ("token_vault_a", d.vault_a), ("token_vault_b", d.vault_b),
                ("vault_token_account_a", ata(&vault, &d.mint_a)), ("vault_token_account_b", ata(&vault, &d.mint_b)),
                ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)),
                ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
            ],
        )
    };
    let sweep = |d: &dex::Dex| {
        vesolve.ix(
            VESOLVE,
            "sweep_ungauged_pool_fees",
            &[],
            &[
                ("caller", admin), ("protocol", protocol()), ("solves_config", d.config), ("pool", d.pool),
                ("token_mint_a", d.mint_a), ("token_mint_b", d.mint_b), ("token_vault_a", d.vault_a), ("token_vault_b", d.vault_b),
                ("treasury", treasury), ("treasury_token_account_a", ata(&treasury, &d.mint_a)), ("treasury_token_account_b", ata(&treasury, &d.mint_b)),
                ("admin_config", admin_config()), ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)),
                ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
            ],
        )
    };
    // Owed fees of a removal-due gauge without votes settle straight to the Treasury (DEV-17), permissionlessly
    // and only to the Treasury now that the Protocol PDA is the DEX's collector (review H-2).
    let collect_to_treasury = |d: &dex::Dex| settle_removed_ix(&vesolve, d, owner, gauge, treasury);
    let trade = |d: &mut dex::Dex| {
        for i in 0..6 {
            let s = d.swap_ix(10_000_000, i % 2 == 0);
            d.env.ok(&owner, &[s]);
        }
    };

    // Gauge active: every protocol-side fee belongs to voters.
    assert_eq!(rate(&d), 10_000);
    trade(&mut d);
    let (a, b) = owed(&d);
    assert!(a > 0 || b > 0, "swaps accrued protocol-side fees");
    let err = d.env.send(&admin, &[sweep(&d)]).unwrap_err();
    assert!(err.has("ungauged fee rate"), "a gauged pool's fees can never go to the Treasury: {:?}", err.logs);

    // Removal takes effect at the next rollover, not now.
    d.env.ok(&admin, &[request_removal()]);
    let err = d.env.send(&admin, &[configure(&d, false)]).unwrap_err();
    assert!(err.has("GaugeTransitionNotDue"), "{:?}", err.logs);
    roll(&mut d, 2);

    // Removal is refused until the owed fees are settled. A removal-due gauge takes no votes, so routing them
    // into this epoch's vault is refused (DEV-10: nobody could claim them); they settle to the Treasury instead.
    let err = d.env.send(&admin, &[configure(&d, false)]).unwrap_err();
    assert!(err.has("Collect this pool"), "{:?}", err.logs);
    let err = d.env.send(&admin, &[route(&d, 2)]).unwrap_err();
    assert!(err.has("GaugeHasNoVotes"), "fees are never routed into an epoch without votes: {:?}", err.logs);
    let owed_at_removal = owed(&d);
    let (ma, mb) = (d.mint_a, d.mint_b);
    d.env.set_token_account(&ata(&treasury, &ma), &ma, &treasury, 0);
    d.env.set_token_account(&ata(&treasury, &mb), &mb, &treasury, 0);
    d.env.ok(&admin, &[collect_to_treasury(&d)]);
    assert_eq!(owed(&d), (0, 0));
    assert_eq!((d.env.token_balance(&ata(&treasury, &ma)), d.env.token_balance(&ata(&treasury, &mb))), owed_at_removal);
    d.env.ok(&admin, &[configure(&d, false)]);
    assert_eq!(rate(&d), 500, "no gauge: 5% protocol side, 95% LP");

    // Ungauged: the 5% side is swept to the Treasury and only that.
    trade(&mut d);
    let (a, b) = owed(&d);
    assert!(a > 0 || b > 0);
    let err = d.env.send(&admin, &[route(&d, 2)]).unwrap_err();
    assert!(err.has("native range-aware"), "an ungauged pool's fees cannot be routed to voters: {:?}", err.logs);
    let before = (d.env.token_balance(&ata(&treasury, &d.mint_a)), d.env.token_balance(&ata(&treasury, &d.mint_b)));
    d.env.ok(&admin, &[sweep(&d)]);
    assert_eq!(owed(&d), (0, 0));
    assert_eq!(d.env.token_balance(&ata(&treasury, &d.mint_a)), before.0 + a);
    assert_eq!(d.env.token_balance(&ata(&treasury, &d.mint_b)), before.1 + b);

    // A wrong Treasury account is refused. Anyone may sweep (review H-2), but only into the Treasury.
    trade(&mut d);
    let mut bad = sweep(&d);
    bad.accounts.iter_mut().find(|m| m.pubkey == treasury).unwrap().pubkey = unique();
    assert!(d.env.send(&admin, &[bad]).is_err());
    let stranger = unique();
    d.env.fund(&stranger);
    let (oa, ob) = owed(&d);
    let before = (d.env.token_balance(&ata(&treasury, &d.mint_a)), d.env.token_balance(&ata(&treasury, &d.mint_b)));
    let mut who = sweep(&d);
    who.accounts[0].pubkey = stranger;
    d.env.ok(&stranger, &[who]);
    assert_eq!(owed(&d), (0, 0));
    assert_eq!((d.env.token_balance(&ata(&treasury, &d.mint_a)), d.env.token_balance(&ata(&treasury, &d.mint_b))), (before.0 + oa, before.1 + ob));

    // Re-activation is scheduled for the next epoch, then refused while Treasury-side fees are uncollected.
    trade(&mut d);
    d.env.ok(&admin, &[schedule(&d)]);
    roll(&mut d, 3);
    let err = d.env.send(&admin, &[configure(&d, true)]).unwrap_err();
    assert!(err.has("Collect this pool"), "{:?}", err.logs);
    d.env.ok(&admin, &[sweep(&d)]);
    d.env.ok(&admin, &[configure(&d, true)]);
    assert_eq!(rate(&d), 10_000);
}

/// DEV-10: fees are routed only into an epoch where the gauge has votes, and fees already sitting in a zero-vote
/// epoch's vault (routed before this guard existed) go to the Treasury, once, after that epoch ends.
#[test]
fn fees_never_strand_in_an_epoch_without_votes() {
    let World { mut d, idl: vesolve, admin, gauge, .. } = world();
    let owner = d.owner;
    let treasury = unique();
    let set_treasury = vesolve.ix(VESOLVE, "set_treasury", &key_bytes(&treasury), &[("admin", admin), ("protocol", protocol()), ("admin_config", admin_config()), ("treasury_change", treasury_change())]);
    d.env.ok(&admin, &[set_treasury]);
    d.env.set_time(START + WEEK + 100);
    let vault = pda(VESOLVE, &[b"vault", &1u64.to_le_bytes(), gauge.as_ref()]);
    let route = |d: &dex::Dex| {
        vesolve.ix(
            VESOLVE,
            "route_pool_fees",
            &1u64.to_le_bytes(),
            &[
                ("epoch", epoch(1)),
                ("caller", admin), ("protocol", protocol()), ("gauge", gauge), ("solves_config", d.config), ("pool", d.pool),
                ("vault", vault), ("token_mint_a", d.mint_a), ("token_mint_b", d.mint_b),
                ("token_vault_a", d.vault_a), ("token_vault_b", d.vault_b),
                ("vault_token_account_a", ata(&vault, &d.mint_a)), ("vault_token_account_b", ata(&vault, &d.mint_b)),
                ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)),
                ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
            ],
        )
    };
    let sweep = |d: &dex::Dex, caller: Pubkey| {
        vesolve.ix(
            VESOLVE,
            "sweep_unvoted_pool_fees",
            &[],
            &[
                ("caller", caller), ("protocol", protocol()), ("gauge", gauge), ("epoch", epoch(1)), ("vault", vault),
                ("token_mint_a", d.mint_a), ("token_mint_b", d.mint_b),
                ("vault_token_account_a", ata(&vault, &d.mint_a)), ("vault_token_account_b", ata(&vault, &d.mint_b)),
                ("treasury", treasury), ("treasury_token_account_a", ata(&treasury, &d.mint_a)), ("treasury_token_account_b", ata(&treasury, &d.mint_b)),
                ("admin_config", admin_config()), ("system_program", pk(SYSTEM_PROGRAM)), ("token_program", pk(TOKEN_PROGRAM)),
                ("associated_token_program", pk(ATA_PROGRAM)),
            ],
        )
    };
    for i in 0..6 {
        let s = d.swap_ix(10_000_000, i % 2 == 0);
        d.env.ok(&owner, &[s]);
    }
    let (a, b) = owed(&d);
    assert!(a > 0 && b > 0);

    // No votes yet: refused, and the fees stay owed in the pool.
    let err = d.env.send(&admin, &[route(&d)]).unwrap_err();
    assert!(err.has("GaugeHasNoVotes"), "{:?}", err.logs);
    assert_eq!(owed(&d), (a, b));

    // With votes the fees route into the voters' vault.
    let epoch_without_votes = d.env.account(&epoch(1)).unwrap();
    patch_votes(&mut d.env, 1, &gauge, 1_000);
    d.env.ok(&admin, &[route(&d)]);
    assert_eq!(owed(&d), (0, 0));
    assert_eq!((d.env.token_balance(&ata(&vault, &d.mint_a)), d.env.token_balance(&ata(&vault, &d.mint_b))), (a, b));

    // A vault whose epoch ended with votes is never swept.
    let stranger = unique();
    d.env.fund(&stranger);
    d.env.set_time(START + 2 * WEEK + 100);
    let err = d.env.send(&stranger, &[sweep(&d, stranger)]).unwrap_err();
    assert!(err.has("GaugeHasVotes"), "{:?}", err.logs);

    // The legacy case: the epoch's votes are gone (fees routed before the guard existed). Not before the epoch
    // ends; then anyone can send exactly the recorded pool fees to the Treasury, once.
    d.env.svm.set_account(epoch(1), epoch_without_votes).unwrap();
    d.env.set_time(START + WEEK + 200);
    let err = d.env.send(&stranger, &[sweep(&d, stranger)]).unwrap_err();
    assert!(err.has("EpochNotFinalized"), "{:?}", err.logs);
    d.env.set_time(START + 2 * WEEK + 100);
    let mut wrong = sweep(&d, stranger);
    wrong.accounts.iter_mut().find(|m| m.pubkey == treasury).unwrap().pubkey = unique();
    assert!(d.env.send(&stranger, &[wrong]).is_err(), "only the configured Treasury can receive them");
    d.env.ok(&stranger, &[sweep(&d, stranger)]);
    assert_eq!(d.env.token_balance(&ata(&treasury, &d.mint_a)), a);
    assert_eq!(d.env.token_balance(&ata(&treasury, &d.mint_b)), b);
    assert_eq!((d.env.token_balance(&ata(&vault, &d.mint_a)), d.env.token_balance(&ata(&vault, &d.mint_b))), (0, 0));
    assert!(d.env.send(&stranger, &[sweep(&d, stranger)]).is_err(), "swept once");
}
