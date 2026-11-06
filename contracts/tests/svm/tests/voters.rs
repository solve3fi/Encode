//! The voter side of the money: real votes, then trading fees and bribes
//! claimed pro rata by vote weight, once, and never while claims are paused.
//! Locks are written straight into account state (create_lock needs the token
//! metadata program, which is not what these tests are about).
use sha2::{Digest, Sha256};
use svm_tests::gauge_world::*;
use svm_tests::*;

struct Voter {
    key: Pubkey,
    lock_id: u64,
    lock: Pubkey,
    power: u64,
    token_a: Pubkey,
    token_b: Pubkey,
    token_bribe: Pubkey,
}

fn account_disc(name: &str) -> [u8; 8] {
    Sha256::digest(format!("account:{name}").as_bytes())[..8].try_into().unwrap()
}

fn add_voter(w: &mut World, id: u64, power: u64, bribe_mint: &Pubkey) -> Voter {
    let key = unique();
    w.d.env.fund(&key);
    let lock = pda(VESOLVE, &[b"ve_lock", &id.to_le_bytes()]);
    let bump = Pubkey::find_program_address(&[b"ve_lock", &id.to_le_bytes()], &pk(VESOLVE)).1;
    let mut data = account_disc("Lock").to_vec();
    data.extend(key_bytes(&key));
    data.extend(id.to_le_bytes());
    data.extend(key_bytes(&unique())); // ve_mint (unused by vote and claims)
    data.extend(power.to_le_bytes()); // amount = voting power
    data.extend((i64::MAX / 2).to_le_bytes()); // unlock_time
    data.extend(power.to_le_bytes()); // voting_power
    data.extend(0u64.to_le_bytes()); // last_vote_epoch
    data.push(bump);
    w.d.env
        .svm
        .set_account(lock, solana_account::Account { lamports: 5_000_000, data, owner: pk(VESOLVE), executable: false, rent_epoch: 0 })
        .unwrap();
    let (token_a, token_b) = (unique(), unique());
    let token_bribe = ata(&key, bribe_mint);
    let (ma, mb) = (w.d.mint_a, w.d.mint_b);
    w.d.env.set_token_account(&token_a, &ma, &key, 0);
    w.d.env.set_token_account(&token_b, &mb, &key, 0);
    w.d.env.set_token_account(&ata(&key, bribe_mint), bribe_mint, &key, 0);
    Voter { key, lock_id: id, lock, power, token_a, token_b, token_bribe }
}

fn user_vote(v: &Voter, epoch_no: u64) -> Pubkey {
    pda(VESOLVE, &[b"user_vote", v.lock.as_ref(), &epoch_no.to_le_bytes()])
}
fn vote_record(v: &Voter, epoch_no: u64) -> Pubkey {
    pda(VESOLVE, &[b"vote_lock", v.lock.as_ref(), &epoch_no.to_le_bytes()])
}

fn cast_vote(w: &mut World, v: &Voter) {
    let mut args = v.lock_id.to_le_bytes().to_vec();
    args.extend(1u32.to_le_bytes());
    args.extend(key_bytes(&w.gauge));
    args.extend(100u64.to_le_bytes()); // 100% of the lock's power
    let mut ix = w.idl.ix(
        VESOLVE,
        "vote",
        &args,
        &[
            ("user", v.key), ("protocol", protocol()), ("epoch", epoch(1)), ("lock", v.lock), ("allocation_voter", pk(VESOLVE)), ("auto_vote_enrollment", pk(VESOLVE)),
            ("user_vote", user_vote(v, 1)), ("vote_lock_record", vote_record(v, 1)), ("admin_config", admin_config()),
        ],
    );
    ix.accounts.push(meta(w.gauge, false, false)); // the gauge being voted for
    w.d.env.ok(&v.key, &[ix]);
}

/// Settles a removal-due gauge's owed protocol fees to the Treasury with settle_removed_gauge_fees (what Admin
/// "Complete removal" sends when the gauge has no votes to route them to, DEV-10/DEV-17). Returns the amounts.
fn collect_to_treasury(w: &mut World, admin: Pubkey) -> (u64, u64) {
    let pool = w.d.env.account(&w.d.pool).unwrap().data;
    let owed = |at: usize| u64::from_le_bytes(pool[at..at + 8].try_into().unwrap());
    if owed(85) == 0 && owed(93) == 0 {
        return (0, 0); // nothing owed: the settle instruction refuses an empty collection
    }
    let treasury = treasury_of(&mut w.d, &w.idl, &admin);
    let (ma, mb) = (w.d.mint_a, w.d.mint_b);
    let bal = |w: &World, k: &Pubkey| w.d.env.account(k).map_or(0, |a| u64::from_le_bytes(a.data[64..72].try_into().unwrap()));
    let (before_a, before_b) = (bal(w, &ata(&treasury, &ma)), bal(w, &ata(&treasury, &mb)));
    let caller = unique();
    w.d.env.fund(&caller);
    let ix = settle_removed_ix(&w.idl, &w.d, caller, w.gauge, treasury);
    w.d.env.ok(&caller, &[ix]);
    (w.d.env.token_balance(&ata(&treasury, &ma)) - before_a, w.d.env.token_balance(&ata(&treasury, &mb)) - before_b)
}

fn claim_pool(w: &mut World, v: &Voter, vault: &Pubkey) -> Result<Vec<String>, Failure> {
    claim_pool_sides(w, v, vault, 3)
}

fn claim_pool_sides(w: &mut World, v: &Voter, vault: &Pubkey, sides: u8) -> Result<Vec<String>, Failure> {
    claim_pool_with(w, v, vault, sides, None)
}

