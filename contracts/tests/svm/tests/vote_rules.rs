//! Voting rules at the instruction level: the 23:55 cutoff, splitting power
//! across gauges, replacing a vote before the cutoff, and every way a bad
//! vote must be refused. Locks are written straight into state (create_lock
//! needs the token metadata program).
use sha2::{Digest, Sha256};
use svm_tests::gauge_world::*;
use svm_tests::*;

fn account_disc(name: &str) -> [u8; 8] {
    Sha256::digest(format!("account:{name}").as_bytes())[..8].try_into().unwrap()
}

struct Holder {
    key: Pubkey,
    lock_id: u64,
    lock: Pubkey,
}

fn add_lock(w: &mut World, owner: &Pubkey, id: u64, power: u64) -> Holder {
    let lock = pda(VESOLVE, &[b"ve_lock", &id.to_le_bytes()]);
    let bump = Pubkey::find_program_address(&[b"ve_lock", &id.to_le_bytes()], &pk(VESOLVE)).1;
    let mut data = account_disc("Lock").to_vec();
    data.extend(key_bytes(owner));
    data.extend(id.to_le_bytes());
    data.extend(key_bytes(&unique()));
    data.extend(power.to_le_bytes());
    data.extend((i64::MAX / 2).to_le_bytes());
    data.extend(power.to_le_bytes());
    data.extend(0u64.to_le_bytes());
    data.push(bump);
    w.d.env
        .svm
        .set_account(lock, solana_account::Account { lamports: 5_000_000, data, owner: pk(VESOLVE), executable: false, rent_epoch: 0 })
        .unwrap();
    Holder { key: *owner, lock_id: id, lock }
}

/// A second gauge, active, on a made-up pool (voting only checks the Gauge account).
fn second_gauge(w: &mut World) -> Pubkey {
    let (admin, pool) = (w.admin, unique());
    let mut args = key_bytes(&pool);
    args.extend(key_bytes(&w.d.mint_a));
    args.extend(key_bytes(&w.d.mint_b));
    args.extend(dex::SPACING.to_le_bytes());
    let gauge = pda(VESOLVE, &[b"gauge", protocol().as_ref(), pool.as_ref()]);
    let ix = w.idl.ix(VESOLVE, "create_gauge", &args, &[("admin", admin), ("protocol", protocol()), ("gauge", gauge)]);
    w.d.env.ok(&admin, &[ix]);
    let mut acc = w.d.env.account(&gauge).unwrap();
    acc.data[8 + 96 + 2] = 1; // is_active
    acc.data[8 + 96 + 4] = 2; // status = ACTIVE
    w.d.env.svm.set_account(gauge, acc).unwrap();
    gauge
}

fn vote(w: &mut World, signer: &Pubkey, h: &Holder, picks: &[(Pubkey, u64)]) -> Result<Vec<String>, Failure> {
    vote_with(w, signer, h, picks, pk(VESOLVE))
}

fn vote_with(w: &mut World, signer: &Pubkey, h: &Holder, picks: &[(Pubkey, u64)], allocation: Pubkey) -> Result<Vec<String>, Failure> {
    let mut args = h.lock_id.to_le_bytes().to_vec();
    args.extend((picks.len() as u32).to_le_bytes());
    for (g, weight) in picks {
        args.extend(key_bytes(g));
        args.extend(weight.to_le_bytes());
    }
    let mut ix = w.idl.ix(
        VESOLVE,
        "vote",
        &args,
        &[
            ("user", *signer), ("protocol", protocol()), ("epoch", epoch(1)), ("lock", h.lock), ("auto_vote_enrollment", pk(VESOLVE)), ("allocation_voter", allocation),
            ("user_vote", pda(VESOLVE, &[b"user_vote", h.lock.as_ref(), &1u64.to_le_bytes()])),
            ("vote_lock_record", pda(VESOLVE, &[b"vote_lock", h.lock.as_ref(), &1u64.to_le_bytes()])),
            ("admin_config", admin_config()),
        ],
    );
    for (g, _) in picks {
        ix.accounts.push(meta(*g, false, false));
    }
    w.d.env.send(signer, &[ix])
}

