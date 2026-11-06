//! Exiting a lock: closed through epoch 3, needs a published price, blocked
//! while the lock has voted this epoch or Exit is paused, and when it works it
//! charges exactly 40% of market value in SOL and returns the full principal.
//! The Lock, ve mint and ve token account are written straight into state
//! (create_lock needs the token metadata program).
use sha2::{Digest, Sha256};
use svm_tests::gauge_world::*;
use svm_tests::*;

const LOCK_ID: u64 = 7;
const AMOUNT: u64 = 2_000_000_000; // 2 SOLV3
const PRICE: u64 = 1_000_000_000; // 1 SOL per SOLV3
const FEE: u64 = 800_000_000; // 2 * 1 SOL * 40%

fn account_disc(name: &str) -> [u8; 8] {
    Sha256::digest(format!("account:{name}").as_bytes())[..8].try_into().unwrap()
}

struct Ex {
    w: World,
    user: Pubkey,
    lock: Pubkey,
    ve_mint: Pubkey,
    ve_token: Pubkey,
    user_solv3: Pubkey,
    protocol_solv3: Pubkey,
    exit_config: Pubkey,
    exit_fee_config: Pubkey,
}

fn setup() -> Ex {
    let mut w = world();
    let user = unique();
    w.d.env.fund(&user);
    let ve_id = LOCK_ID.to_le_bytes();
    let lock = pda(VESOLVE, &[b"ve_lock", &ve_id]);
    let lock_bump = Pubkey::find_program_address(&[b"ve_lock", &ve_id], &pk(VESOLVE)).1;
    let ve_mint = pda(VESOLVE, &[b"ve_token", &ve_id]);
    let ve_token = ata(&user, &ve_mint);

    // the lock itself
    let mut data = account_disc("Lock").to_vec();
    data.extend(key_bytes(&user));
    data.extend(LOCK_ID.to_le_bytes());
    data.extend(key_bytes(&ve_mint));
    data.extend(AMOUNT.to_le_bytes());
    data.extend((i64::MAX / 2).to_le_bytes());
    data.extend(AMOUNT.to_le_bytes());
    data.extend(0u64.to_le_bytes());
    data.push(lock_bump);
    w.d.env
        .svm
        .set_account(lock, solana_account::Account { lamports: 5_000_000, data, owner: pk(VESOLVE), executable: false, rent_epoch: 0 })
        .unwrap();

    // ve mint: supply 1, decimals 0, freeze authority = itself; token account frozen
    let mut m = vec![0u8; 82];
    m[36..44].copy_from_slice(&1u64.to_le_bytes());
    m[45] = 1;
    m[46..50].copy_from_slice(&1u32.to_le_bytes());
    m[50..82].copy_from_slice(ve_mint.as_ref());
    w.d.env
        .svm
        .set_account(ve_mint, solana_account::Account { lamports: 1_461_600, data: m, owner: pk(TOKEN_PROGRAM), executable: false, rent_epoch: 0 })
        .unwrap();
    w.d.env.set_token_account(&ve_token, &ve_mint, &user, 1);
    let mut t = w.d.env.account(&ve_token).unwrap();
    t.data[108] = 2; // frozen
    w.d.env.svm.set_account(ve_token, t).unwrap();

    // protocol totals and the SOLV3 it holds
    let mut p = w.d.env.account(&protocol()).unwrap();
    p.data[80..88].copy_from_slice(&1u64.to_le_bytes()); // total_supply
    p.data[88..96].copy_from_slice(&AMOUNT.to_le_bytes()); // total_locked
    w.d.env.svm.set_account(protocol(), p).unwrap();
    let protocol_solv3 = ata(&protocol(), &w.solv3);
    w.d.env.set_token_account(&protocol_solv3, &w.solv3, &protocol(), AMOUNT);
    let user_solv3 = ata(&user, &w.solv3);
    w.d.env.set_token_account(&user_solv3, &w.solv3, &user, 0);

    let exit_config = pda(VESOLVE, &[b"exit_config"]);
    let exit_fee_config = pda(VESOLVE, &[b"exit_fee_config"]);
    Ex { w, user, lock, ve_mint, ve_token, user_solv3, protocol_solv3, exit_config, exit_fee_config }
}