/// `partner` is the optional PartnerVoter PDA a claim may pass as its first remaining account.
fn claim_pool_with(w: &mut World, v: &Voter, vault: &Pubkey, sides: u8, partner: Option<Pubkey>) -> Result<Vec<String>, Failure> {
    let epoch1 = epoch(1);
    let mut args = v.lock_id.to_le_bytes().to_vec();
    args.push(sides);
    let (ma, mb) = (w.d.mint_a, w.d.mint_b);
    let mut ix = w.idl.ix(
        VESOLVE,
        "claim_pool_reward",
        &args,
        &[
            ("user", v.key), ("protocol", protocol()), ("lock", v.lock),
            ("auto_vote_enrollment", pda(VESOLVE, &[b"auto_vote", v.lock.as_ref()])),
            ("gauge", w.gauge), ("epoch", epoch1), ("vault", *vault),
            ("token_mint_a", ma), ("user_token_account_a", v.token_a), ("vault_token_account_a", ata(vault, &ma)),
            ("token_mint_b", mb), ("user_token_account_b", v.token_b), ("vault_token_account_b", ata(vault, &mb)),
            ("treasury_token_account_a", ata(&protocol(), &ma)), ("treasury_token_account_b", ata(&protocol(), &mb)),
            ("user_rewards", pda(VESOLVE, &[b"user_pool_rewards", v.lock.as_ref(), epoch1.as_ref(), w.gauge.as_ref()])),
            ("user_vote", user_vote(v, 1)), ("vote_lock_record", vote_record(v, 1)),
            ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    if let Some(p) = partner {
        ix.accounts.push(meta(p, false, false));
    }
    w.d.env.send(&v.key, &[ix])
}

fn claim_bribe(w: &mut World, v: &Voter, vault: &Pubkey, mint: &Pubkey) -> Result<Vec<String>, Failure> {
    claim_bribe_with(w, v, vault, mint, None)
}

fn claim_bribe_with(w: &mut World, v: &Voter, vault: &Pubkey, mint: &Pubkey, partner: Option<Pubkey>) -> Result<Vec<String>, Failure> {
    let epoch1 = epoch(1);
    let mut ix = w.idl.ix(
        VESOLVE,
        "claim_bribe_reward",
        &v.lock_id.to_le_bytes(),
        &[
            ("user", v.key), ("protocol", protocol()), ("lock", v.lock),
            ("auto_vote_enrollment", pda(VESOLVE, &[b"auto_vote", v.lock.as_ref()])),
            ("gauge", w.gauge), ("epoch", epoch1), ("vault", *vault), ("token_mint", *mint),
            ("bribe_token", pda(VESOLVE, &[b"bribe_token", mint.as_ref()])),
            ("user_token_account", ata(&v.key, mint)), ("bribe_vault_token_account", ata(vault, mint)),
            ("treasury_token_account", ata(&protocol(), mint)),
            ("user_rewards", pda(VESOLVE, &[b"user_bribe_rewards", v.lock.as_ref(), epoch1.as_ref(), w.gauge.as_ref(), mint.as_ref()])),
            ("user_vote", user_vote(v, 1)), ("vote_lock_record", vote_record(v, 1)),
            ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    if let Some(p) = partner {
        ix.accounts.push(meta(p, false, false));
    }
    w.d.env.send(&v.key, &[ix])
}

#[test]
fn voters_split_fees_and_bribes_by_vote_weight_exactly_once() {
    let mut w = world();
    let (admin, owner, t1) = (w.admin, w.d.owner, START + WEEK);

    // a whitelisted bribe token and a briber
    let (bribe_mint, briber) = (unique(), unique());
    w.d.env.fund(&briber);
    w.d.env.set_mint(&bribe_mint, &briber, 6);
    let briber_tokens = ata(&briber, &bribe_mint);
    w.d.env.set_token_account(&briber_tokens, &bribe_mint, &briber, 10_000_000);
    let bribe_token = pda(VESOLVE, &[b"bribe_token", bribe_mint.as_ref()]);
    let allow = w.idl.ix(VESOLVE, "set_bribe_token", &[1, 0], &[("admin", admin), ("protocol", protocol()), ("token_mint", bribe_mint), ("bribe_token", bribe_token)]);
    w.d.env.ok(&admin, &[allow]);

    // X holds 3x Y's voting power; both vote 100% for the gauge in epoch 1
    let x = add_voter(&mut w, 101, 3_000, &bribe_mint);
    let y = add_voter(&mut w, 102, 1_000, &bribe_mint);
    w.d.env.set_time(t1 + 10);
    cast_vote(&mut w, &x);
    cast_vote(&mut w, &y);

    // trading in epoch 1 builds protocol-side fees, which go to the voters' vault
    for i in 0..20 {
        w.d.env.set_time(t1 + 100 + i);
        let s = w.d.swap_ix(10_000_000, i % 2 == 0);
        w.d.env.ok(&owner, &[s]);
    }
    let pool = w.d.env.account(&w.d.pool).unwrap().data;
    let (fee_a, fee_b) = (u64::from_le_bytes(pool[85..93].try_into().unwrap()), u64::from_le_bytes(pool[93..101].try_into().unwrap()));
    assert!(fee_a > 0 && fee_b > 0);
    let vault = pda(VESOLVE, &[b"vault", &1u64.to_le_bytes(), w.gauge.as_ref()]);
    let route = w.idl.ix(
        VESOLVE,
        "route_pool_fees",
        &1u64.to_le_bytes(),
        &[
            ("epoch", epoch(1)),
            ("caller", admin), ("protocol", protocol()), ("gauge", w.gauge), ("solves_config", w.d.config), ("pool", w.d.pool), ("vault", vault),
            ("token_mint_a", w.d.mint_a), ("token_mint_b", w.d.mint_b), ("token_vault_a", w.d.vault_a), ("token_vault_b", w.d.vault_b),
            ("vault_token_account_a", ata(&vault, &w.d.mint_a)), ("vault_token_account_b", ata(&vault, &w.d.mint_b)),
            ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
        ],
    );
    w.d.env.ok(&admin, &[route]);
    assert_eq!(w.d.env.token_balance(&ata(&vault, &w.d.mint_a)), fee_a);
    assert_eq!(w.d.env.token_balance(&ata(&vault, &w.d.mint_b)), fee_b);

    // a bribe on the same gauge in the same epoch
    let bribe_amount = 4_000_000u64;
    let create = w.idl.ix(
        VESOLVE,
        "create_bribe",
        &bribe_amount.to_le_bytes(),
        &[
            ("user", briber), ("protocol", protocol()), ("epoch", epoch(1)), ("gauge", w.gauge), ("vault", vault), ("token_mint", bribe_mint),
            ("bribe_token", bribe_token), ("bribe", pda(VESOLVE, &[b"bribe", w.gauge.as_ref(), bribe_mint.as_ref(), briber.as_ref()])),
            ("user_token_account", briber_tokens), ("bribe_token_account", ata(&vault, &bribe_mint)),
            ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    w.d.env.ok(&briber, &[create]);

    // too early: voting rewards unlock when the next epoch begins, not while the voting epoch is still running
    let early = claim_bribe(&mut w, &x, &vault, &bribe_mint).unwrap_err();
    assert!(early.has("VotingRewardsNotClaimableYet"), "{:?}", early.logs);
    w.d.env.set_time(t1 + WEEK + 100);
    let roll = w.idl.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(2))]);
    w.d.env.ok(&admin, &[roll]);
    w.d.env.set_time(t1 + 2 * WEEK + 100);
    let roll = w.idl.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(3))]);
    w.d.env.ok(&admin, &[roll]);

    // claims paused: nobody can claim, and nothing moves
    let idl = Idl::vesolve();
    let pauses = |claims: bool| idl.ix(VESOLVE, "set_pauses", &[0, 0, 0, b(claims), 0, 0, 0], &[("admin", admin), ("protocol", protocol()), ("admin_config", admin_config())]);
    let on = pauses(true);
    w.d.env.ok(&admin, &[on]);
    let paused_err = claim_pool(&mut w, &x, &vault).unwrap_err();
    eprintln!("PAUSED CLAIM: {:?}", paused_err.logs);
    assert!(paused_err.has("paused"));
    assert!(claim_bribe(&mut w, &x, &vault, &bribe_mint).unwrap_err().has("paused"));
    assert_eq!(w.d.env.token_balance(&x.token_a), 0);
    let off = pauses(false);
    w.d.env.ok(&admin, &[off]);

    // trading fees: 3/4 and 1/4, floored, claimed once
    let total = x.power + y.power;
    claim_pool(&mut w, &x, &vault).unwrap();
    claim_pool(&mut w, &y, &vault).unwrap();
    let share = |amount: u64, p: u64| (amount as u128 * p as u128 / total as u128) as u64;
    assert_eq!(w.d.env.token_balance(&x.token_a), share(fee_a, x.power));
    assert_eq!(w.d.env.token_balance(&y.token_a), share(fee_a, y.power));
    assert_eq!(w.d.env.token_balance(&x.token_b), share(fee_b, x.power));
    assert_eq!(w.d.env.token_balance(&y.token_b), share(fee_b, y.power));
    let left_a = w.d.env.token_balance(&ata(&vault, &w.d.mint_a));
    let left_b = w.d.env.token_balance(&ata(&vault, &w.d.mint_b));
    assert!(left_a <= 1 && left_b <= 1, "only rounding dust stays in the vault: {left_a} {left_b}");
    assert_eq!(w.d.env.token_balance(&x.token_a) + w.d.env.token_balance(&y.token_a) + left_a, fee_a, "no fee created or lost");
    let again = claim_pool(&mut w, &x, &vault).unwrap_err();
    assert!(again.has("AlreadyClaimed") || again.has("already"), "{:?}", again.logs);

    // bribes: the same split, once
    claim_bribe(&mut w, &x, &vault, &bribe_mint).unwrap();
    // y never held the bribe token: the claim creates their account on the spot
    w.d.env.svm.set_account(y.token_bribe, solana_account::Account::default()).unwrap();
    assert!(w.d.env.account(&y.token_bribe).is_none());
    claim_bribe(&mut w, &y, &vault, &bribe_mint).unwrap();
    assert_eq!(w.d.env.token_balance(&x.token_bribe), share(bribe_amount, x.power));
    assert_eq!(w.d.env.token_balance(&y.token_bribe), share(bribe_amount, y.power));
    let left = w.d.env.token_balance(&ata(&vault, &bribe_mint));
    assert!(left <= 1 && w.d.env.token_balance(&x.token_bribe) + w.d.env.token_balance(&y.token_bribe) + left == bribe_amount);
    assert!(claim_bribe(&mut w, &y, &vault, &bribe_mint).is_err(), "no second bribe claim");
}

