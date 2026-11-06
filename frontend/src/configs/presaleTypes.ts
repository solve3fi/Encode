// Presale allocations are keyed by Solana address directly (the wallet that
// sent the presale payment is also the claim destination — no separate
// cross-chain identity to reconcile, unlike the airdrop's EVM ledger).
export type PresaleAllocation = {
	solanaAddress: string; // the record key, base58, case-sensitive
	amountUsd: number; // USD value of the presale contribution
	veSolv3Amount: number; // human units (SOLV3) to lock — authoritative, from the reconciled sheet
	amountRaw?: string; // authoritative integer base units (9 decimals)
	minted: boolean; // SOLV3 transferred to solanaAddress's ATA
	mintedSignature?: string;
	mintedAt?: number;
	locked: boolean; // solanaAddress has since locked it via create_lock
	lockedSignature?: string;
	lockedAt?: number;
	// Same replay-guard shape as AirdropAllocation — see reservedLockAddress
	// in claim/route.ts for why this exists.
	reservedLockAddress?: string;
	reservedAt?: number;
};

export type PresaleAllocations = Record<string, PresaleAllocation>; // solanaAddress -> allocation
