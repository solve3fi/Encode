//! Program upgrades wait 24 hours, can be cancelled, and only run through the
//! timelock PDA. The target is a stand-in program deployed with the real
//! upgradeable loader state; the buffer holds a different real program image.
use svm_tests::gauge_world::*;
use svm_tests::*;

const LOADER: &str = "BPFLoaderUpgradeab1e11111111111111111111111";
const DAY: i64 = 24 * 60 * 60;

fn authority() -> Pubkey {
    pda(VESOLVE, &[b"upgrade_authority"])
}

fn loader_account(data: Vec<u8>, lamports: u64) -> solana_account::Account {
    solana_account::Account { lamports, data, owner: pk(LOADER), executable: false, rent_epoch: 0 }
}

struct Target {
    program: Pubkey,
    program_data: Pubkey,
    buffer: Pubkey,
    new_image: Vec<u8>,
}

fn image(name: &str) -> Vec<u8> {
    let dir = std::env::var("SBF_OUT_DIR").unwrap_or_else(|_| format!("{}/../../target/deploy", env!("CARGO_MANIFEST_DIR")));
    std::fs::read(format!("{dir}/{name}.so")).unwrap()
}

/// A deployed target whose upgrade authority is `program_data_authority`, and a
/// buffer holding a new image controlled by `buffer_authority`.
fn target(w: &mut World, program_data_authority: Pubkey, buffer_authority: Pubkey) -> Target {
    let program = unique();
    let program_data = Pubkey::find_program_address(&[program.as_ref()], &pk(LOADER)).0;
    let old_image = image("solve");
    let new_image = image("vesolve");

    let mut prog = 2u32.to_le_bytes().to_vec();
    prog.extend(key_bytes(&program_data));
    let mut acc = loader_account(prog, 10_000_000_000);
    acc.executable = true;
    w.d.env.svm.set_account(program, acc).unwrap();

    let mut pd = 3u32.to_le_bytes().to_vec();
    pd.extend(0u64.to_le_bytes());
    pd.push(1);
    pd.extend(key_bytes(&program_data_authority));
    pd.extend(&old_image);
    pd.resize(45 + new_image.len().max(old_image.len()), 0);
    w.d.env.svm.set_account(program_data, loader_account(pd, 20_000_000_000)).unwrap();

    let buffer = unique();
    let mut buf = 1u32.to_le_bytes().to_vec();
    buf.push(1);
    buf.extend(key_bytes(&buffer_authority));
    buf.extend(&new_image);
    w.d.env.svm.set_account(buffer, loader_account(buf, 20_000_000_000)).unwrap();
    Target { program, program_data, buffer, new_image }
}

fn schedule_ix(w: &World, t: &Target) -> solana_instruction::Instruction {
    w.idl.ix(
        VESOLVE,
        "schedule_upgrade",
        &key_bytes(&t.program),
        &[
            ("admin", w.admin), ("protocol", protocol()), ("schedule", pda(VESOLVE, &[b"upgrade", t.program.as_ref()])),
            ("program", t.program), ("program_data", t.program_data), ("buffer", t.buffer),
            ("upgrade_authority", authority()), ("system_program", pk(SYSTEM_PROGRAM)),
        ],
    )
}

fn cancel_ix(w: &World, t: &Target) -> solana_instruction::Instruction {
    w.idl.ix(VESOLVE, "cancel_upgrade", &[], &[("admin", w.admin), ("protocol", protocol()), ("schedule", pda(VESOLVE, &[b"upgrade", t.program.as_ref()]))])
}

fn execute_ix(w: &World, t: &Target) -> solana_instruction::Instruction {
    w.idl.ix(
        VESOLVE,
        "execute_upgrade",
        &[],
        &[
            ("admin", w.admin), ("protocol", protocol()), ("schedule", pda(VESOLVE, &[b"upgrade", t.program.as_ref()])),
            ("program", t.program), ("program_data", t.program_data), ("buffer", t.buffer),
            ("upgrade_authority", authority()),
            ("rent", pk("SysvarRent111111111111111111111111111111111")),
            ("clock", pk("SysvarC1ock11111111111111111111111111111111")),
            ("loader", pk(LOADER)),
        ],
    )
}

#[test]
fn an_upgrade_runs_only_after_24_hours_and_can_be_cancelled() {
    let mut w = world();
    let (admin, now) = (w.admin, START + WEEK + 100);
    w.d.env.set_time(now);
    let t = target(&mut w, authority(), authority());

    let ix = schedule_ix(&w, &t);
    w.d.env.ok(&admin, &[ix]);
    let sched = w.d.env.account(&pda(VESOLVE, &[b"upgrade", t.program.as_ref()])).unwrap().data;
    assert_eq!(i64::from_le_bytes(sched[8 + 64 + 8..8 + 64 + 16].try_into().unwrap()), now + DAY);

    // one second early: refused; nothing changes
    w.d.env.set_time(now + DAY - 1);
    let early = w.d.env.send(&admin, &[execute_ix(&w, &t)]).unwrap_err();
    assert!(early.has("UpgradeNotDue"), "{:?}", early.logs);

    // cancel, then the same schedule can be made again
    let ix = cancel_ix(&w, &t);
    w.d.env.ok(&admin, &[ix]);
    assert!(w.d.env.account(&pda(VESOLVE, &[b"upgrade", t.program.as_ref()])).is_none_or(|a| a.data.is_empty() || a.lamports == 0));
    let late = w.d.env.send(&admin, &[execute_ix(&w, &t)]).unwrap_err();
    assert!(!late.logs.is_empty(), "no schedule, nothing to execute");

    w.d.env.set_time(now + 10);
    let ix = schedule_ix(&w, &t);
    w.d.env.ok(&admin, &[ix]);
    w.d.env.set_time(now + 10 + DAY);
    let ix = execute_ix(&w, &t);
    w.d.env.ok(&admin, &[ix]);
    let data = w.d.env.account(&t.program_data).unwrap().data;
    assert_eq!(&data[45..45 + t.new_image.len()], &t.new_image[..], "the buffer's program is now deployed");
    assert!(w.d.env.account(&pda(VESOLVE, &[b"upgrade", t.program.as_ref()])).is_none_or(|a| a.data.is_empty() || a.lamports == 0));
}

#[test]
fn only_the_admin_schedules_and_the_timelock_pda_must_hold_both_authorities() {
    let mut w = world();
    let admin = w.admin;
    w.d.env.set_time(START + WEEK + 100);

    // the program's authority is someone else: the timelock would not bind
    let t = target(&mut w, unique(), authority());
    let ix = schedule_ix(&w, &t);
    let err = w.d.env.send(&admin, &[ix]).unwrap_err();
    assert!(err.has("UpgradeAuthorityMismatch"), "{:?}", err.logs);

    // the buffer is still writable by someone else
    let t = target(&mut w, authority(), unique());
    let ix = schedule_ix(&w, &t);
    let err = w.d.env.send(&admin, &[ix]).unwrap_err();
    assert!(err.has("InvalidUpgradeBuffer"), "{:?}", err.logs);

    // a stranger cannot schedule or cancel
    let t = target(&mut w, authority(), authority());
    let stranger = unique();
    w.d.env.fund(&stranger);
    let mut ix = schedule_ix(&w, &t);
    ix.accounts[0].pubkey = stranger;
    assert!(w.d.env.send(&stranger, &[ix]).is_err());

    // one schedule per program at a time
    let ix = schedule_ix(&w, &t);
    w.d.env.ok(&admin, &[ix]);
    let ix = schedule_ix(&w, &t);
    assert!(w.d.env.send(&admin, &[ix]).is_err());
}