#[test]
fn auto_vote_enrolled_lock_pays_fifteen_percent_of_fees_and_bribes_to_the_treasury() {
    let mut w = world();
    let (admin, owner, t1) = (w.admin, w.d.owner, START + WEEK);

    let (bribe_mint, briber) = (unique(), unique());
    w.d.env.fund(&briber);
    w.d.env.set_mint(&bribe_mint, &briber, 6);
    let briber_tokens = ata(&briber, &bribe_mint);
    w.d.env.set_token_account(&briber_tokens, &bribe_mint, &briber, 10_000_000);
    let bribe_token = pda(VESOLVE, &[b"bribe_token", bribe_mint.as_ref()]);
    let allow = w.idl.ix(VESOLVE, "set_bribe_token", &[1, 0], &[("admin", admin), ("protocol", protocol()), ("token_mint", bribe_mint), ("bribe_token", bribe_token)]);
    w.d.env.ok(&admin, &[allow]);

    // z is enrolled in Auto-Vote (the enrollment account exists and is owned by vesolve); x is not
    let x = add_voter(&mut w, 201, 1_000, &bribe_mint);
    let z = add_voter(&mut w, 202, 3_000, &bribe_mint);
    let enrollment = pda(VESOLVE, &[b"auto_vote", z.lock.as_ref()]);
    let mut edata = account_disc("AutoVoteEnrollment").to_vec();
    edata.extend(key_bytes(&z.lock));
    edata.extend(key_bytes(&z.key));
    edata.extend(0i64.to_le_bytes());
    edata.push(0);
    w.d.env
        .svm
        .set_account(enrollment, solana_account::Account { lamports: 2_000_000, data: edata, owner: pk(VESOLVE), executable: false, rent_epoch: 0 })
        .unwrap();

    w.d.env.set_time(t1 + 10);
    cast_vote(&mut w, &x);
    // The fee follows who cast the vote (review M-3): the Solve3 keeper votes z's enrolled lock.
    keeper_vote(&mut w, &z, true).expect("the keeper votes the enrolled lock");
    // z's owner then leaves Auto-Vote before claiming: the fee is fixed at vote time and still applies (review M-3).
    w.d.env.svm.set_account(enrollment, solana_account::Account { lamports: 0, data: vec![], owner: pk(SYSTEM_PROGRAM), executable: false, rent_epoch: 0 }).unwrap();

    for i in 0..20 {
        w.d.env.set_time(t1 + 100 + i);
        let s = w.d.swap_ix(10_000_000, i % 2 == 0);
        w.d.env.ok(&owner, &[s]);
    }
    let pool = w.d.env.account(&w.d.pool).unwrap().data;
    let (fee_a, fee_b) = (u64::from_le_bytes(pool[85..93].try_into().unwrap()), u64::from_le_bytes(pool[93..101].try_into().unwrap()));
    let vault = pda(VESOLVE, &[b"vault", &1u64.to_le_bytes(), w.gauge.as_ref()]);
    let route = w.idl.ix(
        VESOLVE,
        "route_pool_fees",
        &1u64.to_le_bytes(),
        &[
            ("epoch", epoch(1)),
            ("caller", admin), ("protocol", protocol()), ("gauge", w.gauge), ("solves_config", w.d.config), ("pool", w.d.pool), ("vault", vault),
            ("token_mint_a", w.d.mint_a), ("token_mint_b", w.d.mint_b), ("token_vault_a", w.d.vault_a), ("token_vault_b", w.d.vault_b),
            ("vault_token_account_a", ata(&vault, &w.d.mint_a)), ("vault_token_account_b", ata(&vault, &w.d.mint_b)),
            ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
        ],
    );
    w.d.env.ok(&admin, &[route]);

    let bribe_amount = 4_000_000u64;
    let create = w.idl.ix(
        VESOLVE,
        "create_bribe",
        &bribe_amount.to_le_bytes(),
        &[
            ("user", briber), ("protocol", protocol()), ("epoch", epoch(1)), ("gauge", w.gauge), ("vault", vault), ("token_mint", bribe_mint),
            ("bribe_token", bribe_token), ("bribe", pda(VESOLVE, &[b"bribe", w.gauge.as_ref(), bribe_mint.as_ref(), briber.as_ref()])),
            ("user_token_account", briber_tokens), ("bribe_token_account", ata(&vault, &bribe_mint)),
            ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    w.d.env.ok(&briber, &[create]);

    for n in 2..=3u64 {
        w.d.env.set_time(t1 + (n as i64 - 1) * WEEK + 100);
        let roll = w.idl.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(n))]);
        w.d.env.ok(&admin, &[roll]);
    }

    let total = x.power + z.power;
    claim_pool(&mut w, &x, &vault).unwrap();
    claim_pool(&mut w, &z, &vault).unwrap();
    claim_bribe(&mut w, &x, &vault, &bribe_mint).unwrap();
    claim_bribe(&mut w, &z, &vault, &bribe_mint).unwrap();

    let share = |amount: u64, p: u64| (amount as u128 * p as u128 / total as u128) as u64;
    let cut = |amount: u64| (amount as u128 * 1_500 / 10_000) as u64; // AUTO_VOTE_FEE_BPS
    let (t_a, t_b, t_bribe) = (ata(&protocol(), &w.d.mint_a), ata(&protocol(), &w.d.mint_b), ata(&protocol(), &bribe_mint));

    // the unenrolled lock pays nothing
    assert_eq!(w.d.env.token_balance(&x.token_a), share(fee_a, x.power));
    assert_eq!(w.d.env.token_balance(&x.token_b), share(fee_b, x.power));
    assert_eq!(w.d.env.token_balance(&x.token_bribe), share(bribe_amount, x.power));

    // the enrolled lock keeps 85% and the treasury gets 15%, exactly, token by token
    let (za, zb, zbr) = (share(fee_a, z.power), share(fee_b, z.power), share(bribe_amount, z.power));
    assert_eq!(w.d.env.token_balance(&t_a), cut(za));
    assert_eq!(w.d.env.token_balance(&t_b), cut(zb));
    assert_eq!(w.d.env.token_balance(&t_bribe), cut(zbr));
    assert_eq!(w.d.env.token_balance(&z.token_a), za - cut(za));
    assert_eq!(w.d.env.token_balance(&z.token_b), zb - cut(zb));
    assert_eq!(w.d.env.token_balance(&z.token_bribe), zbr - cut(zbr));
    assert!(cut(za) > 0 && cut(zbr) > 0, "the cut is real, not rounded to zero");

    // nothing created or lost
    let left_a = w.d.env.token_balance(&ata(&vault, &w.d.mint_a));
    assert_eq!(w.d.env.token_balance(&x.token_a) + w.d.env.token_balance(&z.token_a) + w.d.env.token_balance(&t_a) + left_a, fee_a);
    let left_br = w.d.env.token_balance(&ata(&vault, &bribe_mint));
    assert_eq!(w.d.env.token_balance(&x.token_bribe) + w.d.env.token_balance(&z.token_bribe) + w.d.env.token_balance(&t_bribe) + left_br, bribe_amount);
}

