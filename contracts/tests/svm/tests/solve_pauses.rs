use svm_tests::dex::*;
use svm_tests::*;

#[test]
fn swaps_and_liquidity_work_before_any_pause() {
    let mut d = setup();
    let add = d.liquidity_ix("increase_liquidity", 1_000_000_000);
    d.env.ok(&d.owner.clone(), &[add]);
    assert!(d.env.token_balance(&d.vault_a) > 0 && d.env.token_balance(&d.vault_b) > 0, "in-range position holds both tokens");
    let before = d.env.token_balance(&d.user_b);
    let swap = d.swap_ix(1_000, true);
    d.env.ok(&d.owner.clone(), &[swap]);
    assert!(d.env.token_balance(&d.user_b) > before, "the swap paid out token B");
}

#[test]
fn swap_pause_stops_swaps_only_and_belongs_to_the_fee_authority() {
    let mut d = setup();
    let add = d.liquidity_ix("increase_liquidity", 1_000_000_000);
    d.env.ok(&d.owner.clone(), &[add]);

    let stranger = unique();
    d.env.fund(&stranger);
    assert!(d.set_pauses(stranger, true, true).is_err(), "only the fee authority can pause");

    d.set_pauses(d.fee_authority, true, false).unwrap();
    let swap = d.swap_ix(1_000, true);
    let err = d.env.send(&d.owner.clone(), &[swap]).unwrap_err();
    assert!(err.has("Swaps are paused"), "{:?}", err.logs);
    // liquidity can still be added and removed
    let add = d.liquidity_ix("increase_liquidity", 1_000_000);
    d.env.ok(&d.owner.clone(), &[add]);
    let rm = d.liquidity_ix("decrease_liquidity", 1_000_000);
    d.env.ok(&d.owner.clone(), &[rm]);

    d.set_pauses(d.fee_authority, false, false).unwrap();
    let swap = d.swap_ix(1_000, true);
    d.env.ok(&d.owner.clone(), &[swap]);
}

#[test]
fn liquidity_pause_blocks_new_liquidity_but_never_withdrawals() {
    let mut d = setup();
    let add = d.liquidity_ix("increase_liquidity", 1_000_000_000);
    d.env.ok(&d.owner.clone(), &[add]);
    d.set_pauses(d.fee_authority, true, true).unwrap();
    let add = d.liquidity_ix("increase_liquidity", 1_000);
    let err = d.env.send(&d.owner.clone(), &[add]).unwrap_err();
    assert!(err.has("Adding liquidity is paused"), "{:?}", err.logs);
    let rm = d.liquidity_ix("decrease_liquidity", 1_000_000_000);
    d.env.ok(&d.owner.clone(), &[rm]);
    assert!(d.env.token_balance(&d.vault_a) < 10, "LP got everything back while fully paused");
}

#[test]
fn the_pause_key_moves_with_the_fee_authority() {
    let mut d = setup();
    let new = unique();
    d.env.fund(&new);
    let ix = d.idl.ix(SOLVE, "set_fee_authority", &[], &[("solves_config", d.config), ("fee_authority", d.fee_authority), ("new_fee_authority", new)]);
    d.env.ok(&d.fee_authority.clone(), &[ix]);
    assert!(d.set_pauses(d.fee_authority, true, false).is_err());
    d.set_pauses(new, true, false).unwrap();
    let _ = (&d.mint_a, &d.mint_b);
}

#[test]
fn trading_pauses_belong_to_the_transferable_fee_authority_not_a_compiled_key() {
    let mut d = setup();
    // the compiled-in bootstrap key (the test payer) has no say over trading pauses
    let bootstrap = d.env.payer;
    assert!(d.set_pauses(bootstrap, true, false).is_err());
    let stranger = unique();
    d.env.fund(&stranger);
    assert!(d.set_pauses(stranger, true, false).is_err());
    let fa = d.fee_authority;
    d.set_pauses(fa, true, false).unwrap();
}