fn set_price(e: &mut Ex, price: u64) {
    let admin = e.w.admin;
    let ix = e.w.idl.ix(
        VESOLVE,
        "set_exit_price",
        &price.to_le_bytes(),
        &[("authority", admin), ("protocol", protocol()), ("exit_config", e.exit_config), ("keeper_config", keeper_config()), ("system_program", pk(SYSTEM_PROGRAM))],
    );
    e.w.d.env.ok(&admin, &[ix]);
}

fn roll_to(e: &mut Ex, target: u64) {
    let admin = e.w.admin;
    let from = protocol_u64(e, 96) + 1; // current_epoch
    for n in from..=target {
        e.w.d.env.set_time(START + WEEK * n as i64 + 100);
        let roll = e.w.idl.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(n))]);
        e.w.d.env.ok(&admin, &[roll]);
    }
}

fn exit(e: &mut Ex) -> Result<Vec<String>, Failure> {
    let ix = e.w.idl.ix(
        VESOLVE,
        "exit_lock",
        &LOCK_ID.to_le_bytes(),
        &[
            ("user", e.user), ("protocol", protocol()), ("exit_config", e.exit_config), ("lock", e.lock),
            ("user_token_account", e.user_solv3), ("token_mint", e.w.solv3), ("protocol_token_account", e.protocol_solv3),
            ("ve_mint", e.ve_mint), ("ve_token_account", e.ve_token),
            ("system_program", pk(SYSTEM_PROGRAM)), ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)),
            ("admin_config", admin_config()), ("exit_fee_config", e.exit_fee_config),
        ],
    );
    let user = e.user;
    e.w.d.env.send(&user, &[ix])
}

fn partial_exit(e: &mut Ex, amount: u64) -> Result<Vec<String>, Failure> {
    let mut args = LOCK_ID.to_le_bytes().to_vec();
    args.extend(amount.to_le_bytes());
    let ix = e.w.idl.ix(
        VESOLVE,
        "partial_exit_lock",
        &args,
        &[
            ("user", e.user), ("protocol", protocol()), ("exit_config", e.exit_config), ("lock", e.lock),
            ("user_token_account", e.user_solv3), ("token_mint", e.w.solv3), ("protocol_token_account", e.protocol_solv3),
            ("system_program", pk(SYSTEM_PROGRAM)), ("token_program", pk(TOKEN_PROGRAM)),
            ("admin_config", admin_config()), ("exit_fee_config", e.exit_fee_config),
        ],
    );
    let user = e.user;
    e.w.d.env.send(&user, &[ix])
}

fn set_fee(e: &mut Ex, signer: Pubkey, bps: u64) -> Result<Vec<String>, Failure> {
    let ix = e.w.idl.ix(
        VESOLVE,
        "set_exit_fee_bps",
        &bps.to_le_bytes(),
        &[("admin", signer), ("protocol", protocol()), ("exit_fee_config", e.exit_fee_config), ("system_program", pk(SYSTEM_PROGRAM))],
    );
    e.w.d.env.send(&signer, &[ix])
}

fn withdraw(e: &mut Ex, destination: Pubkey, amount: u64) -> Result<Vec<String>, Failure> {
    let admin = e.w.admin;
    let ix = e.w.idl.ix(
        VESOLVE,
        "withdraw_exit_fees",
        &amount.to_le_bytes(),
        &[("admin", admin), ("protocol", protocol()), ("destination", destination), ("admin_config", admin_config())],
    );
    e.w.d.env.send(&admin, &[ix])
}

