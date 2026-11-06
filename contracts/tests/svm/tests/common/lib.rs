//! T1 harness: loads the compiled programs into LiteSVM and talks to them with
//! hand-built Anchor instructions, so the test graph stays independent of the
//! Anchor/Solana versions the programs themselves use.
//!
//! Programs are read from `SBF_OUT_DIR` (default `../../target/deploy`), which
//! is where `cargo build-sbf` / `anchor build` put them.
use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_message::Message;
use solana_transaction::Transaction;

pub type Pubkey = Address;

pub const VESOLVE: &str = "HMqzJpD85Z74R1vhor9LWm6KFhK6tYVChzjzyBRyjUmN";
pub const SOLVE: &str = "HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK";
/// Compiled-in bootstrap admin of vesolve (programs/vesolve/src/auth/admin.rs).
pub const BOOTSTRAP_ADMIN: &str = "4j3VFftvWC4R2KxbF4R8bJKz2Mxk3m6a2RjkEu8ySVPs";
pub const TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const ATA_PROGRAM: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
pub const SYSTEM_PROGRAM: &str = "11111111111111111111111111111111";
pub fn b(v: bool) -> u8 {
    u8::from(v)
}

pub fn key_bytes(k: &Pubkey) -> Vec<u8> {
    k.as_ref().to_vec()
}

pub const WEEK: i64 = 7 * 24 * 60 * 60;

pub fn pk(s: &str) -> Pubkey {
    s.parse().unwrap()
}

pub fn unique() -> Pubkey {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(1);
    let mut b = [7u8; 32];
    b[..8].copy_from_slice(&N.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    Pubkey::new_from_array(b)
}

pub fn pda(program: &str, seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &pk(program)).0
}

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), pk(TOKEN_PROGRAM).as_ref(), mint.as_ref()],
        &pk(ATA_PROGRAM),
    )
    .0
}

pub fn disc(name: &str) -> [u8; 8] {
    let h = Sha256::digest(format!("global:{name}").as_bytes());
    h[..8].try_into().unwrap()
}

/// Anchor instruction data: discriminator then pre-encoded borsh args.
pub fn data(name: &str, args: &[u8]) -> Vec<u8> {
    let mut d = disc(name).to_vec();
    d.extend_from_slice(args);
    d
}

pub fn meta(key: Pubkey, signer: bool, writable: bool) -> AccountMeta {
    if writable {
        AccountMeta::new(key, signer)
    } else {
        AccountMeta::new_readonly(key, signer)
    }
}

pub struct Idl(serde_json::Value);

impl Idl {
    pub fn vesolve() -> Self {
        Idl(serde_json::from_str(include_str!("../../idl/vesolve.json")).unwrap())
    }
    pub fn solve() -> Self {
        Idl(serde_json::from_str(include_str!("../../idl/solve.json")).unwrap())
    }

    /// Builds the instruction with accounts ordered, flagged and (where the IDL
    /// fixes an address) filled in from the IDL. `accounts` supplies the rest by
    /// name; a missing name panics so tests cannot silently drop an account.
    pub fn ix(&self, program: &str, name: &str, args: &[u8], accounts: &[(&str, Pubkey)]) -> Instruction {
        let ixs = self.0["instructions"].as_array().unwrap();
        let def = ixs.iter().find(|i| i["name"] == name).unwrap_or_else(|| panic!("no instruction {name} in IDL"));
        let metas = def["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| {
                let n = a["name"].as_str().unwrap();
                let key = accounts
                    .iter()
                    .find(|(k, _)| *k == n)
                    .map(|(_, v)| *v)
                    .or_else(|| a["address"].as_str().map(pk))
                    .unwrap_or_else(|| panic!("{name}: no account supplied for {n}"));
                meta(key, a["signer"].as_bool().unwrap_or(false), a["writable"].as_bool().unwrap_or(false))
            })
            .collect();
        for (k, _) in accounts {
            assert!(def["accounts"].as_array().unwrap().iter().any(|a| a["name"] == *k), "{name}: unknown account {k}");
        }
        Instruction { program_id: pk(program), accounts: metas, data: data(name, args) }
    }
}