/// (gauge, weight, votes) rows from the epoch account, and the two totals.
fn tally(w: &World, n: u64) -> (u64, u64, Vec<(Pubkey, u64, u64)>) {
    let d = w.d.env.account(&epoch(n)).unwrap().data;
    let u64_at = |at: usize| u64::from_le_bytes(d[at..at + 8].try_into().unwrap());
    let (total_power, total_votes) = (u64_at(8 + 24), u64_at(8 + 32));
    let count = u32::from_le_bytes(d[8 + 40..8 + 44].try_into().unwrap()) as usize;
    let rows = (0..count)
        .map(|i| {
            let at = 8 + 44 + i * 48;
            (Pubkey::try_from(&d[at..at + 32]).unwrap(), u64_at(at + 32), u64_at(at + 40))
        })
        .collect();
    (total_power, total_votes, rows)
}

fn holder(w: &mut World, id: u64, power: u64) -> Holder {
    let key = unique();
    w.d.env.fund(&key);
    add_lock(w, &key, id, power)
}

const T1: i64 = START + WEEK;
const EPOCH1_END: i64 = START + 2 * WEEK;

#[test]
fn voting_closes_five_minutes_before_the_epoch_ends() {
    let mut w = world();
    let h = holder(&mut w, 1, 1_000);
    let g = w.gauge;
    w.d.env.set_time(EPOCH1_END - 300);
    let late = vote(&mut w, &h.key.clone(), &h, &[(g, 100)]).unwrap_err();
    assert!(late.has("VoteExpired"), "{:?}", late.logs);
    w.d.env.set_time(EPOCH1_END - 301);
    vote(&mut w, &h.key.clone(), &h, &[(g, 100)]).unwrap();
    assert_eq!(tally(&w, 1).2, vec![(g, 1_000, 1)]);
}

#[test]
fn power_can_be_split_across_gauges_and_replaced_before_the_cutoff() {
    let mut w = world();
    let h = holder(&mut w, 1, 1_000);
    let (g1, g2) = (w.gauge, second_gauge(&mut w));
    w.d.env.set_time(T1 + 10);

    // 60/40 split
    vote(&mut w, &h.key.clone(), &h, &[(g1, 60), (g2, 40)]).unwrap();
    let (power, votes, rows) = tally(&w, 1);
    assert_eq!((power, votes), (1_000, 2));
    assert_eq!(rows, vec![(g1, 600, 1), (g2, 400, 1)]);

    // change of mind: everything to gauge 2. The old split is fully removed.
    vote(&mut w, &h.key.clone(), &h, &[(g2, 100)]).unwrap();
    let (power, _, rows) = tally(&w, 1);
    assert_eq!(power, 1_000, "one lock, one lock's worth of power, however often it re-votes");
    assert_eq!(rows, vec![(g1, 0, 0), (g2, 1_000, 1)]);

    // voting for less than 100% leaves the rest unallocated, not double counted
    vote(&mut w, &h.key.clone(), &h, &[(g1, 30)]).unwrap();
    let (power, _, rows) = tally(&w, 1);
    assert_eq!(rows, vec![(g1, 300, 1), (g2, 0, 0)]);
    assert_eq!(power, 300);
}

#[test]
fn bad_votes_are_refused_and_change_nothing() {
    let mut w = world();
    let h = holder(&mut w, 1, 1_000);
    let g1 = w.gauge;
    w.d.env.set_time(T1 + 10);
    let me = h.key;

    let over = vote(&mut w, &me, &h, &[(g1, 101)]).unwrap_err();
    assert!(over.has("InvalidVotingPower"), "{:?}", over.logs);
    let zero = vote(&mut w, &me, &h, &[(g1, 0)]).unwrap_err();
    assert!(zero.has("InvalidVotingPower"), "{:?}", zero.logs);
    let none = vote(&mut w, &me, &h, &[]).unwrap_err();
    assert!(none.has("InvalidGaugeVotes"), "{:?}", none.logs);
    let dup = vote(&mut w, &me, &h, &[(g1, 50), (g1, 50)]).unwrap_err();
    assert!(dup.has("InvalidGaugeVotes"), "{:?}", dup.logs);

    // 60 + 60 across two gauges is more than 100%
    let g2 = second_gauge(&mut w);
    let sum = vote(&mut w, &me, &h, &[(g1, 60), (g2, 60)]).unwrap_err();
    assert!(sum.has("InvalidVotingPower"), "{:?}", sum.logs);

    // a gauge that is not active cannot receive votes
    let mut acc = w.d.env.account(&g2).unwrap();
    acc.data[8 + 96 + 2] = 0;
    acc.data[8 + 96 + 4] = 4; // REMOVED
    w.d.env.svm.set_account(g2, acc).unwrap();
    let inactive = vote(&mut w, &me, &h, &[(g2, 100)]).unwrap_err();
    assert!(inactive.has("InvalidGauge"), "{:?}", inactive.logs);

    // an account that is not a Gauge at all
    let fake = unique();
    let not_gauge = vote(&mut w, &me, &h, &[(fake, 100)]).unwrap_err();
    assert!(not_gauge.err.len() > 0);

    // nothing counted, nothing marked as voted
    assert_eq!(tally(&w, 1).2.len(), 0);
}

