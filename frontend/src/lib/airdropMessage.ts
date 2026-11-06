// Shared between client (AirdropClaimPanel, signs this) and server
// (/api/airdrop/claim, recomputes and checks against it) — must stay
// byte-identical on both sides, so it lives outside lib/server/.
export const buildAirdropClaimMessage = (amount: number, solanaAddress: string) =>
	`Claim ${amount} SOLV3 airdrop to Solana address ${solanaAddress}`;
