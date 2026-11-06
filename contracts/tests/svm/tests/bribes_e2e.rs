//! Bribe lifecycle against the real programs: whitelist, cutoff, and the sweep
//! of bribes on gauges nobody voted for.
use svm_tests::gauge_world::*;
use svm_tests::*;

struct Bribes {
    w: World,
    mint: Pubkey,
    briber: Pubkey,
    briber_tokens: Pubkey,
    treasury: Pubkey,
}

fn bribes() -> Bribes {
    let mut w = world();
    let (mint, briber) = (unique(), unique());
    w.d.env.fund(&briber);
    w.d.env.set_mint(&mint, &briber, 6);
    let briber_tokens = ata(&briber, &mint);
    w.d.env.set_token_account(&briber_tokens, &mint, &briber, 5_000_000);
    Bribes { w, mint, briber, briber_tokens, treasury: unique() }
}

impl Bribes {
    fn bribe_token(&self) -> Pubkey {
        pda(VESOLVE, &[b"bribe_token", self.mint.as_ref()])
    }
    fn vault(&self) -> Pubkey {
        pda(VESOLVE, &[b"vault", &1u64.to_le_bytes(), self.w.gauge.as_ref()])
    }
    fn set_token(&mut self, allowed: bool, paused: bool) {
        let ix = self.w.idl.ix(
            VESOLVE,
            "set_bribe_token",
            &[b(allowed), b(paused)],
            &[("admin", self.w.admin), ("protocol", protocol()), ("token_mint", self.mint), ("bribe_token", self.bribe_token())],
        );
        let admin = self.w.admin;
        self.w.d.env.ok(&admin, &[ix]);
    }
    fn create(&mut self, amount: u64) -> Result<Vec<String>, Failure> {
        let ix = self.w.idl.ix(
            VESOLVE,
            "create_bribe",
            &amount.to_le_bytes(),
            &[
                ("user", self.briber),
                ("protocol", protocol()),
                ("epoch", epoch(1)),
                ("gauge", self.w.gauge),
                ("vault", self.vault()),
                ("token_mint", self.mint),
                ("bribe_token", self.bribe_token()),
                ("bribe", pda(VESOLVE, &[b"bribe", self.w.gauge.as_ref(), self.mint.as_ref(), self.briber.as_ref()])),
                ("user_token_account", self.briber_tokens),
                ("bribe_token_account", ata(&self.vault(), &self.mint)),
                ("token_program", pk(TOKEN_PROGRAM)),
                ("admin_config", admin_config()),
            ],
        );
        let briber = self.briber;
        self.w.d.env.send(&briber, &[ix])
    }
    fn set_treasury(&mut self) {
        let ix = self.w.idl.ix(
            VESOLVE,
            "set_treasury",
            &key_bytes(&self.treasury),
            &[("admin", self.w.admin), ("protocol", protocol()), ("admin_config", admin_config()), ("treasury_change", treasury_change())],
        );
        let admin = self.w.admin;
        self.w.d.env.ok(&admin, &[ix]);
    }
    fn sweep(&mut self) -> Result<Vec<String>, Failure> {
        let ix = self.w.idl.ix(
            VESOLVE,
            "sweep_unvoted_bribe",
            &[],
            &[
                ("caller", self.w.admin),
                ("protocol", protocol()),
                ("gauge", self.w.gauge),
                ("epoch", epoch(1)),
                ("vault", self.vault()),
                ("token_mint", self.mint),
                ("bribe_vault_token_account", ata(&self.vault(), &self.mint)),
                ("treasury", self.treasury),
                ("treasury_token_account", ata(&self.treasury, &self.mint)),
                ("token_program", pk(TOKEN_PROGRAM)),
                ("admin_config", admin_config()),
            ],
        );
        let admin = self.w.admin;
        self.w.d.env.send(&admin, &[ix])
    }
}

#[test]
fn only_whitelisted_tokens_and_only_before_the_cutoff() {
    let mut b = bribes();
    let err = b.create(1_000_000).unwrap_err();
    assert!(err.has("AccountNotInitialized") && err.has("bribe_token"), "{:?}", err.logs);

    b.set_token(true, false);
    b.create(1_000_000).unwrap();
    assert_eq!(b.w.d.env.token_balance(&ata(&b.vault(), &b.mint)), 1_000_000);

    // delisting blocks new deposits only
    b.set_token(false, false);
    assert!(b.create(1_000).is_err());
    b.set_token(true, false);

    // 23:55 UTC Wednesday: five minutes before the epoch ends
    let end = START + 2 * WEEK;
    b.w.d.env.set_time(end - 301);
    b.create(1_000).unwrap();
    b.w.d.env.set_time(end - 299);
    let err = b.create(1_000).unwrap_err();
    assert!(err.has("BribeWindowClosed"), "{:?}", err.logs);
}

