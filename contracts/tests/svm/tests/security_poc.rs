//! Security review 2026-10-11: each test started as a proof of concept of a finding and now asserts that the
//! attack is refused (or, for checked-and-sound areas, that the defence holds).
use svm_tests::gauge_world::*;
use svm_tests::*;

const TREASURY_AT: usize = 52; // AdminConfig: disc 8 + pending_admin 32 + 7 pause flags + gate set 1 + gate ppm 4
const TOTAL_LOCKED_AT: usize = 88; // Protocol: disc 8 + admin 32 + token_mint 32 + next_nft 8 + total_supply 8

fn configured_treasury(w: &World) -> Pubkey {
    Pubkey::try_from(&w.d.env.account(&admin_config()).unwrap().data[TREASURY_AT..TREASURY_AT + 32]).unwrap()
}

fn set_treasury_ix(w: &World, t: &Pubkey) -> solana_instruction::Instruction {
    w.idl.ix(
        VESOLVE,
        "set_treasury",
        &key_bytes(t),
        &[("admin", w.admin), ("protocol", protocol()), ("admin_config", admin_config()), ("treasury_change", treasury_change())],
    )
}

fn withdraw_ix(w: &World, signer: Pubkey, mint: Pubkey, to: Pubkey, amount: u64) -> solana_instruction::Instruction {
    w.idl.ix(
        VESOLVE,
        "withdraw_auto_vote_fees",
        &amount.to_le_bytes(),
        &[
            ("admin", signer), ("protocol", protocol()), ("token_mint", mint), ("treasury_token_account", ata(&protocol(), &mint)),
            ("treasury", to), ("destination_token_account", ata(&to, &mint)), ("admin_config", admin_config()),
            ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
        ],
    )
}

fn apply_ix(w: &World, caller: Pubkey) -> solana_instruction::Instruction {
    w.idl.ix(VESOLVE, "apply_treasury_change", &[], &[("caller", caller), ("admin_config", admin_config()), ("treasury_change", treasury_change())])
}

/// H-1 (fixed): the Protocol PDA's SOLV3 account holds every lock's principal. A fee withdrawal can take only
/// what sits above the total locked, never the principal.
#[test]
fn h1_fee_withdrawal_cannot_touch_locked_principal() {
    let mut w = world();
    let admin = w.admin;
    let mint = w.solv3;
    let treasury = unique();
    w.d.env.ok(&admin, &[set_treasury_ix(&w, &treasury)]);
    assert_eq!(configured_treasury(&w), treasury, "the first Treasury applies at once");

    let locked = 2_780_000_000_000; // the live balance on 2026-10-11
    let fees = 1_000;
    let vault = ata(&protocol(), &mint);
    w.d.env.set_token_account(&vault, &mint, &protocol(), locked + fees);
    let mut p = w.d.env.account(&protocol()).unwrap();
    p.data[TOTAL_LOCKED_AT..TOTAL_LOCKED_AT + 8].copy_from_slice(&locked.to_le_bytes());
    w.d.env.svm.set_account(protocol(), p).unwrap();

    let err = w.d.env.send(&admin, &[withdraw_ix(&w, admin, mint, treasury, locked + fees)]).unwrap_err();
    assert!(err.has("WithdrawalExceedsFees"), "{:?}", err.logs);
    let err = w.d.env.send(&admin, &[withdraw_ix(&w, admin, mint, treasury, fees + 1)]).unwrap_err();
    assert!(err.has("WithdrawalExceedsFees"), "{:?}", err.logs);
    w.d.env.ok(&admin, &[withdraw_ix(&w, admin, mint, treasury, fees)]);
    assert_eq!(w.d.env.token_balance(&vault), locked, "the principal is untouched");
    assert_eq!(w.d.env.token_balance(&ata(&treasury, &mint)), fees);
}