fn lock_amount(e: &Ex) -> u64 {
    // discriminator, owner, id, ve_mint, then amount
    let d = e.w.d.env.account(&e.lock).unwrap().data;
    u64::from_le_bytes(d[8 + 32 + 8 + 32..8 + 32 + 8 + 32 + 8].try_into().unwrap())
}
fn lock_voting_power(e: &Ex) -> u64 {
    let d = e.w.d.env.account(&e.lock).unwrap().data;
    let at = 8 + 32 + 8 + 32 + 8 + 8;
    u64::from_le_bytes(d[at..at + 8].try_into().unwrap())
}

fn protocol_u64(e: &Ex, at: usize) -> u64 {
    u64::from_le_bytes(e.w.d.env.account(&protocol()).unwrap().data[at..at + 8].try_into().unwrap())
}

#[test]
fn exit_is_closed_until_epoch_four_whatever_the_price() {
    let mut e = setup();
    set_price(&mut e, PRICE);
    roll_to(&mut e, 3);
    let err = exit(&mut e).unwrap_err();
    assert!(err.has("ExitDisabled"), "{:?}", err.logs);
    assert!(e.w.d.env.account(&e.lock).is_some(), "lock untouched");
    assert_eq!(e.w.d.env.token_balance(&e.user_solv3), 0);
}

#[test]
fn exit_needs_a_price_and_an_idle_lock_and_respects_the_pause() {
    let mut e = setup();
    roll_to(&mut e, 4);
    let err = exit(&mut e).unwrap_err();
    assert!(err.has("ExitPriceNotSet") || err.has("AccountNotInitialized"), "{:?}", err.logs);

    set_price(&mut e, PRICE);

    // Exit paused: blocked, nothing moves
    let admin = e.w.admin;
    let idl = Idl::vesolve();
    let pauses = |exit: bool| idl.ix(VESOLVE, "set_pauses", &[0, 0, 0, 0, b(exit), 0, 0], &[("admin", admin), ("protocol", protocol()), ("admin_config", admin_config())]);
    let on = pauses(true);
    e.w.d.env.ok(&admin, &[on]);
    let err = exit(&mut e).unwrap_err();
    assert!(err.has("paused"), "{:?}", err.logs);
    assert_eq!(e.w.d.env.token_balance(&e.user_solv3), 0);
    let off = pauses(false);
    e.w.d.env.ok(&admin, &[off]);

    // a lock that voted in the current epoch cannot exit yet
    let mut l = e.w.d.env.account(&e.lock).unwrap();
    l.data[8 + 32 + 8 + 32 + 8 + 8 + 8..8 + 32 + 8 + 32 + 8 + 8 + 8 + 8].copy_from_slice(&4u64.to_le_bytes());
    e.w.d.env.svm.set_account(e.lock, l.clone()).unwrap();
    let err = exit(&mut e).unwrap_err();
    assert!(err.has("LockHasActiveVotes"), "{:?}", err.logs);

    // once the epoch closes, it can
    l.data[8 + 32 + 8 + 32 + 8 + 8 + 8..8 + 32 + 8 + 32 + 8 + 8 + 8 + 8].copy_from_slice(&3u64.to_le_bytes());
    e.w.d.env.svm.set_account(e.lock, l).unwrap();
    exit(&mut e).unwrap();
}