#[test]
fn a_wallet_with_two_locks_votes_and_claims_each_lock_separately() {
    let mut w = world();
    let (admin, owner, t1) = (w.admin, w.d.owner, START + WEEK);
    let bribe_mint = unique();
    w.d.env.set_mint(&bribe_mint, &admin, 6);

    // one wallet, two locks (1,000 and 3,000); a second wallet with 1,000
    let mut a = add_voter(&mut w, 401, 1_000, &bribe_mint);
    let mut b = add_voter(&mut w, 402, 3_000, &bribe_mint);
    let other = add_voter(&mut w, 403, 1_000, &bribe_mint);
    // make lock 402 belong to a's wallet: rewrite its owner and reuse a's token accounts
    let mut l = w.d.env.account(&b.lock).unwrap();
    l.data[8..40].copy_from_slice(a.key.as_ref());
    w.d.env.svm.set_account(b.lock, l).unwrap();
    b.key = a.key;
    b.token_a = a.token_a;
    b.token_b = a.token_b;
    a.token_bribe = ata(&a.key, &bribe_mint);
    b.token_bribe = a.token_bribe;

    w.d.env.set_time(t1 + 10);
    cast_vote(&mut w, &a);
    cast_vote(&mut w, &b);
    cast_vote(&mut w, &other);

    for i in 0..20 {
        w.d.env.set_time(t1 + 100 + i);
        let s = w.d.swap_ix(10_000_000, i % 2 == 0);
        w.d.env.ok(&owner, &[s]);
    }
    let pool = w.d.env.account(&w.d.pool).unwrap().data;
    let fee_a = u64::from_le_bytes(pool[85..93].try_into().unwrap());
    let vault = pda(VESOLVE, &[b"vault", &1u64.to_le_bytes(), w.gauge.as_ref()]);
    let route = w.idl.ix(
        VESOLVE,
        "route_pool_fees",
        &1u64.to_le_bytes(),
        &[
            ("epoch", epoch(1)),
            ("caller", admin), ("protocol", protocol()), ("gauge", w.gauge), ("solves_config", w.d.config), ("pool", w.d.pool), ("vault", vault),
            ("token_mint_a", w.d.mint_a), ("token_mint_b", w.d.mint_b), ("token_vault_a", w.d.vault_a), ("token_vault_b", w.d.vault_b),
            ("vault_token_account_a", ata(&vault, &w.d.mint_a)), ("vault_token_account_b", ata(&vault, &w.d.mint_b)),
            ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
        ],
    );
    w.d.env.ok(&admin, &[route]);

    for n in 2..=3u64 {
        w.d.env.set_time(t1 + (n as i64 - 1) * WEEK + 100);
        let roll = w.idl.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(n))]);
        w.d.env.ok(&admin, &[roll]);
    }

    // all three locks' power counts: 5,000 in total, so 1/5, 3/5, 1/5 of the fees
    let total = 5_000u64;
    claim_pool(&mut w, &a, &vault).unwrap();
    claim_pool(&mut w, &b, &vault).unwrap();
    claim_pool(&mut w, &other, &vault).unwrap();
    let share = |p: u64| (fee_a as u128 * p as u128 / total as u128) as u64;
    assert_eq!(w.d.env.token_balance(&other.token_a), share(1_000));
    assert_eq!(w.d.env.token_balance(&a.token_a), share(1_000) + share(3_000), "the wallet is paid for both of its locks");
    // each lock claims once
    assert!(claim_pool(&mut w, &a, &vault).is_err());
    assert!(claim_pool(&mut w, &b, &vault).is_err());
}

