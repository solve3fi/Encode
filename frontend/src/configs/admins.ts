import { PublicKey } from "@solana/web3.js";

// Mirrors programs/vesolve/src/auth/admin.rs's ADMINS allowlist exactly —
// the on-chain program is the real enforcement (every admin-gated
// instruction checks is_admin_key()); this list only drives client-side UI
// gating so a non-admin wallet doesn't see a form that's guaranteed to fail.
export const VESOLVE_ADMINS = [
	new PublicKey("4j3VFftvWC4R2KxbF4R8bJKz2Mxk3m6a2RjkEu8ySVPs"),
	new PublicKey("HGUPXpPUhD6PiTSWexebRSsgCT1uDAgiKk2DvdRHsq6o"),
];

export const isVesolveAdmin = (wallet: PublicKey | null | undefined): boolean =>
	Boolean(wallet && VESOLVE_ADMINS.some((admin) => admin.equals(wallet)));