#[test]
fn exit_charges_forty_percent_in_sol_and_returns_the_whole_principal() {
    let mut e = setup();
    set_price(&mut e, PRICE);
    roll_to(&mut e, 4);

    let sol_before = e.w.d.env.account(&e.user).unwrap().lamports;
    let protocol_before = e.w.d.env.account(&protocol()).unwrap().lamports;
    let locked_before = protocol_u64(&e, 88);
    exit(&mut e).unwrap();

    // principal back in full, fee exactly 2 SOLV3 * 1 SOL * 40% to the protocol account
    assert_eq!(e.w.d.env.token_balance(&e.user_solv3), AMOUNT);
    assert_eq!(e.w.d.env.token_balance(&e.protocol_solv3), 0);
    let protocol_after = e.w.d.env.account(&protocol()).unwrap().lamports;
    assert_eq!(protocol_after - protocol_before, FEE);
    let sol_after = e.w.d.env.account(&e.user).unwrap().lamports;
    // user paid the fee, then got the ve token account rent back, less tx fee (the lock record keeps its rent)
    assert!(sol_before - sol_after >= FEE - 8_000_000, "user paid about the fee");
    assert!(sol_before - sol_after <= FEE + 100_000);

    // the lock record stays, emptied, so its past rewards stay claimable (review L-2); ve token burned and gone,
    // protocol totals down
    assert_eq!(lock_amount(&e), 0, "lock emptied, record kept");
    assert_eq!(lock_voting_power(&e), 0);
    assert!(e.w.d.env.account(&e.ve_token).map_or(true, |a| a.lamports == 0), "ve token account closed");
    assert_eq!(supply(&e.w.d.env, &e.ve_mint), 0);
    assert_eq!(protocol_u64(&e, 88), locked_before - AMOUNT);
    assert_eq!(protocol_u64(&e, 80), 0);

    // cannot exit twice
    assert!(exit(&mut e).is_err());
}

#[test]
fn partial_exit_charges_only_the_exited_part_and_leaves_the_rest_locked() {
    let mut e = setup();
    set_price(&mut e, PRICE);
    roll_to(&mut e, 4);

    // exit 0.5 SOLV3 of the 2 SOLV3 lock: fee 0.5 * 1 SOL * 40% = 0.2 SOL
    let part = 500_000_000u64;
    let protocol_before = e.w.d.env.account(&protocol()).unwrap().lamports;
    partial_exit(&mut e, part).unwrap();
    assert_eq!(e.w.d.env.account(&protocol()).unwrap().lamports - protocol_before, 200_000_000);
    assert_eq!(e.w.d.env.token_balance(&e.user_solv3), part);
    assert_eq!(e.w.d.env.token_balance(&e.protocol_solv3), AMOUNT - part);

    // the rest is still one lock with its ve token, power matches the amount
    assert_eq!(lock_amount(&e), AMOUNT - part);
    assert_eq!(lock_voting_power(&e), AMOUNT - part);
    assert_eq!(supply(&e.w.d.env, &e.ve_mint), 1);
    assert_eq!(protocol_u64(&e, 88), AMOUNT - part);
    assert_eq!(protocol_u64(&e, 80), 1, "still one lock");

    // the remainder can then exit in full, and only the remainder pays
    let protocol_before = e.w.d.env.account(&protocol()).unwrap().lamports;
    exit(&mut e).unwrap();
    assert_eq!(e.w.d.env.account(&protocol()).unwrap().lamports - protocol_before, 600_000_000, "1.5 * 1 SOL * 40%");
    assert_eq!(e.w.d.env.token_balance(&e.user_solv3), AMOUNT);
    assert_eq!(protocol_u64(&e, 88), 0);
}