/// H-1 (fixed): once a Treasury is set, changing it waits 24 hours, so a stolen Admin key cannot redirect a
/// withdrawal in the same transaction. Anyone applies the change after the delay; the Admin can cancel it.
#[test]
fn h1_treasury_changes_wait_out_the_delay() {
    let mut w = world();
    let admin = w.admin;
    let mint = w.solv3;
    let treasury = unique();
    w.d.env.ok(&admin, &[set_treasury_ix(&w, &treasury)]);

    let attacker = unique();
    w.d.env.fund(&attacker);
    w.d.env.set_token_account(&ata(&protocol(), &mint), &mint, &protocol(), 500);
    w.d.env.ok(&admin, &[set_treasury_ix(&w, &attacker)]);
    assert_eq!(configured_treasury(&w), treasury, "a change is only scheduled");
    assert!(w.d.env.send(&admin, &[withdraw_ix(&w, admin, mint, attacker, 500)]).unwrap_err().has("InvalidTreasury"));
    let stranger = unique();
    w.d.env.fund(&stranger);
    assert!(w.d.env.send(&stranger, &[apply_ix(&w, stranger)]).unwrap_err().has("TreasuryChangeNotDue"));

    // Cancelling (scheduling the default key) clears it.
    w.d.env.ok(&admin, &[set_treasury_ix(&w, &Pubkey::default())]);
    let now = START + WEEK + 5;
    w.d.env.set_time(now + 2 * 24 * 3_600);
    assert!(w.d.env.send(&stranger, &[apply_ix(&w, stranger)]).unwrap_err().has("TreasuryChangeNotDue"));

    // A real change applies after the delay, by anyone.
    let next = unique();
    w.d.env.ok(&admin, &[set_treasury_ix(&w, &next)]);
    w.d.env.set_time(now + 2 * 24 * 3_600 + 24 * 3_600 - 1);
    assert!(w.d.env.send(&stranger, &[apply_ix(&w, stranger)]).is_err(), "one second early");
    w.d.env.set_time(now + 2 * 24 * 3_600 + 24 * 3_600 + 1);
    w.d.env.ok(&stranger, &[apply_ix(&w, stranger)]);
    assert_eq!(configured_treasury(&w), next);
}

/// H-2 (fixed): the Protocol PDA is the DEX's protocol-fee collector, so the Admin (or anyone holding its key)
/// cannot collect voters' trading fees from the DEX directly any more.
#[test]
fn h2_admin_cannot_collect_trading_fees_from_the_dex() {
    let mut w = world();
    let admin = w.admin;
    let ix = w.d.idl.ix(
        SOLVE,
        "collect_protocol_fees",
        &[],
        &[
            ("solves_config", w.d.config), ("solve", w.d.pool), ("collect_protocol_fees_authority", admin),
            ("token_vault_a", w.d.vault_a), ("token_vault_b", w.d.vault_b),
            ("token_destination_a", ata(&admin, &w.d.mint_a)), ("token_destination_b", ata(&admin, &w.d.mint_b)),
            ("token_program", pk(TOKEN_PROGRAM)),
        ],
    );
    let (ma, mb) = (w.d.mint_a, w.d.mint_b);
    w.d.env.set_token_account(&ata(&admin, &ma), &ma, &admin, 0);
    w.d.env.set_token_account(&ata(&admin, &mb), &mb, &admin, 0);
    let err = w.d.env.send(&admin, &[ix]).unwrap_err();
    assert!(err.has("collect_protocol_fees_authority"), "{:?}", err.logs);
}