pub struct Env {
    pub svm: LiteSVM,
    pub payer: Pubkey,
}

#[derive(Debug)]
pub struct Failure {
    pub logs: Vec<String>,
    pub err: String,
}

impl Failure {
    pub fn has(&self, text: &str) -> bool {
        self.logs.iter().any(|l| l.contains(text))
    }
}

impl Env {
    /// Signature checks are off, so a test can sign as any key (including the
    /// compiled-in admins whose private keys nobody here holds); programs only
    /// look at the signer flag.
    pub fn new() -> Self {
        let dir = std::env::var("SBF_OUT_DIR").unwrap_or_else(|_| format!("{}/../../target/deploy", env!("CARGO_MANIFEST_DIR")));
        let mut svm = LiteSVM::new().with_sigverify(false);
        for (id, file) in [(VESOLVE, "vesolve.so"), (SOLVE, "solve.so")] {
            let bytes = std::fs::read(format!("{dir}/{file}"))
                .unwrap_or_else(|e| panic!("missing {dir}/{file}: {e} (run cargo build-sbf first)"));
            svm.add_program(pk(id), &bytes).unwrap();
        }
        let payer = pk(BOOTSTRAP_ADMIN);
        svm.airdrop(&payer, 1_000_000_000_000).unwrap();
        Env { svm, payer }
    }

    pub fn fund(&mut self, who: &Pubkey) {
        self.svm.airdrop(who, 10_000_000_000).unwrap();
    }

    pub fn set_time(&mut self, unix: i64) {
        let mut clock = self.svm.get_sysvar::<solana_clock::Clock>();
        clock.unix_timestamp = unix;
        self.svm.set_sysvar(&clock);
    }

    pub fn send(&mut self, signer: &Pubkey, ixs: &[Instruction]) -> Result<Vec<String>, Failure> {
        self.svm.expire_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(signer), &self.svm.latest_blockhash());
        let tx = Transaction::new_unsigned(msg);
        match self.svm.send_transaction(tx) {
            Ok(meta) => Ok(meta.logs),
            Err(f) => Err(Failure { logs: f.meta.logs, err: format!("{:?}", f.err) }),
        }
    }

    pub fn ok(&mut self, signer: &Pubkey, ixs: &[Instruction]) -> Vec<String> {
        self.send(signer, ixs).unwrap_or_else(|f| panic!("tx failed: {} \n{}", f.err, f.logs.join("\n")))
    }

    pub fn account(&self, key: &Pubkey) -> Option<Account> {
        self.svm.get_account(key)
    }

    /// Installs an initialised SPL mint (6 or 9 decimals etc.).
    pub fn set_mint(&mut self, mint: &Pubkey, authority: &Pubkey, decimals: u8) {
        let mut d = vec![0u8; 82];
        d[0..4].copy_from_slice(&1u32.to_le_bytes());
        d[4..36].copy_from_slice(authority.as_ref());
        d[44] = decimals;
        d[45] = 1;
        self.svm
            .set_account(*mint, Account { lamports: 1_461_600, data: d, owner: pk(TOKEN_PROGRAM), executable: false, rent_epoch: 0 })
            .unwrap();
    }

    /// Installs an initialised SPL token account.
    pub fn set_token_account(&mut self, key: &Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) {
        let mut d = vec![0u8; 165];
        d[0..32].copy_from_slice(mint.as_ref());
        d[32..64].copy_from_slice(owner.as_ref());
        d[64..72].copy_from_slice(&amount.to_le_bytes());
        d[108] = 1;
        self.svm
            .set_account(*key, Account { lamports: 2_039_280, data: d, owner: pk(TOKEN_PROGRAM), executable: false, rent_epoch: 0 })
            .unwrap();
    }

    pub fn token_balance(&self, token_account: &Pubkey) -> u64 {
        let a = self.account(token_account).expect("token account missing");
        u64::from_le_bytes(a.data[64..72].try_into().unwrap())
    }
}

impl Default for Env {
    fn default() -> Self {
        Self::new()
    }
}

pub mod dex {
    use super::*;
    pub const SPACING: u16 = 64;