#[test]
fn partial_exit_keeps_every_exit_gate_and_cannot_empty_the_lock() {
    let mut e = setup();
    set_price(&mut e, PRICE);
    roll_to(&mut e, 3);
    assert!(partial_exit(&mut e, 1).unwrap_err().has("ExitDisabled"));
    roll_to(&mut e, 4);

    assert!(partial_exit(&mut e, 0).unwrap_err().has("InvalidAmount"));
    assert!(partial_exit(&mut e, AMOUNT).unwrap_err().has("PartialExitMustLeaveRemainder"));
    assert!(partial_exit(&mut e, AMOUNT + 1).unwrap_err().has("PartialExitMustLeaveRemainder"));

    let idl = Idl::vesolve();
    let admin = e.w.admin;
    let pause = idl.ix(VESOLVE, "set_pauses", &[0, 0, 0, 0, 1, 0, 0], &[("admin", admin), ("protocol", protocol()), ("admin_config", admin_config())]);
    e.w.d.env.ok(&admin, &[pause]);
    assert!(partial_exit(&mut e, 1).unwrap_err().has("paused"));
    let unpause = idl.ix(VESOLVE, "set_pauses", &[0, 0, 0, 0, 0, 0, 0], &[("admin", admin), ("protocol", protocol()), ("admin_config", admin_config())]);
    e.w.d.env.ok(&admin, &[unpause]);

    // voted this epoch: blocked
    let mut l = e.w.d.env.account(&e.lock).unwrap();
    let at = 8 + 32 + 8 + 32 + 8 + 8 + 8;
    l.data[at..at + 8].copy_from_slice(&4u64.to_le_bytes());
    e.w.d.env.svm.set_account(e.lock, l).unwrap();
    assert!(partial_exit(&mut e, 1).unwrap_err().has("LockHasActiveVotes"));
    assert_eq!(e.w.d.env.token_balance(&e.user_solv3), 0);
    assert_eq!(lock_amount(&e), AMOUNT);
}

#[test]
fn tiny_exits_still_pay_at_least_one_lamport() {
    let mut e = setup();
    set_price(&mut e, 1); // 1 lamport per SOLV3
    roll_to(&mut e, 4);
    let protocol_before = e.w.d.env.account(&protocol()).unwrap().lamports;
    partial_exit(&mut e, 1).unwrap(); // one base unit would floor to 0 lamports
    assert_eq!(e.w.d.env.account(&protocol()).unwrap().lamports - protocol_before, 1);
    assert_eq!(e.w.d.env.token_balance(&e.user_solv3), 1);
}

#[test]
fn admin_changes_the_exit_fee_and_it_applies_from_the_next_epoch() {
    let mut e = setup();
    set_price(&mut e, PRICE);
    roll_to(&mut e, 4);
    let (admin, stranger) = (e.w.admin, unique());
    e.w.d.env.fund(&stranger);

    // only Admin, and never above 100%
    assert!(set_fee(&mut e, stranger, 1_000).unwrap_err().has("Unauthorized"));
    assert!(set_fee(&mut e, admin, 10_001).unwrap_err().has("InvalidExitFee"));

    // 40% -> 25%, scheduled in epoch 4: an exit in epoch 4 still pays 40%
    set_fee(&mut e, admin, 2_500).unwrap();
    let before = e.w.d.env.account(&protocol()).unwrap().lamports;
    partial_exit(&mut e, 500_000_000).unwrap();
    assert_eq!(e.w.d.env.account(&protocol()).unwrap().lamports - before, 200_000_000, "40% still in force this epoch");

    // epoch 5: 25% applies, so 0.5 SOLV3 costs 0.125 SOL
    roll_to(&mut e, 5);
    let before = e.w.d.env.account(&protocol()).unwrap().lamports;
    partial_exit(&mut e, 500_000_000).unwrap();
    assert_eq!(e.w.d.env.account(&protocol()).unwrap().lamports - before, 125_000_000);

    // a later change replaces nothing in force: schedule 0% in epoch 5, epoch 5 still pays 25%
    set_fee(&mut e, admin, 0).unwrap();
    let before = e.w.d.env.account(&protocol()).unwrap().lamports;
    partial_exit(&mut e, 100_000_000).unwrap();
    assert_eq!(e.w.d.env.account(&protocol()).unwrap().lamports - before, 25_000_000);
    roll_to(&mut e, 6);
    let before = e.w.d.env.account(&protocol()).unwrap().lamports;
    exit(&mut e).unwrap();
    assert_eq!(e.w.d.env.account(&protocol()).unwrap().lamports - before, 0, "0% from epoch 6");
}

