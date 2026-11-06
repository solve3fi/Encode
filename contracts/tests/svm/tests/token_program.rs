//! SOLV3 token program. The mint and its config are written straight into state in the shape the live Devnet
//! mint has (initialize_mint needs the metadata program).
use sha2::{Digest, Sha256};
use solana_instruction::Instruction;
use svm_tests::*;

const TOKEN_ID: &str = "CKRSmDf3n1ZsAc91YyRyCwWLoNShZ4xi2nWESMbDw7Pw";

fn account_disc(name: &str) -> [u8; 8] {
    Sha256::digest(format!("account:{name}").as_bytes())[..8].try_into().unwrap()
}

fn freeze_authority(env: &Env, mint: &Pubkey) -> Option<Pubkey> {
    let d = env.account(mint).unwrap().data;
    (d[46..50] == 1u32.to_le_bytes()).then(|| Pubkey::try_from(&d[50..82]).unwrap())
}

/// L-1 (fixed): the mint config authority can remove the SOLV3 freeze authority, once and for good; nobody else can.
#[test]
fn l1_freeze_authority_can_be_removed_by_the_config_authority_only() {
    let mut env = Env::new();
    let dir = std::env::var("SBF_OUT_DIR").unwrap_or_else(|_| format!("{}/../../target/deploy", env!("CARGO_MANIFEST_DIR")));
    env.svm.add_program(pk(TOKEN_ID), &std::fs::read(format!("{dir}/token.so")).unwrap()).unwrap();

    let authority = unique();
    env.fund(&authority);
    let mint = pda(TOKEN_ID, &[b"mint"]);
    let config = pda(TOKEN_ID, &[b"mint_config", mint.as_ref()]);
    let config_bump = Pubkey::find_program_address(&[b"mint_config", mint.as_ref()], &pk(TOKEN_ID)).1;

    // Mint: authority handed to some other key (the vesolve Protocol PDA on live), freeze authority = the mint PDA.
    env.set_mint(&mint, &unique(), 9);
    let mut m = env.account(&mint).unwrap();
    m.data[46..50].copy_from_slice(&1u32.to_le_bytes());
    m.data[50..82].copy_from_slice(mint.as_ref());
    env.svm.set_account(mint, m).unwrap();
    assert_eq!(freeze_authority(&env, &mint), Some(mint));

    let mut c = account_disc("MintConfig").to_vec();
    c.extend(key_bytes(&authority));
    c.extend(0u32.to_le_bytes()); // no minters
    c.extend(0u64.to_le_bytes());
    c.push(config_bump);
    c.resize(8 + 32 + 4 + 32 * 10 + 8 + 1, 0);
    env.svm
        .set_account(config, solana_account::Account { lamports: 5_000_000, data: c, owner: pk(TOKEN_ID), executable: false, rent_epoch: 0 })
        .unwrap();

    let revoke = |who: Pubkey| Instruction {
        program_id: pk(TOKEN_ID),
        accounts: vec![meta(who, true, false), meta(mint, false, true), meta(config, false, false), meta(pk(TOKEN_PROGRAM), false, false)],
        data: data("revoke_freeze_authority", &[]),
    };
    let stranger = unique();
    env.fund(&stranger);
    assert!(env.send(&stranger, &[revoke(stranger)]).is_err(), "only the config authority");
    env.ok(&authority, &[revoke(authority)]);
    assert_eq!(freeze_authority(&env, &mint), None, "nobody can freeze SOLV3 any more");
    assert!(env.send(&authority, &[revoke(authority)]).is_err(), "and it cannot be set back");
}