    pub struct Dex {
        pub env: Env,
        pub idl: Idl,
        pub config: Pubkey,
        pub pool: Pubkey,
        pub fee_authority: Pubkey,
        pub owner: Pubkey,
        pub mint_a: Pubkey,
        pub mint_b: Pubkey,
        pub vault_a: Pubkey,
        pub vault_b: Pubkey,
        pub user_a: Pubkey,
        pub user_b: Pubkey,
        pub position: Pubkey,
        pub position_token: Pubkey,
        pub arrays: [Pubkey; 5],
    }

    pub fn tick_array(pool: &Pubkey, start: i32) -> Pubkey {
        pda(SOLVE, &[b"tick_array", pool.as_ref(), start.to_string().as_bytes()])
    }

    pub fn setup() -> Dex {
        setup_with(None)
    }

    /// `fee_authority`: the DEX fee authority; a fresh key when None.
    pub fn setup_with(fee_authority: Option<Pubkey>) -> Dex {
        let idl = Idl::solve();
        let mut env = Env::new();
        let funder = env.payer; // compiled-in DEX admin as well
        let fee_authority = fee_authority.unwrap_or_else(unique);
        let owner = unique();
        env.fund(&fee_authority);
        env.fund(&owner);
        let (mut mint_a, mut mint_b) = (unique(), unique());
        if mint_a.as_ref() > mint_b.as_ref() {
            std::mem::swap(&mut mint_a, &mut mint_b);
        }
        env.set_mint(&mint_a, &owner, 6);
        env.set_mint(&mint_b, &owner, 6);

        let config = unique();
        let mut args = key_bytes(&fee_authority);
        args.extend(key_bytes(&fee_authority));
        args.extend(key_bytes(&fee_authority));
        args.extend(0u16.to_le_bytes());
        let ix = idl.ix(SOLVE, "initialize_config", &args, &[("config", config), ("funder", funder)]);
        env.ok(&funder, &[ix]);

        let fee_tier = pda(SOLVE, &[b"fee_tier", config.as_ref(), &SPACING.to_le_bytes()]);
        let mut args = SPACING.to_le_bytes().to_vec();
        args.extend(3000u16.to_le_bytes());
        let ix = idl.ix(SOLVE, "initialize_fee_tier", &args, &[("config", config), ("fee_tier", fee_tier), ("funder", funder), ("fee_authority", fee_authority)]);
        env.ok(&funder, &[ix]);

        let pool = pda(SOLVE, &[b"solve", config.as_ref(), mint_a.as_ref(), mint_b.as_ref(), &SPACING.to_le_bytes()]);
        let (vault_a, vault_b) = (unique(), unique());
        let mut args = vec![255u8]; // bump, recomputed by the program
        args.extend(SPACING.to_le_bytes());
        args.extend((1u128 << 64).to_le_bytes()); // price 1, tick 0
        let ix = idl.ix(
            SOLVE,
            "initialize_pool",
            &args,
            &[("solves_config", config), ("token_mint_a", mint_a), ("token_mint_b", mint_b), ("funder", funder), ("solve", pool), ("token_vault_a", vault_a), ("token_vault_b", vault_b), ("fee_tier", fee_tier)],
        );
        env.ok(&funder, &[ix]);

        let starts = [-11_264i32, -5_632, 0, 5_632, 11_264];
        let arrays = starts.map(|s| tick_array(&pool, s));
        for (s, a) in starts.iter().zip(arrays.iter()) {
            let ix = idl.ix(SOLVE, "initialize_tick_array", &s.to_le_bytes(), &[("solve", pool), ("funder", funder), ("tick_array", *a)]);
            env.ok(&funder, &[ix]);
        }

        let position_mint = unique();
        let position = pda(SOLVE, &[b"position", position_mint.as_ref()]);
        let position_token = ata(&owner, &position_mint);
        let mut args = vec![255u8];
        args.extend((-640i32).to_le_bytes());
        args.extend(640i32.to_le_bytes());
        let ix = idl.ix(
            SOLVE,
            "open_position",
            &args,
            &[("funder", owner), ("owner", owner), ("position", position), ("position_mint", position_mint), ("position_token_account", position_token), ("solve", pool)],
        );
        env.ok(&owner, &[ix]);

        let (user_a, user_b) = (unique(), unique());
        env.set_token_account(&user_a, &mint_a, &owner, 1_000_000_000_000);
        env.set_token_account(&user_b, &mint_b, &owner, 1_000_000_000_000);
        Dex { env, idl, config, pool, fee_authority, owner, mint_a, mint_b, vault_a, vault_b, user_a, user_b, position, position_token, arrays }
    }