#[test]
fn earned_fees_survive_a_failed_claim_and_the_gauge_being_removed() {
    let mut w = world();
    let (admin, owner, t1) = (w.admin, w.d.owner, START + WEEK);
    let bribe_mint = unique();
    w.d.env.set_mint(&bribe_mint, &admin, 6);
    let x = add_voter(&mut w, 201, 2_000, &bribe_mint);
    w.d.env.set_time(t1 + 10);
    cast_vote(&mut w, &x);
    for i in 0..10 {
        w.d.env.set_time(t1 + 100 + i);
        let s = w.d.swap_ix(10_000_000, i % 2 == 0);
        w.d.env.ok(&owner, &[s]);
    }
    let route = |w: &World, n: u64| {
        let vault = pda(VESOLVE, &[b"vault", &n.to_le_bytes(), w.gauge.as_ref()]);
        w.idl.ix(
            VESOLVE,
            "route_pool_fees",
            &n.to_le_bytes(),
            &[
                ("epoch", epoch(n)),
                ("caller", admin), ("protocol", protocol()), ("gauge", w.gauge), ("solves_config", w.d.config), ("pool", w.d.pool), ("vault", vault),
                ("token_mint_a", w.d.mint_a), ("token_mint_b", w.d.mint_b), ("token_vault_a", w.d.vault_a), ("token_vault_b", w.d.vault_b),
                ("vault_token_account_a", ata(&vault, &w.d.mint_a)), ("vault_token_account_b", ata(&vault, &w.d.mint_b)),
                ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
            ],
        )
    };
    let ix = route(&w, 1);
    w.d.env.ok(&admin, &[ix]);
    let vault = pda(VESOLVE, &[b"vault", &1u64.to_le_bytes(), w.gauge.as_ref()]);
    let owed_a = w.d.env.token_balance(&ata(&vault, &w.d.mint_a));
    assert!(owed_a > 0);

    let roll = |w: &mut World, n: u64| {
        w.d.env.set_time(START + (n as i64) * WEEK + 100);
        let ix = w.idl.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(n))]);
        w.d.env.ok(&admin, &[ix]);
    };
    roll(&mut w, 2);
    roll(&mut w, 3);

    // the gauge is removed (requested in epoch 3, executed in epoch 4)
    let gauge = w.gauge;
    let ix = w.idl.ix(VESOLVE, "request_gauge_removal", &[], &[("admin", admin), ("protocol", protocol()), ("gauge", gauge), ("admin_config", admin_config())]);
    w.d.env.ok(&admin, &[ix]);
    roll(&mut w, 4);
    // the removal-due gauge has no votes in epoch 4, so its last fees go to the Treasury, not an unclaimable vault
    let err = w.d.env.send(&admin, &[route(&w, 4)]).unwrap_err();
    assert!(err.has("GaugeHasNoVotes"), "{:?}", err.logs);
    collect_to_treasury(&mut w, admin);
    let native = pda(VESOLVE, &[b"native_gauge", gauge.as_ref()]);
    let legacy = pda(VESOLVE, &[b"gauge_reward", gauge.as_ref()]);
    let configure = w.idl.ix(
        VESOLVE,
        "configure_native_gauge",
        &[0],
        &[
            ("caller", admin), ("protocol", protocol()), ("gauge", gauge), ("solves_config", w.d.config), ("pool", w.d.pool),
            ("token_mint_a", w.d.mint_a), ("token_mint_b", w.d.mint_b), ("native_gauge", native), ("legacy_reward", legacy),
            ("reward_mint", w.solv3), ("legacy_vault", ata(&legacy, &w.solv3)), ("reward_vault", w.reward_vault),
            ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    w.d.env.ok(&admin, &[configure]);

    // a claim that fails (destination holds the wrong mint) changes nothing
    let wrong = Voter { key: x.key, lock_id: x.lock_id, lock: x.lock, power: x.power, token_a: x.token_b, token_b: x.token_b, token_bribe: x.token_bribe };
    assert!(claim_pool(&mut w, &wrong, &vault).is_err());
    assert_eq!(w.d.env.token_balance(&ata(&vault, &w.d.mint_a)), owed_a);

    // the retry pays everything that was earned, even though the gauge is gone
    claim_pool(&mut w, &x, &vault).unwrap();
    assert!(w.d.env.token_balance(&x.token_a) >= owed_a - 1, "the sole voter gets the whole epoch's fees");
    assert!(claim_pool(&mut w, &x, &vault).is_err(), "and only once");
}

#[test]
fn bribes_stay_with_voters_after_removal_and_a_pause_cycle_and_the_vault_balances() {
    let mut w = world();
    let (admin, owner, t1) = (w.admin, w.d.owner, START + WEEK);
    let (bribe_mint, briber) = (unique(), unique());
    w.d.env.fund(&briber);
    w.d.env.set_mint(&bribe_mint, &briber, 6);
    let briber_tokens = ata(&briber, &bribe_mint);
    w.d.env.set_token_account(&briber_tokens, &bribe_mint, &briber, 10_000_000);
    let bribe_token = pda(VESOLVE, &[b"bribe_token", bribe_mint.as_ref()]);
    let allow = w.idl.ix(VESOLVE, "set_bribe_token", &[1, 0], &[("admin", admin), ("protocol", protocol()), ("token_mint", bribe_mint), ("bribe_token", bribe_token)]);
    w.d.env.ok(&admin, &[allow]);

    let x = add_voter(&mut w, 301, 3_000, &bribe_mint);
    let y = add_voter(&mut w, 302, 1_000, &bribe_mint);
    w.d.env.set_time(t1 + 10);
    cast_vote(&mut w, &x);
    cast_vote(&mut w, &y);

    // fees must be routed first: that creates the epoch's voter vault the bribe goes into
    for i in 0..6 {
        w.d.env.set_time(t1 + 100 + i);
        let s = w.d.swap_ix(10_000_000, i % 2 == 0);
        w.d.env.ok(&owner, &[s]);
    }
    let vault = pda(VESOLVE, &[b"vault", &1u64.to_le_bytes(), w.gauge.as_ref()]);
    let route = w.idl.ix(
        VESOLVE,
        "route_pool_fees",
        &1u64.to_le_bytes(),
        &[
            ("epoch", epoch(1)),
            ("caller", admin), ("protocol", protocol()), ("gauge", w.gauge), ("solves_config", w.d.config), ("pool", w.d.pool), ("vault", vault),
            ("token_mint_a", w.d.mint_a), ("token_mint_b", w.d.mint_b), ("token_vault_a", w.d.vault_a), ("token_vault_b", w.d.vault_b),
            ("vault_token_account_a", ata(&vault, &w.d.mint_a)), ("vault_token_account_b", ata(&vault, &w.d.mint_b)),
            ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
        ],
    );
    w.d.env.ok(&admin, &[route]);
    let bribe_amount = 4_000_000u64;
    let create = w.idl.ix(
        VESOLVE,
        "create_bribe",
        &bribe_amount.to_le_bytes(),
        &[
            ("user", briber), ("protocol", protocol()), ("epoch", epoch(1)), ("gauge", w.gauge), ("vault", vault), ("token_mint", bribe_mint),
            ("bribe_token", bribe_token), ("bribe", pda(VESOLVE, &[b"bribe", w.gauge.as_ref(), bribe_mint.as_ref(), briber.as_ref()])),
            ("user_token_account", briber_tokens), ("bribe_token_account", ata(&vault, &bribe_mint)),
            ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    w.d.env.ok(&briber, &[create]);
    assert_eq!(w.d.env.token_balance(&ata(&vault, &bribe_mint)), bribe_amount);

    // removal requested in epoch 1, executed in epoch 2; a Treasury sweep must not touch earned bribes
    let gauge = w.gauge;
    let ix = w.idl.ix(VESOLVE, "request_gauge_removal", &[], &[("admin", admin), ("protocol", protocol()), ("gauge", gauge), ("admin_config", admin_config())]);
    w.d.env.ok(&admin, &[ix]);
    let roll = |w: &mut World, n: u64| {
        w.d.env.set_time(START + (n as i64) * WEEK + 100);
        let ix = w.idl.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(n))]);
        w.d.env.ok(&admin, &[ix]);
    };
    roll(&mut w, 2);
    let native = pda(VESOLVE, &[b"native_gauge", gauge.as_ref()]);
    let legacy = pda(VESOLVE, &[b"gauge_reward", gauge.as_ref()]);
    let configure = w.idl.ix(
        VESOLVE,
        "configure_native_gauge",
        &[0],
        &[
            ("caller", admin), ("protocol", protocol()), ("gauge", gauge), ("solves_config", w.d.config), ("pool", w.d.pool),
            ("token_mint_a", w.d.mint_a), ("token_mint_b", w.d.mint_b), ("native_gauge", native), ("legacy_reward", legacy),
            ("reward_mint", w.solv3), ("legacy_vault", ata(&legacy, &w.solv3)), ("reward_vault", w.reward_vault),
            ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    // fees accrued since the last route must be settled before removal can execute
    let r2 = w.idl.ix(
        VESOLVE,
        "route_pool_fees",
        &2u64.to_le_bytes(),
        &[
            ("epoch", epoch(2)),
            ("caller", admin), ("protocol", protocol()), ("gauge", gauge), ("solves_config", w.d.config), ("pool", w.d.pool),
            ("vault", pda(VESOLVE, &[b"vault", &2u64.to_le_bytes(), gauge.as_ref()])),
            ("token_mint_a", w.d.mint_a), ("token_mint_b", w.d.mint_b), ("token_vault_a", w.d.vault_a), ("token_vault_b", w.d.vault_b),
            ("vault_token_account_a", ata(&pda(VESOLVE, &[b"vault", &2u64.to_le_bytes(), gauge.as_ref()]), &w.d.mint_a)),
            ("vault_token_account_b", ata(&pda(VESOLVE, &[b"vault", &2u64.to_le_bytes(), gauge.as_ref()]), &w.d.mint_b)),
            ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
        ],
    );
    // epoch 2 had no votes, so those fees go to the Treasury instead of an unclaimable vault (DEV-10)
    let err = w.d.env.send(&admin, &[r2]).unwrap_err();
    assert!(err.has("GaugeHasNoVotes"), "{:?}", err.logs);
    collect_to_treasury(&mut w, admin);
    w.d.env.ok(&admin, &[configure]);
    assert_eq!(w.d.env.account(&gauge).unwrap().data[8 + 96 + 4], 4, "the gauge is REMOVED");

    // pause claims across an epoch, then restore
    let idl = Idl::vesolve();
    let pauses = |claims: bool| idl.ix(VESOLVE, "set_pauses", &[0, 0, 0, b(claims), 0, 0, 0], &[("admin", admin), ("protocol", protocol()), ("admin_config", admin_config())]);
    let on = pauses(true);
    w.d.env.ok(&admin, &[on]);
    roll(&mut w, 3);
    assert!(claim_bribe(&mut w, &x, &vault, &bribe_mint).unwrap_err().has("paused"));
    assert_eq!(w.d.env.token_balance(&ata(&vault, &bribe_mint)), bribe_amount, "a paused claim moves nothing");
    let off = pauses(false);
    w.d.env.ok(&admin, &[off]);

    // the voters still get all of it: 3/4 and 1/4, no more, no less
    claim_bribe(&mut w, &x, &vault, &bribe_mint).unwrap();
    claim_bribe(&mut w, &y, &vault, &bribe_mint).unwrap();
    let total = x.power + y.power;
    let share = |p: u64| (bribe_amount as u128 * p as u128 / total as u128) as u64;
    assert_eq!(w.d.env.token_balance(&x.token_bribe), share(x.power));
    assert_eq!(w.d.env.token_balance(&y.token_bribe), share(y.power));
    let left = w.d.env.token_balance(&ata(&vault, &bribe_mint));
    assert!(left <= 1, "only rounding dust remains: {left}");
    assert_eq!(w.d.env.token_balance(&x.token_bribe) + w.d.env.token_balance(&y.token_bribe) + left, bribe_amount, "earned = claimed + outstanding");
}

#[test]
fn a_token_that_cannot_be_paid_out_never_blocks_the_other_side() {
    let mut w = world();
    let (admin, owner, t1) = (w.admin, w.d.owner, START + WEEK);
    let bribe_mint = unique();
    w.d.env.set_mint(&bribe_mint, &admin, 6);
    let x = add_voter(&mut w, 401, 2_000, &bribe_mint);
    w.d.env.set_time(t1 + 10);
    cast_vote(&mut w, &x);
    for i in 0..10 {
        w.d.env.set_time(t1 + 100 + i);
        let s = w.d.swap_ix(10_000_000, i % 2 == 0);
        w.d.env.ok(&owner, &[s]);
    }
    let vault = pda(VESOLVE, &[b"vault", &1u64.to_le_bytes(), w.gauge.as_ref()]);
    let route = w.idl.ix(
        VESOLVE,
        "route_pool_fees",
        &1u64.to_le_bytes(),
        &[
            ("epoch", epoch(1)),
            ("caller", admin), ("protocol", protocol()), ("gauge", w.gauge), ("solves_config", w.d.config), ("pool", w.d.pool), ("vault", vault),
            ("token_mint_a", w.d.mint_a), ("token_mint_b", w.d.mint_b), ("token_vault_a", w.d.vault_a), ("token_vault_b", w.d.vault_b),
            ("vault_token_account_a", ata(&vault, &w.d.mint_a)), ("vault_token_account_b", ata(&vault, &w.d.mint_b)),
            ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
        ],
    );
    w.d.env.ok(&admin, &[route]);
    let owed_a = w.d.env.token_balance(&ata(&vault, &w.d.mint_a));
    let owed_b = w.d.env.token_balance(&ata(&vault, &w.d.mint_b));
    assert!(owed_a > 0 && owed_b > 0);
    for n in 2..=3u64 {
        w.d.env.set_time(START + (n as i64) * WEEK + 100);
        let ix = w.idl.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(n))]);
        w.d.env.ok(&admin, &[ix]);
    }

    // freeze the voter's token A account: anything touching A fails
    let mut frozen = w.d.env.account(&x.token_a).unwrap();
    frozen.data[108] = 2;
    w.d.env.svm.set_account(x.token_a, frozen.clone()).unwrap();
    assert!(claim_pool_sides(&mut w, &x, &vault, 3).is_err(), "claiming both fails as one unit");
    assert_eq!(w.d.env.token_balance(&ata(&vault, &w.d.mint_b)), owed_b, "and moves nothing");

    // B alone still pays
    claim_pool_sides(&mut w, &x, &vault, 2).unwrap();
    assert_eq!(w.d.env.token_balance(&x.token_b), owed_b);
    assert_eq!(w.d.env.token_balance(&x.token_a), 0);
    assert!(claim_pool_sides(&mut w, &x, &vault, 2).unwrap_err().has("AlreadyClaimed"), "B is claimed once");

    // once A can be paid again, A pays and the full amount was never lost
    frozen.data[108] = 1;
    w.d.env.svm.set_account(x.token_a, frozen).unwrap();
    claim_pool_sides(&mut w, &x, &vault, 3).unwrap();
    assert_eq!(w.d.env.token_balance(&x.token_a), owed_a);
    assert_eq!(w.d.env.token_balance(&x.token_b), owed_b, "B is not paid twice");
    assert!(claim_pool_sides(&mut w, &x, &vault, 3).unwrap_err().has("AlreadyClaimed"));
}