#[test]
fn unvoted_bribes_go_to_the_treasury_once_after_the_epoch_and_voted_ones_do_not() {
    let mut b = bribes();
    b.set_token(true, false);
    b.create(1_000_000).unwrap();
    let end = START + 2 * WEEK;

    // too early, and Treasury not configured yet
    b.w.d.env.set_time(end - 10);
    assert!(b.sweep().is_err());
    b.w.d.env.set_time(end + 1);
    let err = b.sweep().unwrap_err();
    assert!(err.has("Treasury has not been set"), "{:?}", err.logs);

    b.set_treasury();
    b.sweep().unwrap();
    assert_eq!(b.w.d.env.token_balance(&ata(&b.treasury, &b.mint)), 1_000_000);
    assert_eq!(b.w.d.env.token_balance(&ata(&b.vault(), &b.mint)), 0);
    assert!(b.sweep().is_err(), "the record is zeroed, so a second sweep fails");
}

#[test]
fn a_gauge_with_votes_keeps_its_bribes_for_its_voters() {
    let mut b = bribes();
    b.set_token(true, false);
    b.create(1_000_000).unwrap();
    b.set_treasury();
    // epoch 1 now has a vote for the gauge (bribes entry preserved by re-patching only weights)
    let mut acc = b.w.d.env.account(&epoch(1)).unwrap();
    let gw_len_at = 8 + 40;
    let bribes_part = acc.data[gw_len_at + 4..].to_vec(); // empty gauge_weights, then bribes + bump
    let mut d = acc.data[..8 + 24].to_vec();
    d.extend(500u64.to_le_bytes());
    d.extend(500u64.to_le_bytes());
    d.extend(1u32.to_le_bytes());
    d.extend(b.w.gauge.as_ref());
    d.extend(500u64.to_le_bytes());
    d.extend(500u64.to_le_bytes());
    d.extend(bribes_part);
    d.resize(acc.data.len(), 0);
    acc.data = d;
    b.w.d.env.svm.set_account(epoch(1), acc).unwrap();
    b.w.d.env.set_time(START + 2 * WEEK + 1);
    let err = b.sweep().unwrap_err();
    assert!(err.has("received votes"), "{:?}", err.logs);
}


#[test]
fn new_bribes_stop_when_removal_is_requested() {
    let mut b = bribes();
    b.set_token(true, false);
    b.create(1_000).unwrap();
    let (admin, gauge) = (b.w.admin, b.w.gauge);
    let ix = b.w.idl.ix(VESOLVE, "request_gauge_removal", &[], &[("admin", admin), ("protocol", protocol()), ("gauge", gauge), ("admin_config", admin_config())]);
    b.w.d.env.ok(&admin, &[ix]);
    let err = b.create(1_000).unwrap_err();
    assert!(err.has("GaugeInactive"), "{:?}", err.logs);
}

/// M-2 (fixed): one gauge takes at most 8 different bribe tokens per epoch, and the epoch holds up to 64 entries,
/// so dust bribes on a handful of pairs can no longer lock everyone else out for the epoch.
#[test]
fn m2_a_gauge_takes_at_most_eight_bribe_tokens_per_epoch() {
    let mut b = bribes();
    let mut first = None;
    for i in 0..9 {
        let mint = unique();
        first.get_or_insert(mint);
        let briber = b.briber;
        b.w.d.env.set_mint(&mint, &briber, 6);
        b.mint = mint;
        b.briber_tokens = ata(&briber, &mint);
        let tokens = b.briber_tokens;
        b.w.d.env.set_token_account(&tokens, &mint, &briber, 1_000);
        b.set_token(true, false);
        let res = b.create(1);
        if i < 8 {
            res.unwrap_or_else(|f| panic!("bribe token {i}: {:?}", f.logs));
        } else {
            assert!(res.unwrap_err().has("MaxBribesPerGaugeReached"), "the ninth token on one gauge is refused");
        }
    }
    // An existing pair can still be topped up.
    let mint = first.unwrap();
    b.mint = mint;
    b.briber_tokens = ata(&b.briber, &mint);
    b.create(1).expect("top-up of an existing token still works");
}
