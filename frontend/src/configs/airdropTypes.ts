export type AirdropAllocation = {
	ethAddress: string; // lowercased 0x address — the record key
	amount: number; // human units (SOLV3), summed across any duplicate-owner rows
	amountRaw?: string; // authoritative integer base units (9 decimals)
	partnerAmountsRaw?: Record<string, string>; // auditable per-partner base units
	solanaAddress?: string; // destination wallet, set once claimed
	minted: boolean; // SOLV3 transferred to solanaAddress's ATA
	mintedSignature?: string;
	mintedAt?: number;
	locked: boolean; // solanaAddress has since locked it via create_lock
	lockedSignature?: string;
	lockedAt?: number;
	// Set by POST /api/airdrop/claim before it returns a signed transaction,
	// so a second call for the same allocation is rejected even if the first
	// transaction is never submitted, /finalize is never called, or /finalize
	// fails — closing the replay window that existed when "already claimed"
	// was only recorded by the optional finalize step. See reservedLockAddress
	// in claim/route.ts for how a stale reservation is resolved.
	reservedLockAddress?: string;
	reservedRecipient?: string; // the Solana address the reserved transaction was built for
	reservedAt?: number;
};

export type AirdropAllocations = Record<string, AirdropAllocation>; // ethAddress (lowercase) -> allocation