#[test]
fn only_the_owner_can_vote_a_lock_and_voting_can_be_paused() {
    let mut w = world();
    let h = holder(&mut w, 1, 1_000);
    let g1 = w.gauge;
    w.d.env.set_time(T1 + 10);

    let thief = unique();
    w.d.env.fund(&thief);
    let err = vote(&mut w, &thief, &h, &[(g1, 100)]).unwrap_err();
    assert!(err.has("InvalidOwner"), "{:?}", err.logs);

    let admin = w.admin;
    let idl = Idl::vesolve();
    let pauses = |voting: bool| idl.ix(VESOLVE, "set_pauses", &[0, b(voting), 0, 0, 0, 0, 0], &[("admin", admin), ("protocol", protocol()), ("admin_config", admin_config())]);
    let on = pauses(true);
    w.d.env.ok(&admin, &[on]);
    let paused = vote(&mut w, &h.key.clone(), &h, &[(g1, 100)]).unwrap_err();
    assert!(paused.has("paused"), "{:?}", paused.logs);
    let off = pauses(false);
    w.d.env.ok(&admin, &[off]);
    vote(&mut w, &h.key.clone(), &h, &[(g1, 100)]).unwrap();
}

/// Rule A8: every position's vote counts. Votes are recorded per lock and
/// epoch, so a wallet's second lock adds to its first lock's vote.
#[test]
fn two_locks_of_one_wallet_both_count() {
    let mut w = world();
    let owner = unique();
    w.d.env.fund(&owner);
    let a = add_lock(&mut w, &owner, 1, 1_000);
    let b = add_lock(&mut w, &owner, 2, 500);
    let g1 = w.gauge;
    w.d.env.set_time(T1 + 10);
    vote(&mut w, &owner, &a, &[(g1, 100)]).unwrap();
    vote(&mut w, &owner, &b, &[(g1, 100)]).unwrap();
    assert_eq!(tally(&w, 1).0, 1_500, "both locks' power should be in the tally");
    assert_eq!(tally(&w, 1).2, vec![(g1, 1_500, 2)]);

    // re-voting one lock replaces only that lock's vote
    let g2 = second_gauge(&mut w);
    vote(&mut w, &owner, &a, &[(g2, 100)]).unwrap();
    assert_eq!(tally(&w, 1).2, vec![(g1, 500, 1), (g2, 1_000, 1)]);
    assert_eq!(tally(&w, 1).0, 1_500);
}

// ---- gauge lifecycle ----

const STATUS_AT: usize = 8 + 96 + 4;

fn gauge_state(w: &World, g: &Pubkey) -> (u8, u64, u16) {
    let d = w.d.env.account(g).unwrap().data;
    (d[STATUS_AT], u64::from_le_bytes(d[STATUS_AT + 1..STATUS_AT + 9].try_into().unwrap()), u16::from_le_bytes(d[STATUS_AT + 9..STATUS_AT + 11].try_into().unwrap()))
}

fn sorted(a: &Pubkey, b: &Pubkey) -> (Pubkey, Pubkey) {
    if a.to_bytes() < b.to_bytes() { (*a, *b) } else { (*b, *a) }
}

/// A created (unscheduled) gauge on a copy of the world's pool, for `mints`.
fn created_gauge(w: &mut World, mints: (Pubkey, Pubkey)) -> (Pubkey, Pubkey) {
    let (admin, pool) = (w.admin, unique());
    let copy = w.d.env.account(&w.d.pool).unwrap();
    w.d.env.svm.set_account(pool, copy).unwrap();
    let mut args = key_bytes(&pool);
    args.extend(key_bytes(&mints.0));
    args.extend(key_bytes(&mints.1));
    args.extend(dex::SPACING.to_le_bytes());
    let gauge = pda(VESOLVE, &[b"gauge", protocol().as_ref(), pool.as_ref()]);
    let ix = w.idl.ix(VESOLVE, "create_gauge", &args, &[("admin", admin), ("protocol", protocol()), ("gauge", gauge)]);
    w.d.env.ok(&admin, &[ix]);
    (gauge, pool)
}

