use svm_tests::*;

const START: i64 = 1_800_000_000 / WEEK * WEEK; // a Thursday 00:00 UTC

fn protocol() -> Pubkey {
    pda(VESOLVE, &[b"protocol"])
}
fn admin_config() -> Pubkey {
    pda(VESOLVE, &[b"admin_config"])
}
fn treasury_change() -> Pubkey {
    pda(VESOLVE, &[b"treasury_change"])
}
fn epoch(n: u64) -> Pubkey {
    pda(VESOLVE, &[b"epoch_data", &n.to_le_bytes()])
}

fn init(env: &mut Env, idl: &Idl, mint: &Pubkey) {
    env.set_time(START + 10);
    let mut args = key_bytes(mint);
    args.extend_from_slice(&WEEK.to_le_bytes());
    let ix = idl.ix(
        VESOLVE,
        "initialize",
        &args,
        &[("payer", env.payer), ("protocol", protocol()), ("epoch", epoch(0))],
    );
    env.ok(&env.payer.clone(), &[ix]);
}

fn pauses(voting: bool, emissions: bool, global: bool) -> Vec<u8> {
    // PauseFlags order: global, voting, bribes, claims, exit, gauge_activation, emissions
    vec![b(global), b(voting), 0, 0, 0, 0, b(emissions)]
}

fn set_pauses(env: &mut Env, idl: &Idl, signer: &Pubkey, flags: Vec<u8>) -> Result<Vec<String>, Failure> {
    let ix = idl.ix(VESOLVE, "set_pauses", &flags, &[("admin", *signer), ("protocol", protocol()), ("admin_config", admin_config())]);
    env.send(signer, &[ix])
}

#[test]
fn only_the_bootstrap_admin_can_initialize() {
    let idl = Idl::vesolve();
    let mut env = Env::new();
    let stranger = unique();
    env.fund(&stranger);
    env.set_time(START + 10);
    let mut args = key_bytes(&unique());
    args.extend_from_slice(&WEEK.to_le_bytes());
    let ix = idl.ix(VESOLVE, "initialize", &args, &[("payer", stranger), ("protocol", protocol()), ("epoch", epoch(0))]);
    let err = env.send(&stranger, &[ix]).unwrap_err();
    assert!(err.has("Unauthorized") || err.has("Unauthorized".to_lowercase().as_str()), "{:?}", err.logs);

    init(&mut env, &idl, &unique());
    let p = env.account(&protocol()).unwrap();
    assert_eq!(&p.data[8..40], env.payer.as_ref(), "payer becomes protocol.admin");
}

#[test]
fn pauses_are_admin_only_and_reversible() {
    let idl = Idl::vesolve();
    let mut env = Env::new();
    init(&mut env, &idl, &unique());
    let stranger = unique();
    env.fund(&stranger);
    let err = set_pauses(&mut env, &idl, &stranger, pauses(true, false, false)).unwrap_err();
    assert!(err.has("Unauthorized"), "{:?}", err.logs);
    let admin = env.payer;
    set_pauses(&mut env, &idl, &admin, pauses(true, true, false)).unwrap();
    let c = env.account(&admin_config()).unwrap();
    // pending_admin(32) then global, voting, bribes, claims, exit, gauge, emissions
    assert_eq!(&c.data[8 + 32..8 + 32 + 7], &[0, 1, 0, 0, 0, 0, 1]);
    set_pauses(&mut env, &idl, &admin, pauses(false, false, false)).unwrap();
    let c = env.account(&admin_config()).unwrap();
    assert_eq!(&c.data[8 + 32..8 + 32 + 7], &[0; 7]);
}

#[test]
fn admin_transfer_is_two_step_and_cancellable() {
    let idl = Idl::vesolve();
    let mut env = Env::new();
    init(&mut env, &idl, &unique());
    let old = env.payer;
    let new = unique();
    env.fund(&new);
    let propose = |idl: &Idl, who: &Pubkey, target: &Pubkey| {
        idl.ix(VESOLVE, "propose_admin", &key_bytes(target), &[("admin", *who), ("protocol", protocol()), ("admin_config", admin_config())])
    };
    let accept = |idl: &Idl, who: &Pubkey| idl.ix(VESOLVE, "accept_admin", &[], &[("new_admin", *who), ("protocol", protocol()), ("admin_config", admin_config())]);

    // a stranger cannot propose or accept
    let stranger = unique();
    env.fund(&stranger);
    assert!(env.send(&stranger, &[propose(&idl, &stranger, &stranger)]).is_err());

    env.ok(&old, &[propose(&idl, &old, &new)]);
    // nothing changed yet; the wrong wallet cannot accept
    assert_eq!(&env.account(&protocol()).unwrap().data[8..40], old.as_ref());
    assert!(env.send(&stranger, &[accept(&idl, &stranger)]).is_err());
    // cancel, then the proposed wallet can no longer accept
    env.ok(&old, &[propose(&idl, &old, &Pubkey::default())]);
    assert!(env.send(&new, &[accept(&idl, &new)]).is_err());
    // propose again and accept
    env.ok(&old, &[propose(&idl, &old, &new)]);
    env.ok(&new, &[accept(&idl, &new)]);
    assert_eq!(&env.account(&protocol()).unwrap().data[8..40], new.as_ref());
    // old admin is out, new admin is in
    assert!(set_pauses(&mut env, &idl, &old, pauses(true, false, false)).is_err());
    set_pauses(&mut env, &idl, &new, pauses(true, false, false)).unwrap();
}