    impl Dex {
        pub fn liquidity_ix(&self, name: &str, amount: u128) -> solana_instruction::Instruction {
            let mut args = amount.to_le_bytes().to_vec();
            args.extend(u64::MAX.to_le_bytes()); // max (increase) / min (decrease) bound
            args.extend(u64::MAX.to_le_bytes());
            if name == "decrease_liquidity" {
                args.truncate(16);
                args.extend(0u64.to_le_bytes());
                args.extend(0u64.to_le_bytes());
            }
            self.idl.ix(
                SOLVE,
                name,
                &args,
                &[
                    ("solve", self.pool),
                    ("position_authority", self.owner),
                    ("position", self.position),
                    ("position_token_account", self.position_token),
                    ("token_owner_account_a", self.user_a),
                    ("token_owner_account_b", self.user_b),
                    ("token_vault_a", self.vault_a),
                    ("token_vault_b", self.vault_b),
                    ("tick_array_lower", self.arrays[1]),
                    ("tick_array_upper", self.arrays[2]),
                    ("solves_config", self.config),
                ],
            )
        }

        pub fn swap_ix(&self, amount: u64, a_to_b: bool) -> solana_instruction::Instruction {
            let mut args = amount.to_le_bytes().to_vec();
            args.extend(0u64.to_le_bytes());
            // price limit: MIN_SQRT_PRICE_X64 + 1 going down, MAX - 1 going up
            args.extend(if a_to_b { 4_295_048_016u128 } else { 79_226_673_515_401_279_992_447_579_055u128 }.to_le_bytes());
            args.push(1); // amount is input
            args.push(b(a_to_b));
            // arrays follow the current tick: the one holding it, then the next ones in the swap direction
            let tick = i32::from_le_bytes(self.env.account(&self.pool).unwrap().data[81..85].try_into().unwrap());
            let held = ((tick.div_euclid(5_632) * 5_632 + 11_264) / 5_632) as usize;
            let arrays = if a_to_b { [self.arrays[held], self.arrays[held - 1], self.arrays[held - 2]] } else { [self.arrays[held], self.arrays[held + 1], self.arrays[held + 2]] };
            self.idl.ix(
                SOLVE,
                "swap",
                &args,
                &[
                    ("token_authority", self.owner),
                    ("solve", self.pool),
                    ("token_owner_account_a", self.user_a),
                    ("token_vault_a", self.vault_a),
                    ("token_owner_account_b", self.user_b),
                    ("token_vault_b", self.vault_b),
                    ("tick_array_0", arrays[0]),
                    ("tick_array_1", arrays[1]),
                    ("tick_array_2", arrays[2]),
                    ("oracle", pda(SOLVE, &[b"oracle", self.pool.as_ref()])),
                    ("solves_config", self.config),
                ],
            )
        }

        pub fn set_pauses(&mut self, who: Pubkey, swaps: bool, liquidity: bool) -> Result<Vec<String>, Failure> {
            let ix = self.idl.ix(SOLVE, "set_trading_pauses", &[b(swaps), b(liquidity)], &[("solves_config", self.config), ("fee_authority", who)]);
            self.env.send(&who, &[ix])
        }
    }

}

pub mod gauge_world {
    use super::dex::*;
    use super::*;

    pub const START: i64 = 1_800_000_000 / WEEK * WEEK;
    pub const HOUR: i64 = 3_600;

    pub fn protocol() -> Pubkey {
        pda(VESOLVE, &[b"protocol"])
    }
    pub fn epoch(n: u64) -> Pubkey {
        pda(VESOLVE, &[b"epoch_data", &n.to_le_bytes()])
    }
    pub fn admin_config() -> Pubkey {
        pda(VESOLVE, &[b"admin_config"])
    }
    pub fn treasury_change() -> Pubkey {
        pda(VESOLVE, &[b"treasury_change"])
    }
    pub fn keeper_config() -> Pubkey {
        pda(VESOLVE, &[b"keeper_config"])
    }
    pub fn supply(env: &Env, mint: &Pubkey) -> u64 {
        u64::from_le_bytes(env.account(mint).unwrap().data[36..44].try_into().unwrap())
    }