#[test]
fn exit_fees_can_only_be_withdrawn_to_the_treasury() {
    let mut e = setup();
    set_price(&mut e, PRICE);
    roll_to(&mut e, 4);
    exit(&mut e).unwrap(); // 0.8 SOL of fees in the protocol account

    let (treasury, elsewhere) = (unique(), unique());
    // no Treasury set yet
    assert!(withdraw(&mut e, elsewhere, 1_000).unwrap_err().has("TreasuryNotSet"));

    let admin = e.w.admin;
    let set = e.w.idl.ix(
        VESOLVE,
        "set_treasury",
        &key_bytes(&treasury),
        &[("admin", admin), ("protocol", protocol()), ("admin_config", admin_config()), ("treasury_change", treasury_change()), ("system_program", pk(SYSTEM_PROGRAM))],
    );
    e.w.d.env.ok(&admin, &[set]);

    // any other destination, including the Admin wallet itself, is refused
    assert!(withdraw(&mut e, elsewhere, 1_000).unwrap_err().has("InvalidTreasury"));
    assert!(withdraw(&mut e, admin, 1_000).unwrap_err().has("InvalidTreasury"));

    let before = e.w.d.env.account(&treasury).map_or(0, |a| a.lamports);
    withdraw(&mut e, treasury, FEE).unwrap();
    assert_eq!(e.w.d.env.account(&treasury).unwrap().lamports - before, FEE);
    // and cannot take more than the fees held
    assert!(withdraw(&mut e, treasury, FEE).unwrap_err().has("InsufficientTreasuryBalance"));
}

fn price_ix(e: &Ex, who: Pubkey, price: u64) -> solana_instruction::Instruction {
    e.w.idl.ix(
        VESOLVE,
        "set_exit_price",
        &price.to_le_bytes(),
        &[("authority", who), ("protocol", protocol()), ("exit_config", e.exit_config), ("keeper_config", keeper_config()), ("system_program", pk(SYSTEM_PROGRAM))],
    )
}

/// L-3 (fixed): after the first price, the exit price moves at most 25% per update and at most once an hour,
/// whether the Admin or the price keeper sets it; nobody else can.
#[test]
fn l3_exit_price_moves_within_bounds_by_admin_or_keeper() {
    let mut e = setup();
    let admin = e.w.admin;
    let t = START + WEEK + 100;
    e.w.d.env.set_time(t);
    let keeper = unique();
    e.w.d.env.fund(&keeper);
    assert!(e.w.d.env.send(&keeper, &[price_ix(&e, keeper, PRICE)]).unwrap_err().has("Unauthorized"), "no keeper yet");
    let set_keeper = e.w.idl.ix(VESOLVE, "set_keeper", &key_bytes(&keeper), &[("admin", admin), ("protocol", protocol()), ("keeper_config", keeper_config())]);
    e.w.d.env.ok(&admin, &[set_keeper]);
    assert!(e.w.d.env.send(&keeper, &[price_ix(&e, keeper, PRICE)]).unwrap_err().has("Unauthorized"), "only the Admin sets the first price");
    set_price(&mut e, PRICE);

    e.w.d.env.set_time(t + 3_600);
    assert!(e.w.d.env.send(&admin, &[price_ix(&e, admin, PRICE * 13 / 10)]).unwrap_err().has("ExitPriceStepTooLarge"), "+30%");
    assert!(e.w.d.env.send(&keeper, &[price_ix(&e, keeper, PRICE * 7 / 10)]).unwrap_err().has("ExitPriceStepTooLarge"), "-30%");
    e.w.d.env.ok(&keeper, &[price_ix(&e, keeper, PRICE * 12 / 10)]);
    assert!(e.w.d.env.send(&admin, &[price_ix(&e, admin, PRICE * 12 / 10 + 1)]).unwrap_err().has("ExitPriceStepTooLarge"), "too soon");
    e.w.d.env.set_time(t + 2 * 3_600);
    e.w.d.env.ok(&admin, &[price_ix(&e, admin, PRICE)]);

    let stranger = unique();
    e.w.d.env.fund(&stranger);
    e.w.d.env.set_time(t + 3 * 3_600);
    assert!(e.w.d.env.send(&stranger, &[price_ix(&e, stranger, PRICE)]).unwrap_err().has("Unauthorized"));
}