#[test]
fn gate_threshold_and_treasury_are_admin_only_and_bounded() {
    let idl = Idl::vesolve();
    let mut env = Env::new();
    init(&mut env, &idl, &unique());
    let admin = env.payer;
    let gate = |idl: &Idl, who: &Pubkey, ppm: u32| idl.ix(VESOLVE, "set_gate_threshold", &ppm.to_le_bytes(), &[("admin", *who), ("protocol", protocol()), ("admin_config", admin_config())]);
    let treasury = |idl: &Idl, who: &Pubkey, t: &Pubkey| idl.ix(VESOLVE, "set_treasury", &key_bytes(t), &[("admin", *who), ("protocol", protocol()), ("admin_config", admin_config()), ("treasury_change", treasury_change())]);
    let stranger = unique();
    env.fund(&stranger);
    assert!(env.send(&stranger, &[gate(&idl, &stranger, 100)]).is_err());
    assert!(env.send(&stranger, &[treasury(&idl, &stranger, &stranger)]).is_err());
    let err = env.send(&admin, &[gate(&idl, &admin, 10_001)]).unwrap_err();
    assert!(err.has("Gate threshold is out of range"), "{:?}", err.logs);
    env.ok(&admin, &[gate(&idl, &admin, 0)]); // 0 switches the gate off
    env.ok(&admin, &[gate(&idl, &admin, 10_000)]);
    let t = unique();
    env.ok(&admin, &[treasury(&idl, &admin, &t)]);
    let c = env.account(&admin_config()).unwrap();
    // pending(32) + 7 pause bools, then gate_phi_set, gate_phi_ppm(4), treasury(32)
    let o = 8 + 32 + 7;
    assert_eq!(c.data[o], 1);
    assert_eq!(u32::from_le_bytes(c.data[o + 1..o + 5].try_into().unwrap()), 10_000);
    assert_eq!(&c.data[o + 5..o + 37], t.as_ref());
}

#[test]
fn dev_allocation_is_four_percent_of_the_weekly_emission_and_emissions_pause_blocks_it() {
    let idl = Idl::vesolve();
    let mut env = Env::new();
    let mint = unique();
    init(&mut env, &idl, &mint);
    env.set_mint(&mint, &protocol(), 9);
    let admin = env.payer;
    let dev_ata = ata(&admin, &mint);
    let emission = |idl: &Idl, caller: &Pubkey| {
        idl.ix(
            VESOLVE,
            "initialize_epoch_emission",
            &1u64.to_le_bytes(),
            &[
                ("caller", *caller),
                ("protocol", protocol()),
                ("voting_epoch", epoch(0)),
                ("epoch_emission", pda(VESOLVE, &[b"epoch_emission", &1u64.to_le_bytes()])),
                ("developer_wallet", admin),
                ("token_mint", mint),
                ("developer_token_account", dev_ata),
                ("admin_config", admin_config()),
                ("token_program", pk(TOKEN_PROGRAM)),
            ],
        )
    };
    // roll into epoch 1
    env.set_time(START + WEEK + 5);
    let roll = idl.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(1))]);
    env.ok(&admin, &[roll]);

    set_pauses(&mut env, &idl, &admin, pauses(false, true, false)).unwrap();
    let err = env.send(&admin, &[emission(&idl, &admin)]).unwrap_err();
    assert!(err.has("This system is paused"), "{:?}", err.logs);
    set_pauses(&mut env, &idl, &admin, pauses(false, false, false)).unwrap();
    // the global (nuclear) flag blocks it too
    set_pauses(&mut env, &idl, &admin, pauses(false, false, true)).unwrap();
    assert!(env.send(&admin, &[emission(&idl, &admin)]).unwrap_err().has("This system is paused"));
    set_pauses(&mut env, &idl, &admin, pauses(false, false, false)).unwrap();

    env.ok(&admin, &[emission(&idl, &admin)]);
    // Votes in epoch 0 fund the emission streamed during epoch 1, sized by the
    // schedule at the voting epoch: E(0) = 1.3M SOLV3, of which the dev wallet
    // gets 4% (the gauges split the other 96%).
    assert_eq!(env.token_balance(&dev_ata), 52_000_000_000_000);
}