    /// Replaces an epoch's vote result with one gauge holding all the weight.
    pub fn patch_votes(env: &mut Env, epoch_no: u64, gauge: &Pubkey, weight: u64) {
        let mut acc = env.account(&epoch(epoch_no)).unwrap();
        let len = acc.data.len();
        let bump = acc.data[8 + 40 + 4 + 4];
        let mut d = acc.data[..8 + 24].to_vec(); // discriminator, epoch, start, end
        d.extend(weight.to_le_bytes()); // total_voting_power
        d.extend(weight.to_le_bytes()); // total_votes
        d.extend(1u32.to_le_bytes());
        d.extend(gauge.as_ref());
        d.extend(weight.to_le_bytes()); // weight
        d.extend(weight.to_le_bytes()); // votes
        d.extend(0u32.to_le_bytes()); // no bribes
        d.push(bump);
        d.resize(len, 0);
        acc.data = d;
        env.svm.set_account(epoch(epoch_no), acc).unwrap();
    }

    /// Hands the DEX fee authority and protocol-fee collection authority from `current` to the Protocol PDA.
    pub fn hand_dex_authorities_to_protocol(d: &mut Dex, current: &Pubkey) {
        let fee = d.idl.ix(SOLVE, "set_fee_authority", &[], &[("solves_config", d.config), ("fee_authority", *current), ("new_fee_authority", protocol())]);
        let collect = d.idl.ix(
            SOLVE,
            "set_collect_protocol_fees_authority",
            &[],
            &[("solves_config", d.config), ("collect_protocol_fees_authority", *current), ("new_collect_protocol_fees_authority", protocol())],
        );
        d.env.ok(current, &[fee, collect]);
        d.fee_authority = protocol();
    }

    /// The Treasury in AdminConfig, setting a fresh one first if none is set yet.
    pub fn treasury_of(d: &mut Dex, idl: &Idl, admin: &Pubkey) -> Pubkey {
        if let Some(acc) = d.env.account(&admin_config()) {
            let t = Pubkey::try_from(&acc.data[52..84]).unwrap();
            if t != Pubkey::default() {
                return t;
            }
        }
        let t = unique();
        let ix = idl.ix(VESOLVE, "set_treasury", &key_bytes(&t), &[("admin", *admin), ("protocol", protocol()), ("admin_config", admin_config()), ("treasury_change", treasury_change())]);
        d.env.ok(admin, &[ix]);
        t
    }

    /// settle_removed_gauge_fees for the World pool: a removal-due gauge's owed fees go to the Treasury.
    pub fn settle_removed_ix(idl: &Idl, d: &Dex, caller: Pubkey, gauge: Pubkey, treasury: Pubkey) -> solana_instruction::Instruction {
        let current = u64::from_le_bytes(d.env.account(&protocol()).unwrap().data[96..104].try_into().unwrap());
        idl.ix(
            VESOLVE,
            "settle_removed_gauge_fees",
            &[],
            &[
                ("caller", caller), ("protocol", protocol()), ("gauge", gauge), ("epoch", epoch(current)), ("solves_config", d.config),
                ("pool", d.pool), ("token_mint_a", d.mint_a), ("token_mint_b", d.mint_b), ("token_vault_a", d.vault_a), ("token_vault_b", d.vault_b),
                ("treasury", treasury), ("treasury_token_account_a", ata(&treasury, &d.mint_a)), ("treasury_token_account_b", ata(&treasury, &d.mint_b)),
                ("admin_config", admin_config()), ("solve_program", pk(SOLVE)),
            ],
        )
    }

    pub struct World {
        pub d: Dex,
        pub idl: Idl,
        pub admin: Pubkey,
        pub solv3: Pubkey,
        pub gauge: Pubkey,
        pub native: Pubkey,
        pub reward_vault: Pubkey,
    }

