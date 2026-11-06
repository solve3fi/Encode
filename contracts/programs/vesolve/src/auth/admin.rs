use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;

pub const ADMINS: [Pubkey; 2] = [
    pubkey!("4j3VFftvWC4R2KxbF4R8bJKz2Mxk3m6a2RjkEu8ySVPs"),
    pubkey!("HGUPXpPUhD6PiTSWexebRSsgCT1uDAgiKk2DvdRHsq6o"),
];

pub fn is_admin_key(maybe_admin: &Pubkey) -> bool {
    ADMINS.iter().any(|admin| maybe_admin.eq(admin))
}

// The single signer allowed to cast votes on behalf of a lock enrolled in
// the public Auto-Vote program (see instructions/vote.rs and
// instructions/auto_vote.rs). A dedicated key rather than reusing ADMINS so
// rotating it doesn't touch admin access, and vice versa. Compiled in
// rather than admin-settable: changing who this keeper is requires a
// program upgrade, which is an acceptable tradeoff for how rarely it
// should ever need to change.
pub const AUTO_VOTE_KEEPER: Pubkey = pubkey!("2wW8zBanRBtSt8iHXPCbTi3ZXSDdaRXQc9kSUC7rbwYN");

pub fn is_auto_vote_keeper(maybe_keeper: &Pubkey) -> bool {
    AUTO_VOTE_KEEPER.eq(maybe_keeper)
}