// ---- Auto-vote: public voter registry (DEV-12) and fee withdrawal to the Treasury (DEV-15) ----

const AUTO_VOTE_KEEPER: &str = "2wW8zBanRBtSt8iHXPCbTi3ZXSDdaRXQc9kSUC7rbwYN";

fn enrollment_of(v: &Voter) -> Pubkey {
    pda(VESOLVE, &[b"auto_vote", v.lock.as_ref()])
}
fn delegate_of(v: &Voter) -> Pubkey {
    pda(VESOLVE, &[b"auto_vote_delegate", v.lock.as_ref()])
}
fn auto_voter_of(who: &Pubkey) -> Pubkey {
    pda(VESOLVE, &[b"auto_voter", who.as_ref()])
}
fn vote_args(v: &Voter, gauge: &Pubkey) -> Vec<u8> {
    let mut args = v.lock_id.to_le_bytes().to_vec();
    args.extend(1u32.to_le_bytes());
    args.extend(key_bytes(gauge));
    args.extend(100u64.to_le_bytes());
    args
}
fn owner_ix(w: &World, name: &str, v: &Voter, extra: &[(&str, Pubkey)]) -> solana_instruction::Instruction {
    let mut accounts = vec![("owner", v.key), ("lock", v.lock)];
    accounts.extend_from_slice(extra);
    w.idl.ix(VESOLVE, name, &v.lock_id.to_le_bytes(), &accounts)
}
/// The Solve3 keeper's vote. `with_delegate` appends the lock's delegate PDA after the gauge, as DEV-12 requires.
fn keeper_vote(w: &mut World, v: &Voter, with_delegate: bool) -> Result<Vec<String>, Failure> {
    let keeper = pk(AUTO_VOTE_KEEPER);
    w.d.env.fund(&keeper);
    let mut ix = w.idl.ix(
        VESOLVE,
        "vote",
        &vote_args(v, &w.gauge),
        &[
            ("user", keeper), ("protocol", protocol()), ("epoch", epoch(1)), ("lock", v.lock), ("allocation_voter", pk(VESOLVE)),
            ("auto_vote_enrollment", enrollment_of(v)), ("user_vote", user_vote(v, 1)), ("vote_lock_record", vote_record(v, 1)),
            ("admin_config", admin_config()),
        ],
    );
    ix.accounts.push(meta(w.gauge, false, false));
    if with_delegate {
        ix.accounts.push(meta(delegate_of(v), false, false));
    }
    w.d.env.send(&keeper, &[ix])
}
fn delegated_vote(w: &mut World, v: &Voter, voter: &Pubkey) -> Result<Vec<String>, Failure> {
    let mut ix = w.idl.ix(
        VESOLVE,
        "delegated_vote",
        &vote_args(v, &w.gauge),
        &[
            ("voter", *voter), ("protocol", protocol()), ("epoch", epoch(1)), ("lock", v.lock), ("enrollment", enrollment_of(v)),
            ("delegate", delegate_of(v)), ("auto_voter", auto_voter_of(voter)), ("user_vote", user_vote(v, 1)),
            ("vote_lock_record", vote_record(v, 1)), ("system_program", pk(SYSTEM_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    ix.accounts.push(meta(w.gauge, false, false));
    w.d.env.send(voter, &[ix])
}
fn register(w: &mut World, who: &Pubkey) -> Result<Vec<String>, Failure> {
    let ix = w.idl.ix(VESOLVE, "register_auto_voter", &[], &[("authority", *who), ("auto_voter", auto_voter_of(who)), ("system_program", pk(SYSTEM_PROGRAM))]);
    w.d.env.send(who, &[ix])
}
fn voted_for_gauge(w: &World, v: &Voter) -> bool {
    // the gauge's weight in epoch 1 includes this lock's power after a successful vote
    let data = w.d.env.account(&epoch(1)).unwrap().data;
    let n = u32::from_le_bytes(data[48..52].try_into().unwrap()) as usize;
    (0..n).any(|i| {
        let at = 52 + i * 48;
        data[at..at + 32] == w.gauge.to_bytes() && u64::from_le_bytes(data[at + 32..at + 40].try_into().unwrap()) >= v.power
    })
}

#[test]
fn any_registered_voter_the_owner_picks_votes_the_lock_and_only_that_voter() {
    let mut w = world();
    let bribe_mint = unique();
    w.d.env.set_mint(&bribe_mint, &w.admin, 6);
    let v = add_voter(&mut w, 201, 2_000, &bribe_mint);
    w.d.env.set_time(START + WEEK + 10);
    let enroll = owner_ix(&w, "enroll_auto_vote", &v, &[("enrollment", enrollment_of(&v)), ("system_program", pk(SYSTEM_PROGRAM))]);
    w.d.env.ok(&v.key, &[enroll]);

    // The Solve3 keeper votes an enrolled lock nobody re-assigned, but must show the (empty) delegate PDA.
    assert!(keeper_vote(&mut w, &v, false).unwrap_err().has("AutoVoterNotChosen"), "an old keeper client cannot skip the check");
    keeper_vote(&mut w, &v, true).expect("keeper votes an un-delegated enrolled lock");
    assert!(voted_for_gauge(&w, &v));

    // Anyone may register; the owner picks a registered voter. Unregistered wallets cannot be picked.
    let (third, other) = (unique(), unique());
    w.d.env.fund(&third);
    w.d.env.fund(&other);
    let set = |w: &World, voter: &Pubkey| {
        owner_ix(w, "set_auto_voter", &v, &[("enrollment", enrollment_of(&v)), ("auto_voter", auto_voter_of(voter)), ("delegate", delegate_of(&v)), ("system_program", pk(SYSTEM_PROGRAM))])
    };
    assert!(w.d.env.send(&v.key, &[set(&w, &third)]).is_err(), "only a registered voter can be chosen");
    register(&mut w, &third).unwrap();
    register(&mut w, &other).unwrap();
    assert!(register(&mut w, &third).is_err(), "registered once");
    let mut stranger_set = set(&w, &third);
    let stranger = unique();
    w.d.env.fund(&stranger);
    stranger_set.accounts[0].pubkey = stranger;
    assert!(w.d.env.send(&stranger, &[stranger_set]).is_err(), "only the lock owner chooses");
    w.d.env.ok(&v.key, &[set(&w, &third)]);

    // Now only the chosen voter votes it: not the keeper, not another registered voter.
    assert!(keeper_vote(&mut w, &v, true).unwrap_err().has("AutoVoterNotChosen"));
    assert!(delegated_vote(&mut w, &v, &other).unwrap_err().has("AutoVoterNotChosen"));
    delegated_vote(&mut w, &v, &third).expect("the chosen voter votes");
    assert!(voted_for_gauge(&w, &v));

    // A voter that deregisters can no longer vote the locks that chose it.
    let deregister = w.idl.ix(VESOLVE, "deregister_auto_voter", &[], &[("authority", third), ("auto_voter", auto_voter_of(&third))]);
    w.d.env.ok(&third, &[deregister]);
    assert!(delegated_vote(&mut w, &v, &third).is_err());

    // Clearing the choice hands the lock back to the keeper.
    let clear = owner_ix(&w, "clear_auto_voter", &v, &[("delegate", delegate_of(&v))]);
    w.d.env.ok(&v.key, &[clear]);
    keeper_vote(&mut w, &v, true).expect("keeper votes again after the owner clears the choice");

    // A choice left over from an earlier enrollment is ignored: revoke, re-enroll later, keeper votes again.
    register(&mut w, &third).unwrap();
    w.d.env.ok(&v.key, &[set(&w, &third)]);
    let revoke = owner_ix(&w, "revoke_auto_vote", &v, &[("enrollment", enrollment_of(&v))]);
    w.d.env.ok(&v.key, &[revoke]);
    assert!(keeper_vote(&mut w, &v, true).is_err(), "not enrolled: nobody but the owner votes it");
    w.d.env.set_time(START + WEEK + 20);
    let enroll = owner_ix(&w, "enroll_auto_vote", &v, &[("enrollment", enrollment_of(&v)), ("system_program", pk(SYSTEM_PROGRAM))]);
    w.d.env.ok(&v.key, &[enroll]);
    keeper_vote(&mut w, &v, true).expect("a stale choice from the previous enrollment does not block the keeper");
    assert!(delegated_vote(&mut w, &v, &third).unwrap_err().has("AutoVoterNotChosen"), "nor lets the old voter vote");

    // The owner always votes their own lock directly.
    cast_vote(&mut w, &v);
}

#[test]
fn auto_vote_fees_are_withdrawn_only_to_the_treasury() {
    let mut w = world();
    let admin = w.admin;
    let mint = w.d.mint_a;
    let fees = ata(&protocol(), &mint);
    w.d.env.set_token_account(&fees, &mint, &protocol(), 7_500);
    let treasury = unique();
    let withdraw = |w: &World, signer: Pubkey, to: Pubkey, destination: Pubkey, amount: u64| {
        w.idl.ix(
            VESOLVE,
            "withdraw_auto_vote_fees",
            &amount.to_le_bytes(),
            &[
                ("admin", signer), ("protocol", protocol()), ("token_mint", mint), ("treasury_token_account", fees),
                ("treasury", to), ("destination_token_account", destination), ("admin_config", admin_config()),
                ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
            ],
        )
    };
    let err = w.d.env.send(&admin, &[withdraw(&w, admin, treasury, ata(&treasury, &mint), 7_500)]).unwrap_err();
    assert!(err.has("TreasuryNotSet"), "{:?}", err.logs);
    let set_treasury = w.idl.ix(VESOLVE, "set_treasury", &key_bytes(&treasury), &[("admin", admin), ("protocol", protocol()), ("admin_config", admin_config()), ("treasury_change", treasury_change())]);
    w.d.env.ok(&admin, &[set_treasury]);

    // Not to the Admin's own account any more, and not to any other wallet.
    assert!(w.d.env.send(&admin, &[withdraw(&w, admin, admin, ata(&admin, &mint), 7_500)]).unwrap_err().has("InvalidTreasury"));
    let elsewhere = unique();
    assert!(w.d.env.send(&admin, &[withdraw(&w, admin, treasury, ata(&elsewhere, &mint), 7_500)]).is_err());
    let stranger = unique();
    w.d.env.fund(&stranger);
    assert!(w.d.env.send(&stranger, &[withdraw(&w, stranger, treasury, ata(&treasury, &mint), 7_500)]).is_err(), "Admin only");

    w.d.env.ok(&admin, &[withdraw(&w, admin, treasury, ata(&treasury, &mint), 5_000)]);
    assert_eq!(w.d.env.token_balance(&ata(&treasury, &mint)), 5_000);
    assert_eq!(w.d.env.token_balance(&fees), 2_500);
    assert!(w.d.env.send(&admin, &[withdraw(&w, admin, treasury, ata(&treasury, &mint), 2_501)]).is_err(), "not more than collected");
}

/// Security review 2026-10-11, M-1 (fixed). A seller who enrolled a lock and picked their own voter can no
/// longer steer it after the sale: an enrollment made by an earlier owner does not count, for a chosen voter or
/// for the Solve3 keeper (transfer_lock also closes both records). Who cast a vote is recorded with it (M-3).
#[test]
fn m1_auto_vote_choice_does_not_survive_a_change_of_owner() {
    let mut w = world();
    let bribe_mint = unique();
    w.d.env.set_mint(&bribe_mint, &w.admin, 6);
    let v = add_voter(&mut w, 301, 2_000, &bribe_mint);
    w.d.env.set_time(START + WEEK + 10);

    let seller_voter = unique();
    w.d.env.fund(&seller_voter);
    register(&mut w, &seller_voter).unwrap();
    let enroll = owner_ix(&w, "enroll_auto_vote", &v, &[("enrollment", enrollment_of(&v)), ("system_program", pk(SYSTEM_PROGRAM))]);
    let set = owner_ix(&w, "set_auto_voter", &v, &[("enrollment", enrollment_of(&v)), ("auto_voter", auto_voter_of(&seller_voter)), ("delegate", delegate_of(&v)), ("system_program", pk(SYSTEM_PROGRAM))]);
    w.d.env.ok(&v.key, &[enroll, set]);

    // Lock.owner changes (what transfer_lock writes), with the old records still in place.
    let buyer = unique();
    let mut lock = w.d.env.account(&v.lock).unwrap();
    lock.data[8..40].copy_from_slice(buyer.as_ref());
    w.d.env.svm.set_account(v.lock, lock).unwrap();

    assert!(delegated_vote(&mut w, &v, &seller_voter).unwrap_err().has("InvalidOwner"), "the seller's voter is refused");
    assert!(keeper_vote(&mut w, &v, true).unwrap_err().has("InvalidOwner"), "so is the keeper");
    assert!(!voted_for_gauge(&w, &v));
}

/// M-3 (fixed): the vote record names who cast the vote, which is what the 15% fee follows.
#[test]
fn m3_vote_record_names_who_cast_the_vote() {
    let mut w = world();
    let bribe_mint = unique();
    w.d.env.set_mint(&bribe_mint, &w.admin, 6);
    let v = add_voter(&mut w, 302, 2_000, &bribe_mint);
    w.d.env.set_time(START + WEEK + 10);
    let enroll = owner_ix(&w, "enroll_auto_vote", &v, &[("enrollment", enrollment_of(&v)), ("system_program", pk(SYSTEM_PROGRAM))]);
    w.d.env.ok(&v.key, &[enroll]);
    let recorded = |w: &World| Pubkey::try_from(&w.d.env.account(&vote_record(&v, 1)).unwrap().data[8..40]).unwrap();

    keeper_vote(&mut w, &v, true).expect("keeper votes");
    assert_eq!(recorded(&w), pk(AUTO_VOTE_KEEPER), "an auto-vote: the fee applies");
    cast_vote(&mut w, &v);
    assert_eq!(recorded(&w), v.key, "the owner's own vote: no fee, enrolled or not");
}

fn partner_voter_of(who: &Pubkey) -> Pubkey {
    pda(VESOLVE, &[b"partner_voter", who.as_ref()])
}

#[test]
fn partner_voter_locks_pay_no_auto_vote_fee_and_everyone_else_still_pays_fifteen_percent() {
    let mut w = world();
    let (admin, owner, t1) = (w.admin, w.d.owner, START + WEEK);

    let (bribe_mint, briber) = (unique(), unique());
    w.d.env.fund(&briber);
    w.d.env.set_mint(&bribe_mint, &briber, 6);
    let briber_tokens = ata(&briber, &bribe_mint);
    w.d.env.set_token_account(&briber_tokens, &bribe_mint, &briber, 10_000_000);
    let bribe_token = pda(VESOLVE, &[b"bribe_token", bribe_mint.as_ref()]);
    let allow = w.idl.ix(VESOLVE, "set_bribe_token", &[1, 0], &[("admin", admin), ("protocol", protocol()), ("token_mint", bribe_mint), ("bribe_token", bribe_token)]);
    w.d.env.ok(&admin, &[allow]);

    // x votes its own lock; k is voted by the Solve3 keeper; p1, p2 and p3 are voted by the partner's voter wallet.
    let x = add_voter(&mut w, 301, 1_000, &bribe_mint);
    let k = add_voter(&mut w, 302, 2_000, &bribe_mint);
    let p1 = add_voter(&mut w, 303, 3_000, &bribe_mint);
    let p2 = add_voter(&mut w, 304, 3_000, &bribe_mint);
    let p3 = add_voter(&mut w, 305, 3_000, &bribe_mint);
    let partner = unique();
    w.d.env.fund(&partner);
    w.d.env.set_time(t1 + 10);
    register(&mut w, &partner).unwrap();
    for v in [&k, &p1, &p2, &p3] {
        let enroll = owner_ix(&w, "enroll_auto_vote", v, &[("enrollment", enrollment_of(v)), ("system_program", pk(SYSTEM_PROGRAM))]);
        w.d.env.ok(&v.key, &[enroll]);
    }
    for v in [&p1, &p2, &p3] {
        let set = owner_ix(&w, "set_auto_voter", v, &[("enrollment", enrollment_of(v)), ("auto_voter", auto_voter_of(&partner)), ("delegate", delegate_of(v)), ("system_program", pk(SYSTEM_PROGRAM))]);
        w.d.env.ok(&v.key, &[set]);
    }

    // Only the Admin flags a partner voter.
    let flag = |w: &World, who: Pubkey| {
        w.idl.ix(VESOLVE, "set_partner_voter", &key_bytes(&partner), &[("admin", who), ("protocol", protocol()), ("partner_voter", partner_voter_of(&partner)), ("system_program", pk(SYSTEM_PROGRAM))])
    };
    assert!(w.d.env.send(&partner, &[flag(&w, partner)]).is_err(), "the partner cannot flag itself");
    assert!(w.d.env.send(&x.key, &[flag(&w, x.key)]).is_err(), "nobody but the Admin flags a partner");
    w.d.env.ok(&admin, &[flag(&w, admin)]);

    cast_vote(&mut w, &x);
    keeper_vote(&mut w, &k, true).expect("the keeper votes k");
    for v in [&p1, &p2, &p3] {
        delegated_vote(&mut w, v, &partner).expect("the partner voter votes");
    }

    for i in 0..20 {
        w.d.env.set_time(t1 + 100 + i);
        let s = w.d.swap_ix(10_000_000, i % 2 == 0);
        w.d.env.ok(&owner, &[s]);
    }
    let pool = w.d.env.account(&w.d.pool).unwrap().data;
    let (fee_a, fee_b) = (u64::from_le_bytes(pool[85..93].try_into().unwrap()), u64::from_le_bytes(pool[93..101].try_into().unwrap()));
    let vault = pda(VESOLVE, &[b"vault", &1u64.to_le_bytes(), w.gauge.as_ref()]);
    let route = w.idl.ix(
        VESOLVE,
        "route_pool_fees",
        &1u64.to_le_bytes(),
        &[
            ("epoch", epoch(1)),
            ("caller", admin), ("protocol", protocol()), ("gauge", w.gauge), ("solves_config", w.d.config), ("pool", w.d.pool), ("vault", vault),
            ("token_mint_a", w.d.mint_a), ("token_mint_b", w.d.mint_b), ("token_vault_a", w.d.vault_a), ("token_vault_b", w.d.vault_b),
            ("vault_token_account_a", ata(&vault, &w.d.mint_a)), ("vault_token_account_b", ata(&vault, &w.d.mint_b)),
            ("solve_program", pk(SOLVE)), ("token_program", pk(TOKEN_PROGRAM)), ("associated_token_program", pk(ATA_PROGRAM)), ("system_program", pk(SYSTEM_PROGRAM)),
        ],
    );
    w.d.env.ok(&admin, &[route]);
    let bribe_amount = 4_000_000u64;
    let create = w.idl.ix(
        VESOLVE,
        "create_bribe",
        &bribe_amount.to_le_bytes(),
        &[
            ("user", briber), ("protocol", protocol()), ("epoch", epoch(1)), ("gauge", w.gauge), ("vault", vault), ("token_mint", bribe_mint),
            ("bribe_token", bribe_token), ("bribe", pda(VESOLVE, &[b"bribe", w.gauge.as_ref(), bribe_mint.as_ref(), briber.as_ref()])),
            ("user_token_account", briber_tokens), ("bribe_token_account", ata(&vault, &bribe_mint)),
            ("token_program", pk(TOKEN_PROGRAM)), ("admin_config", admin_config()),
        ],
    );
    w.d.env.ok(&briber, &[create]);
    for n in 2..=3u64 {
        w.d.env.set_time(t1 + (n as i64 - 1) * WEEK + 100);
        let roll = w.idl.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(n))]);
        w.d.env.ok(&admin, &[roll]);
    }

    let total = x.power + k.power + p1.power + p2.power + p3.power;
    let share = |amount: u64, p: u64| (amount as u128 * p as u128 / total as u128) as u64;
    let cut = |amount: u64| (amount as u128 * 1_500 / 10_000) as u64; // AUTO_VOTE_FEE_BPS
    let flag_pda = partner_voter_of(&partner);
    let (t_a, t_bribe) = (ata(&protocol(), &w.d.mint_a), ata(&protocol(), &bribe_mint));

    // a lock its owner votes manually never pays the fee
    claim_pool(&mut w, &x, &vault).unwrap();
    assert_eq!(w.d.env.token_balance(&x.token_a), share(fee_a, x.power), "manual voting: no fee");
    assert_eq!(w.d.env.token_balance(&x.token_b), share(fee_b, x.power), "manual voting: no fee");
    assert_eq!(w.d.env.token_balance(&t_a), 0, "the treasury has received nothing yet");

    // the keeper-voted lock pays the standard 15%
    claim_pool(&mut w, &k, &vault).unwrap();
    claim_bribe(&mut w, &k, &vault, &bribe_mint).unwrap();
    let ka = share(fee_a, k.power);
    assert_eq!(w.d.env.token_balance(&k.token_a), ka - cut(ka), "keeper-voted: 85% to the owner");
    assert_eq!(w.d.env.token_balance(&t_a), cut(ka), "keeper-voted: 15% to the treasury");

    // the partner-voted lock p1 passes the flag and pays nothing: pool fees and bribes
    claim_pool_with(&mut w, &p1, &vault, 3, Some(flag_pda)).unwrap();
    claim_bribe_with(&mut w, &p1, &vault, &bribe_mint, Some(flag_pda)).unwrap();
    assert_eq!(w.d.env.token_balance(&p1.token_a), share(fee_a, p1.power), "partner-voted: all of it to the owner");
    assert_eq!(w.d.env.token_balance(&p1.token_b), share(fee_b, p1.power));
    assert_eq!(w.d.env.token_balance(&p1.token_bribe), share(bribe_amount, p1.power));
    assert_eq!(w.d.env.token_balance(&t_a), cut(ka), "the treasury got nothing from the partner-voted lock");
    assert_eq!(w.d.env.token_balance(&t_bribe), cut(share(bribe_amount, k.power)), "no bribe fee from the partner-voted lock either");

    // passing some other voter's flag (or a made-up account) is refused, so the exemption cannot be faked
    let fake = partner_voter_of(&unique());
    assert!(claim_pool_with(&mut w, &p2, &vault, 3, Some(fake)).is_err(), "a flag for another wallet is refused");
    assert!(claim_pool_with(&mut w, &p2, &vault, 3, Some(vault)).is_err(), "a random account is refused");
    // leaving the flag out is allowed, and the standard fee is then charged
    claim_pool(&mut w, &p2, &vault).unwrap();
    let p2a = share(fee_a, p2.power);
    assert_eq!(w.d.env.token_balance(&p2.token_a), p2a - cut(p2a), "no flag passed: the standard fee");

    // once the Admin removes the flag, the exemption is gone (a closed flag account is not an exemption)
    let remove = |who: Pubkey, w: &World| w.idl.ix(VESOLVE, "remove_partner_voter", &[], &[("admin", who), ("protocol", protocol()), ("partner_voter", flag_pda)]);
    assert!(w.d.env.send(&partner, &[remove(partner, &w)]).is_err(), "only the Admin removes it");
    w.d.env.ok(&admin, &[remove(admin, &w)]);
    claim_pool_with(&mut w, &p3, &vault, 3, Some(flag_pda)).unwrap();
    let p3a = share(fee_a, p3.power);
    assert_eq!(w.d.env.token_balance(&p3.token_a), p3a - cut(p3a), "after removal: the standard fee again");
}