/// L-2 (fixed): a full exit keeps the Lock record (emptied, NFT burned) so earlier rewards stay claimable, and an
/// emptied lock cannot be refilled or exited again.
#[test]
fn l2_an_exited_lock_stays_as_an_empty_record() {
    let mut e = setup();
    roll_to(&mut e, 4);
    set_price(&mut e, PRICE);
    exit(&mut e).expect("full exit");
    assert!(e.w.d.env.account(&e.lock).is_some_and(|a| a.lamports > 0), "the record stays");
    assert_eq!(lock_amount(&e), 0);

    e.w.d.env.set_token_account(&e.user_solv3, &e.w.solv3, &e.user, AMOUNT);
    let increase = e.w.idl.ix(
        VESOLVE,
        "increase_lock",
        &[LOCK_ID.to_le_bytes(), 1_000u64.to_le_bytes()].concat(),
        &[("user", e.user), ("protocol", protocol()), ("lock", e.lock), ("user_token_account", e.user_solv3), ("token_mint", e.w.solv3), ("protocol_token_account", e.protocol_solv3), ("token_program", pk(TOKEN_PROGRAM))],
    );
    let user = e.user;
    assert!(e.w.d.env.send(&user, &[increase]).unwrap_err().has("LockIsEmpty"));
    assert!(exit(&mut e).is_err(), "nothing left to exit");
    assert!(partial_exit(&mut e, 1).is_err());
}

/// M-1 (fixed): transferring a lock closes its Auto-Vote enrollment and voter choice (rent back to the seller),
/// so the buyer starts clean.
#[test]
fn m1_transfer_closes_the_sellers_auto_vote_records() {
    let mut e = setup();
    let enrollment = pda(VESOLVE, &[b"auto_vote", e.lock.as_ref()]);
    let delegate = pda(VESOLVE, &[b"auto_vote_delegate", e.lock.as_ref()]);
    for k in [enrollment, delegate] {
        e.w.d.env
            .svm
            .set_account(k, solana_account::Account { lamports: 2_000_000, data: vec![7u8; 89], owner: pk(VESOLVE), executable: false, rent_epoch: 0 })
            .unwrap();
    }
    let buyer = unique();
    let buyer_token = ata(&buyer, &e.ve_mint);
    let ve_mint = e.ve_mint;
    e.w.d.env.set_token_account(&buyer_token, &ve_mint, &buyer, 0);
    let seller_before = e.w.d.env.account(&e.user).unwrap().lamports;
    let ix = e.w.idl.ix(
        VESOLVE,
        "transfer_lock",
        &LOCK_ID.to_le_bytes(),
        &[
            ("user", e.user), ("protocol", protocol()), ("lock", e.lock), ("ve_mint", e.ve_mint), ("ve_token_account", e.ve_token),
            ("destination_token_account", buyer_token), ("destination", buyer), ("auto_vote_enrollment", enrollment), ("auto_vote_delegate", delegate),
            ("token_program", pk(TOKEN_PROGRAM)),
        ],
    );
    let user = e.user;
    e.w.d.env.ok(&user, &[ix]);
    for k in [enrollment, delegate] {
        assert!(e.w.d.env.account(&k).map_or(true, |a| a.lamports == 0), "closed");
    }
    assert!(e.w.d.env.account(&e.user).unwrap().lamports > seller_before, "rent back to the seller, less the fee");
    let owner = Pubkey::try_from(&e.w.d.env.account(&e.lock).unwrap().data[8..40]).unwrap();
    assert_eq!(owner, buyer);
}