    /// Both programs initialised, a pool with a gauge activated on it, and the
    /// clock inside epoch 1 (epoch 0's votes are not patched yet).
    pub fn world() -> World {
    let vesolve = Idl::vesolve();
    let admin = pk(BOOTSTRAP_ADMIN);
    let mut d = setup_with(Some(admin)); // vesolve's Admin is also the DEX fee authority
    let solv3 = unique();

    // vesolve with its own SOLV3 mint (authority = the protocol PDA)
    d.env.set_time(START + 10);
    let mut args = key_bytes(&solv3);
    args.extend(WEEK.to_le_bytes());
    let ix = vesolve.ix(VESOLVE, "initialize", &args, &[("payer", admin), ("protocol", protocol()), ("epoch", epoch(0))]);
    d.env.ok(&admin, &[ix]);
    d.env.set_mint(&solv3, &protocol(), 9);

    // The DEX's fee and protocol-fee collection authorities belong to the vesolve Protocol PDA (review H-2),
    // handed over by the Admin once, as on Devnet.
    hand_dex_authorities_to_protocol(&mut d, &admin);

    // gauge on the pool, activated
    let mut args = key_bytes(&d.pool);
    args.extend(key_bytes(&d.mint_a));
    args.extend(key_bytes(&d.mint_b));
    args.extend(SPACING.to_le_bytes());
    let gauge = pda(VESOLVE, &[b"gauge", protocol().as_ref(), d.pool.as_ref()]);
    let ix = vesolve.ix(VESOLVE, "create_gauge", &args, &[("admin", admin), ("protocol", protocol()), ("gauge", gauge)]);
    d.env.ok(&admin, &[ix]);

    let (lo, hi) = if d.mint_a.to_bytes() < d.mint_b.to_bytes() { (d.mint_a, d.mint_b) } else { (d.mint_b, d.mint_a) };
    let mut sargs = key_bytes(&lo);
    sargs.extend(key_bytes(&hi));
    let pair = pda(VESOLVE, &[b"pair", lo.as_ref(), hi.as_ref()]);
    let sched = vesolve.ix(
        VESOLVE,
        "schedule_gauge_activation",
        &sargs,
        &[
            ("admin", admin),
            ("protocol", protocol()),
            ("gauge", gauge),
            ("pool", d.pool),
            ("pair", pair),
            ("occupant", pk(VESOLVE)),
            ("system_program", pk(SYSTEM_PROGRAM)),
            ("admin_config", admin_config()),
        ],
    );
    d.env.ok(&admin, &[sched]);

    // epoch 1 begins; liquidity is in place before the stream starts
    let t1 = START + WEEK;
    d.env.set_time(t1 + 5);
    let roll = vesolve.ix(VESOLVE, "update_epoch", &[], &[("caller", admin), ("protocol", protocol()), ("epoch", epoch(1))]);
    d.env.ok(&admin, &[roll]);
    let native = pda(VESOLVE, &[b"native_gauge", gauge.as_ref()]);
    let legacy_reward = pda(VESOLVE, &[b"gauge_reward", gauge.as_ref()]);
    let reward_vault = pda(SOLVE, &[b"gauge_reward_vault", d.pool.as_ref()]);
    let configure = vesolve.ix(
        VESOLVE,
        "configure_native_gauge",
        &[1],
        &[
            ("caller", admin),
            ("protocol", protocol()),
            ("gauge", gauge),
            ("solves_config", d.config),
            ("pool", d.pool),
            ("token_mint_a", d.mint_a),
            ("token_mint_b", d.mint_b),
            ("native_gauge", native),
            ("legacy_reward", legacy_reward),
            ("reward_mint", solv3),
            ("legacy_vault", ata(&legacy_reward, &solv3)),
            ("reward_vault", reward_vault),
            ("solve_program", pk(SOLVE)),
            ("token_program", pk(TOKEN_PROGRAM)),
            ("admin_config", admin_config()),
        ],
    );
    d.env.ok(&admin, &[configure]);

    let add = d.liquidity_ix("increase_liquidity", 1_000_000_000);
    let owner = d.owner;
    d.env.ok(&owner, &[add]);

        World { d, idl: vesolve, admin, solv3, gauge, native, reward_vault }
    }
}
