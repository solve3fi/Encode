use anchor_lang::prelude::*;

// Same hardcoded admin set used to gate privileged actions in the `solve`
// program. Only one of these keys may perform the one-time mint
// initialization, preventing a front-running attacker from claiming
// permanent mint authority immediately after deployment.
pub const ADMINS: [Pubkey; 2] = [
    pubkey!("2jiPD8xgwuqhg4rL2Cn8zk8VPVxoPMK6A6TKyRUpYdid"),
    pubkey!("4j3VFftvWC4R2KxbF4R8bJKz2Mxk3m6a2RjkEu8ySVPs"),
];

pub fn is_admin_key(maybe_admin: &Pubkey) -> bool {
    ADMINS.iter().any(|admin| maybe_admin.eq(admin))
}