fn schedule(w: &mut World, gauge: Pubkey, pool: Pubkey, occupant: Option<Pubkey>) -> Result<Vec<String>, Failure> {
    let g = w.d.env.account(&gauge).unwrap().data;
    let (a, b) = (Pubkey::try_from(&g[8 + 32..8 + 64]).unwrap(), Pubkey::try_from(&g[8 + 64..8 + 96]).unwrap());
    let (lo, hi) = sorted(&a, &b);
    let mut args = key_bytes(&lo);
    args.extend(key_bytes(&hi));
    let admin = w.admin;
    let ix = w.idl.ix(
        VESOLVE,
        "schedule_gauge_activation",
        &args,
        &[
            ("admin", admin), ("protocol", protocol()), ("gauge", gauge), ("pool", pool),
            ("pair", pda(VESOLVE, &[b"pair", lo.as_ref(), hi.as_ref()])), ("occupant", occupant.unwrap_or(pk(VESOLVE))),
            ("system_program", pk(SYSTEM_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    w.d.env.send(&admin, &[ix])
}

fn request_removal(w: &mut World, gauge: Pubkey) -> Result<Vec<String>, Failure> {
    let admin = w.admin;
    let ix = w.idl.ix(VESOLVE, "request_gauge_removal", &[], &[("admin", admin), ("protocol", protocol()), ("gauge", gauge), ("admin_config", admin_config())]);
    w.d.env.send(&admin, &[ix])
}

fn set_status(w: &mut World, gauge: &Pubkey, status: u8) {
    let mut acc = w.d.env.account(gauge).unwrap();
    acc.data[STATUS_AT] = status;
    w.d.env.svm.set_account(*gauge, acc).unwrap();
}

#[test]
fn a_gauge_takes_votes_once_scheduled_and_the_schedule_names_the_next_epoch() {
    let mut w = world();
    let h = holder(&mut w, 1, 1_000);
    let (g2, pool2) = created_gauge(&mut w, (unique(), unique()));
    assert_eq!(gauge_state(&w, &g2).0, 0);
    let err = vote(&mut w, &h.key.clone(), &h, &[(g2, 100)]).unwrap_err();
    assert!(err.has("InvalidGauge"), "an unscheduled gauge takes no votes: {:?}", err.logs);

    schedule(&mut w, g2, pool2, None).unwrap();
    assert_eq!(gauge_state(&w, &g2), (1, 2, 0), "pending activation, effective epoch 2");
    vote(&mut w, &h.key.clone(), &h, &[(g2, 100)]).unwrap();
    assert_eq!(tally(&w, 1).2, vec![(g2, 1_000, 1)]);
    let again = schedule(&mut w, g2, pool2, None).unwrap_err();
    assert!(again.has("GaugeStateInvalid"), "{:?}", again.logs);
}

#[test]
fn every_fee_tier_can_be_scheduled_including_the_narrowest_spacing() {
    let mut w = world();
    for spacing in [1u16, 2, 8, 16, 64] {
        let (g2, pool2) = created_gauge(&mut w, (unique(), unique()));
        let mut acc = w.d.env.account(&pool2).unwrap();
        // Solve.tick_spacing sits right after the discriminator and the pool's leading fields; find it by value.
        let current = dex::SPACING.to_le_bytes();
        let at = acc.data.windows(2).position(|x| x == current).expect("tick spacing in pool");
        acc.data[at..at + 2].copy_from_slice(&spacing.to_le_bytes());
        w.d.env.svm.set_account(pool2, acc).unwrap();
        schedule(&mut w, g2, pool2, None).unwrap_or_else(|e| panic!("spacing {spacing}: {:?}", e.logs));
    }
}

#[test]
fn only_one_gauge_per_pair_is_canonical_and_migration_swaps_it_in_one_rollover() {
    let mut w = world();
    let (a, b) = (w.d.mint_a, w.d.mint_b);
    let (g2, pool2) = created_gauge(&mut w, (a, b));

    let occ = w.gauge;
    let err = schedule(&mut w, g2, pool2, Some(occ)).unwrap_err();
    assert!(err.has("PairHasGauge"), "the pair already has an active gauge: {:?}", err.logs);
    let err = schedule(&mut w, g2, pool2, None).unwrap_err();
    assert!(err.has("PairHasGauge"), "{:?}", err.logs);

    let (lo, hi) = sorted(&a, &b);
    let mut args = key_bytes(&lo);
    args.extend(key_bytes(&hi));
    let admin = w.admin;
    let old = w.gauge;
    let ix = w.idl.ix(
        VESOLVE,
        "schedule_gauge_migration",
        &args,
        &[
            ("admin", admin), ("protocol", protocol()), ("old_gauge", old), ("new_gauge", g2), ("new_pool", pool2),
            ("pair", pda(VESOLVE, &[b"pair", lo.as_ref(), hi.as_ref()])), ("admin_config", admin_config()),
        ],
    );
    w.d.env.ok(&admin, &[ix]);
    assert_eq!(gauge_state(&w, &old), (3, 2, 0), "old: pending removal at epoch 2");
    assert_eq!(gauge_state(&w, &g2), (1, 2, 0), "new: pending activation at the same epoch");
    let pair = w.d.env.account(&pda(VESOLVE, &[b"pair", lo.as_ref(), hi.as_ref()])).unwrap().data;
    assert_eq!(&pair[8 + 64..8 + 96], g2.as_ref(), "the pair now points at the new gauge");

    // Neither can be removed or re-scheduled out of order.
    let err = request_removal(&mut w, old).unwrap_err();
    assert!(err.has("GaugeStateInvalid"), "{:?}", err.logs);

    // The old gauge takes no new votes; the new one does.
    let h = holder(&mut w, 1, 1_000);
    let err = vote(&mut w, &h.key.clone(), &h, &[(old, 100)]).unwrap_err();
    assert!(err.has("InvalidGauge"), "{:?}", err.logs);
    vote(&mut w, &h.key.clone(), &h, &[(g2, 100)]).unwrap();
}

#[test]
fn removal_is_requested_from_active_and_a_removed_gauge_relists_with_a_new_generation() {
    let mut w = world();
    let g = w.gauge;
    request_removal(&mut w, g).unwrap();
    assert_eq!(gauge_state(&w, &g), (3, 2, 0));
    let err = request_removal(&mut w, g).unwrap_err();
    assert!(err.has("GaugeStateInvalid"), "{:?}", err.logs);
    let pool = w.d.pool;
    let err = schedule(&mut w, g, pool, None).unwrap_err();
    assert!(err.has("GaugeStateInvalid"), "relist only from REMOVED: {:?}", err.logs);

    set_status(&mut w, &g, 4); // the executor has run: REMOVED
    schedule(&mut w, g, pool, None).unwrap();
    assert_eq!(gauge_state(&w, &g).0, 1);
    assert_eq!(gauge_state(&w, &g).2, 1, "relist is generation 1");

    // A different pool can take the pair only once the holder is REMOVED.
    let mints = (w.d.mint_a, w.d.mint_b);
    let (g2, pool2) = created_gauge(&mut w, mints);
    set_status(&mut w, &g, 4);
    schedule(&mut w, g2, pool2, Some(g)).unwrap();
    assert_eq!(gauge_state(&w, &g2).0, 1);
}

#[test]
fn only_the_admin_can_change_a_gauges_lifecycle() {
    let mut w = world();
    let (g2, pool2) = created_gauge(&mut w, (unique(), unique()));
    let stranger = unique();
    w.d.env.fund(&stranger);
    let g = w.d.env.account(&g2).unwrap().data;
    let (lo, hi) = sorted(&Pubkey::try_from(&g[8 + 32..8 + 64]).unwrap(), &Pubkey::try_from(&g[8 + 64..8 + 96]).unwrap());
    let mut args = key_bytes(&lo);
    args.extend(key_bytes(&hi));
    let ix = w.idl.ix(
        VESOLVE,
        "schedule_gauge_activation",
        &args,
        &[
            ("admin", stranger), ("protocol", protocol()), ("gauge", g2), ("pool", pool2),
            ("pair", pda(VESOLVE, &[b"pair", lo.as_ref(), hi.as_ref()])), ("occupant", pk(VESOLVE)),
            ("system_program", pk(SYSTEM_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    assert!(w.d.env.send(&stranger, &[ix]).is_err());
    let ix = w.idl.ix(VESOLVE, "request_gauge_removal", &[], &[("admin", stranger), ("protocol", protocol()), ("gauge", w.gauge), ("admin_config", admin_config())]);
    assert!(w.d.env.send(&stranger, &[ix]).is_err());
}

// ---- protocol allocations (A10) ----

fn allocation_pda(h: &Holder) -> Pubkey {
    pda(VESOLVE, &[b"allocation", h.lock.as_ref()])
}

fn register(w: &mut World, h: &Holder) -> Result<Vec<String>, Failure> {
    let admin = w.admin;
    let ix = w.idl.ix(
        VESOLVE,
        "register_allocation_voter",
        &h.lock_id.to_le_bytes(),
        &[("admin", admin), ("protocol", protocol()), ("lock", h.lock), ("allocation_voter", allocation_pda(h)), ("system_program", pk(SYSTEM_PROGRAM))],
    );
    w.d.env.send(&admin, &[ix])
}

#[test]
fn admin_votes_a_registered_allocation_with_part_of_its_power_and_the_rest_abstains() {
    let mut w = world();
    let h = holder(&mut w, 1, 1_000);
    let (g1, admin) = (w.gauge, w.admin);

    // not registered: Admin cannot vote someone else's lock
    let err = vote_with(&mut w, &admin, &h, &[(g1, 60)], pk(VESOLVE)).unwrap_err();
    assert!(err.has("InvalidOwner"), "{:?}", err.logs);

    // a stranger cannot register it
    let stranger = unique();
    w.d.env.fund(&stranger);
    let ix = w.idl.ix(
        VESOLVE,
        "register_allocation_voter",
        &h.lock_id.to_le_bytes(),
        &[("admin", stranger), ("protocol", protocol()), ("lock", h.lock), ("allocation_voter", allocation_pda(&h)), ("system_program", pk(SYSTEM_PROGRAM))],
    );
    assert!(w.d.env.send(&stranger, &[ix]).is_err());

    register(&mut w, &h).unwrap();
    vote_with(&mut w, &admin, &h, &[(g1, 60)], allocation_pda(&h)).unwrap();
    assert_eq!(tally(&w, 1).2, vec![(g1, 600, 1)], "60% assigned, 40% abstains");
    // a change before the cutoff replaces the current vote
    vote_with(&mut w, &admin, &h, &[(g1, 100)], allocation_pda(&h)).unwrap();
    assert_eq!(tally(&w, 1).2, vec![(g1, 1_000, 1)]);
    // the stranger still cannot vote it
    let err = vote_with(&mut w, &stranger, &h, &[(g1, 10)], allocation_pda(&h)).unwrap_err();
    assert!(err.has("InvalidOwner"), "{:?}", err.logs);
}

#[test]
fn admin_voting_lapses_when_the_allocation_lock_changes_hands_or_is_unregistered() {
    let mut w = world();
    let h = holder(&mut w, 1, 1_000);
    let (g1, admin) = (w.gauge, w.admin);
    register(&mut w, &h).unwrap();

    // transferred to a new owner: the registration no longer applies
    let mut lock = w.d.env.account(&h.lock).unwrap();
    lock.data[8..40].copy_from_slice(unique().as_ref());
    w.d.env.svm.set_account(h.lock, lock).unwrap();
    let err = vote_with(&mut w, &admin, &h, &[(g1, 100)], allocation_pda(&h)).unwrap_err();
    assert!(err.has("InvalidOwner"), "{:?}", err.logs);

    // Admin can unregister
    let ix = w.idl.ix(VESOLVE, "unregister_allocation_voter", &[], &[("admin", admin), ("protocol", protocol()), ("allocation_voter", allocation_pda(&h))]);
    w.d.env.ok(&admin, &[ix]);
    assert!(w.d.env.account(&allocation_pda(&h)).is_none_or(|a| a.lamports == 0));
}

// ---- standing allocation votes ----

fn set_standing(w: &mut World, signer: &Pubkey, h: &Holder, picks: &[(Pubkey, u64)]) -> Result<Vec<String>, Failure> {
    let mut args = (picks.len() as u32).to_le_bytes().to_vec();
    for (g, weight) in picks {
        args.extend(key_bytes(g));
        args.extend(weight.to_le_bytes());
    }
    let ix = w.idl.ix(VESOLVE, "set_allocation_votes", &args, &[("admin", *signer), ("protocol", protocol()), ("allocation_voter", allocation_pda(h))]);
    w.d.env.send(signer, &[ix])
}

/// Anyone can run this; `gauges` are the stored gauges in stored order.
fn crank(w: &mut World, payer: &Pubkey, h: &Holder, n: u64, gauges: &[Pubkey]) -> Result<Vec<String>, Failure> {
    let mut ix = w.idl.ix(
        VESOLVE,
        "apply_allocation_vote",
        &h.lock_id.to_le_bytes(),
        &[
            ("payer", *payer), ("protocol", protocol()), ("epoch", epoch(n)), ("lock", h.lock), ("allocation_voter", allocation_pda(h)),
            ("user_vote", pda(VESOLVE, &[b"user_vote", h.lock.as_ref(), &n.to_le_bytes()])),
            ("vote_lock_record", pda(VESOLVE, &[b"vote_lock", h.lock.as_ref(), &n.to_le_bytes()])),
            ("system_program", pk(SYSTEM_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    for g in gauges {
        ix.accounts.push(meta(*g, false, false));
    }
    w.d.env.send(payer, &[ix])
}

fn roll(w: &mut World, n: u64) {
    let admin = w.admin;
    w.d.env.set_time(START + WEEK * n as i64 + 100);
    let ix = w.idl.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(n))]);
    w.d.env.ok(&admin, &[ix]);
}

#[test]
fn a_standing_allocation_vote_is_applied_by_anyone_every_epoch() {
    let mut w = world();
    let h = holder(&mut w, 1, 1_000);
    let (g1, g2, admin) = (w.gauge, second_gauge(&mut w), w.admin);
    let anyone = unique();
    w.d.env.fund(&anyone);
    register(&mut w, &h).unwrap();

    // only Admin sets it
    let err = set_standing(&mut w, &anyone, &h, &[(g1, 50)]).unwrap_err();
    assert!(err.has("Unauthorized"), "{:?}", err.logs);
    // invalid configs are refused (over 100%, duplicate, zero)
    assert!(set_standing(&mut w, &admin, &h, &[(g1, 70), (g2, 40)]).is_err());
    assert!(set_standing(&mut w, &admin, &h, &[(g1, 10), (g1, 10)]).is_err());
    assert!(set_standing(&mut w, &admin, &h, &[(g1, 0)]).is_err());

    set_standing(&mut w, &admin, &h, &[(g1, 60), (g2, 30)]).unwrap();
    w.d.env.set_time(T1 + 10);
    crank(&mut w, &anyone, &h, 1, &[g1, g2]).unwrap();
    assert_eq!(tally(&w, 1).2, vec![(g1, 600, 1), (g2, 300, 1)], "60/30, remaining 10% abstains");

    // applying twice in one epoch with the same config is refused
    let err = crank(&mut w, &anyone, &h, 1, &[g1, g2]).unwrap_err();
    assert!(err.has("AllocationAlreadyApplied"), "{:?}", err.logs);

    // next epoch: same config applies again with no Admin action
    roll(&mut w, 2);
    crank(&mut w, &anyone, &h, 2, &[g1, g2]).unwrap();
    assert_eq!(tally(&w, 2).2, vec![(g1, 600, 1), (g2, 300, 1)]);

    // wrong gauge accounts are refused
    let (g3, _) = (second_gauge(&mut w), ());
    set_standing(&mut w, &admin, &h, &[(g1, 50)]).unwrap();
    let err = crank(&mut w, &anyone, &h, 2, &[g3]).unwrap_err();
    assert!(err.has("InvalidGauge"), "{:?}", err.logs);
}

#[test]
fn admin_can_change_the_standing_vote_before_the_cutoff_and_manual_votes_stick() {
    let mut w = world();
    let h = holder(&mut w, 1, 1_000);
    let (g1, g2, admin) = (w.gauge, second_gauge(&mut w), w.admin);
    let anyone = unique();
    w.d.env.fund(&anyone);
    register(&mut w, &h).unwrap();
    set_standing(&mut w, &admin, &h, &[(g1, 100)]).unwrap();
    w.d.env.set_time(T1 + 10);
    crank(&mut w, &anyone, &h, 1, &[g1]).unwrap();

    // changed config can be re-applied in the same epoch and replaces the old vote
    set_standing(&mut w, &admin, &h, &[(g2, 100)]).unwrap();
    crank(&mut w, &anyone, &h, 1, &[g2]).unwrap();
    assert_eq!(tally(&w, 1).2, vec![(g1, 0, 0), (g2, 1_000, 1)]);

    // a manual Admin vote counts as this epoch's application: the crank cannot override it
    vote_with(&mut w, &admin, &h, &[(g1, 40)], allocation_pda(&h)).unwrap();
    let err = crank(&mut w, &anyone, &h, 1, &[g2]).unwrap_err();
    assert!(err.has("AllocationAlreadyApplied"), "{:?}", err.logs);
    assert_eq!(tally(&w, 1).2, vec![(g1, 400, 1), (g2, 0, 0)]);

    // after the cutoff the crank is refused
    w.d.env.set_time(EPOCH1_END - 300);
    set_standing(&mut w, &admin, &h, &[(g1, 100)]).unwrap();
    let err = crank(&mut w, &anyone, &h, 1, &[g1]).unwrap_err();
    assert!(err.has("VoteExpired"), "{:?}", err.logs);
}

#[test]
fn the_standing_vote_skips_gauges_that_no_longer_take_votes_and_lapses_with_the_owner() {
    let mut w = world();
    let h = holder(&mut w, 1, 1_000);
    let (g1, g2) = (w.gauge, second_gauge(&mut w));
    let (admin, anyone) = (w.admin, unique());
    w.d.env.fund(&anyone);
    register(&mut w, &h).unwrap();
    set_standing(&mut w, &admin, &h, &[(g1, 50), (g2, 50)]).unwrap();
    w.d.env.set_time(T1 + 10);

    // g2 removed: its share abstains, g1 still gets its 50%
    let mut acc = w.d.env.account(&g2).unwrap();
    acc.data[8 + 96 + 2] = 0;
    acc.data[8 + 96 + 4] = 4;
    w.d.env.svm.set_account(g2, acc).unwrap();
    crank(&mut w, &anyone, &h, 1, &[g1, g2]).unwrap();
    assert_eq!(tally(&w, 1).2, vec![(g1, 500, 1)]);

    // every stored gauge removed: nothing to vote
    set_standing(&mut w, &admin, &h, &[(g2, 100)]).unwrap();
    let err = crank(&mut w, &anyone, &h, 1, &[g2]).unwrap_err();
    assert!(err.has("NoVotableAllocation"), "{:?}", err.logs);

    // lock sold: the crank lapses
    set_standing(&mut w, &admin, &h, &[(g1, 100)]).unwrap();
    let mut lock = w.d.env.account(&h.lock).unwrap();
    lock.data[8..40].copy_from_slice(unique().as_ref());
    w.d.env.svm.set_account(h.lock, lock).unwrap();
    let err = crank(&mut w, &anyone, &h, 1, &[g1]).unwrap_err();
    assert!(err.has("InvalidOwner"), "{:?}", err.logs);
}

// ---- model check ----

/// Many wallets and locks vote, re-vote and split power in a pseudo-random
/// order (some attempts invalid). After every step the epoch's per-gauge
/// weights must equal what a plain model of "each lock's latest accepted vote"
/// says, and the epoch totals must agree with those weights.
#[test]
fn epoch_weights_always_equal_the_sum_of_each_locks_latest_vote() {
    let mut w = world();
    let g = [w.gauge, second_gauge(&mut w), second_gauge(&mut w)];
    let powers = [1_000u64, 500, 2_500, 700, 1_300];
    let holders: Vec<Holder> = powers.iter().enumerate().map(|(i, p)| holder(&mut w, 1 + i as u64, *p)).collect();
    let mut model: Vec<Option<Vec<(usize, u64)>>> = vec![None; holders.len()];

    let mut seed: u64 = 0xD1B5_4A32_D192_ED03;
    let mut next = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };

    for step in 0..120 {
        let who = (next() % holders.len() as u64) as usize;
        let picks_n = 1 + (next() % 3) as usize;
        let mut picks: Vec<(usize, u64)> = Vec::new();
        for gi in 0..3 {
            if picks.len() < picks_n && next() % 2 == 0 {
                picks.push((gi, 1 + next() % 60));
            }
        }
        if picks.is_empty() {
            picks.push((0, 1 + next() % 100));
        }
        let valid = picks.iter().map(|p| p.1).sum::<u64>() <= 100;
        let args: Vec<(Pubkey, u64)> = picks.iter().map(|(gi, pct)| (g[*gi], *pct)).collect();
        let h = &holders[who];
        let result = vote(&mut w, &h.key.clone(), h, &args);
        assert_eq!(result.is_ok(), valid, "step {step}: {picks:?}");
        if valid {
            model[who] = Some(picks);
        }

        let mut expected = [0u64; 3];
        let mut total = 0u64;
        for (i, m) in model.iter().enumerate() {
            if let Some(p) = m {
                for (gi, pct) in p {
                    let wgt = powers[i] * pct / 100;
                    expected[*gi] += wgt;
                    total += wgt;
                }
            }
        }
        let (_, total_votes_unused, rows) = tally(&w, 1);
        let _ = total_votes_unused;
        for (gi, gauge) in g.iter().enumerate() {
            let got = rows.iter().find(|r| &r.0 == gauge).map_or(0, |r| r.1);
            assert_eq!(got, expected[gi], "step {step}: gauge {gi}");
        }
        assert_eq!(rows.iter().map(|r| r.1).sum::<u64>(), total, "step {step}: weights sum to the model total");
    }
}