/// H-2 (fixed): pool fee splits follow one rule anyone can apply, and the remaining DEX settings change only
/// through Admin pass-throughs signed by the Protocol PDA.
#[test]
fn h2_fee_rule_is_permissionless_and_dex_settings_stay_admin_only() {
    let mut w = world();
    let admin = w.admin;
    let stranger = unique();
    w.d.env.fund(&stranger);
    let gauge = w.gauge;
    let sync = w.idl.ix(
        VESOLVE,
        "sync_pool_fee_rate",
        &[],
        &[("caller", stranger), ("protocol", protocol()), ("solves_config", w.d.config), ("pool", w.d.pool), ("gauge", gauge), ("solve_program", pk(SOLVE))],
    );
    let err = w.d.env.send(&stranger, &[sync]).unwrap_err();
    assert!(err.has("FeeRateAlreadySynced"), "an active gauge's pool already sends every fee to voters: {:?}", err.logs);

    let pause = |w: &World, who: Pubkey, on: bool| {
        w.idl.ix(
            VESOLVE,
            "dex_set_trading_pauses",
            &[b(on), b(false)],
            &[("admin", who), ("protocol", protocol()), ("solves_config", w.d.config), ("target", w.d.config), ("solve_program", pk(SOLVE))],
        )
    };
    assert!(w.d.env.send(&stranger, &[pause(&w, stranger, true)]).unwrap_err().has("Unauthorized"));
    w.d.env.ok(&admin, &[pause(&w, admin, true)]);
    let swap = w.d.swap_ix(1_000, true);
    let owner = w.d.owner;
    assert!(w.d.env.send(&owner, &[swap]).is_err(), "swaps paused through the pass-through");
    w.d.env.ok(&admin, &[pause(&w, admin, false)]);
    // The Admin's own key is no longer the DEX fee authority.
    assert!(w.d.set_pauses(admin, true, false).is_err());
}

/// Checked and defended: the legacy `fund_gauge_emission` entry point is switched off in lib.rs (always
/// NativeGaugeRequired), so a native gauge's epoch budget cannot be minted twice or diverted into the legacy vault.
#[test]
fn defended_legacy_funding_cannot_divert_native_gauge_emissions() {
    let mut w = world();
    let admin = w.admin;
    let solv3 = w.solv3;
    let gauge = w.gauge;
    patch_votes(&mut w.d.env, 0, &gauge, 1_000);

    let attacker = unique();
    w.d.env.fund(&attacker);
    let emission = pda(VESOLVE, &[b"epoch_emission", &1u64.to_le_bytes()]);
    let init = w.idl.ix(
        VESOLVE, "initialize_epoch_emission", &1u64.to_le_bytes(),
        &[("caller", attacker), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission), ("developer_wallet", admin),
          ("token_mint", solv3), ("developer_token_account", ata(&admin, &solv3)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    w.d.env.ok(&attacker, &[init]);
    let legacy = pda(VESOLVE, &[b"gauge_reward", gauge.as_ref()]);
    let legacy_fund = w.idl.ix(
        VESOLVE, "fund_gauge_emission", &1u64.to_le_bytes(),
        &[("caller", attacker), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission), ("gauge", gauge),
          ("gauge_reward", legacy), ("token_mint", solv3), ("reward_vault", ata(&legacy, &solv3)), ("token_program", pk(TOKEN_PROGRAM)),
          ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)), ("admin_config", admin_config())],
    );
    let err = w.d.env.send(&attacker, &[legacy_fund]).unwrap_err();
    assert!(err.has("NativeGaugeRequired"), "{:?}", err.logs);

    let native_fund = w.idl.ix(
        VESOLVE, "fund_native_gauge", &1u64.to_le_bytes(),
        &[("caller", attacker), ("protocol", protocol()), ("voting_epoch", epoch(0)), ("epoch_emission", emission), ("gauge", gauge), ("native_gauge", w.native),
          ("pool", w.d.pool), ("reward_mint", solv3), ("reward_vault", w.reward_vault), ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config())],
    );
    w.d.env.ok(&attacker, &[native_fund.clone()]);
    assert!(w.d.env.token_balance(&w.reward_vault) > 0, "native funding still works, permissionlessly");
    assert!(w.d.env.send(&attacker, &[native_fund]).is_err(), "and only once per epoch");
}
