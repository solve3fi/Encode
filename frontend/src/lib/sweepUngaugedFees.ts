import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountIdempotentInstruction,
	createTransferInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
	PublicKey,
	SystemProgram,
	type TransactionInstruction,
} from "@solana/web3.js";
import type { useVesolveProgram } from "@/hooks/useVesolveProgram";

/** The Treasury set in AdminConfig, or null while it is unset. */
export async function fetchTreasury(
	program: ReturnType<typeof useVesolveProgram>,
): Promise<PublicKey | null> {
	const [adminConfig] = PublicKey.findProgramAddressSync(
		[Buffer.from("admin_config")],
		program.programId,
	);
	const accounts = program.account as unknown as Record<
		string,
		{
			fetchNullable: (
				address: PublicKey,
			) => Promise<{ treasury: PublicKey } | null>;
		}
	>;
	const raw = await accounts.adminConfig.fetchNullable(adminConfig);
	return raw && !raw.treasury.equals(PublicKey.default) ? raw.treasury : null;
}

/**
 * `sweep_ungauged_pool_fees`: sends the protocol's 5% share of a pool without an
 * active gauge to the Treasury. Must run before a gauge is activated on a pool
 * that holds uncollected protocol fees, otherwise activation is refused.
 */
export function sweepUngaugedPoolFeesAccounts({
	admin,
	protocol,
	pool,
	solvesConfig,
	tokenMintA,
	tokenMintB,
	tokenVaultA,
	tokenVaultB,
	treasury,
	dexProgramId,
}: {
	admin: PublicKey;
	protocol: PublicKey;
	pool: PublicKey;
	solvesConfig: PublicKey;
	tokenMintA: PublicKey;
	tokenMintB: PublicKey;
	tokenVaultA: PublicKey;
	tokenVaultB: PublicKey;
	treasury: PublicKey;
	dexProgramId: PublicKey;
}) {
	return {
		caller: admin,
		admin,
		protocol,
		solvesConfig,
		pool,
		tokenMintA,
		tokenMintB,
		tokenVaultA,
		tokenVaultB,
		treasury,
		treasuryTokenAccountA: getAssociatedTokenAddressSync(
			tokenMintA,
			treasury,
			true,
		),
		treasuryTokenAccountB: getAssociatedTokenAddressSync(
			tokenMintB,
			treasury,
			true,
		),
		solveProgram: dexProgramId,
		tokenProgram: TOKEN_PROGRAM_ID,
		associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
		systemProgram: SystemProgram.programId,
	};
}

/** The rate the program sets on removal; the only rate `sweep_ungauged_pool_fees` accepts. */
export const PROGRAM_UNGAUGED_PROTOCOL_FEE_RATE = 500;

type OwedFeePool = {
	protocolFeeRate: number;
	tokenMintA: PublicKey;
	tokenMintB: PublicKey;
	protocolFeeOwedA: { toString(): string };
	protocolFeeOwedB: { toString(): string };
};

/**
 * Instructions that clear a pool's owed protocol fees so a gauge can be switched on (the program
 * refuses activation while counters are nonzero).
 *
 * - At the program's ungauged rate (5%) the Treasury share is swept with `sweep_ungauged_pool_fees`.
 * - At any other rate (the epoch keeper resets removed gauges to 0%, a pool may carry an LP-incentive
 *   rate) that sweep is refused, so the owed fees are collected through the DEX with the collect
 *   authority and forwarded to the Treasury. The counters are zeroed by the collect itself; anything
 *   that accrues between reading the pool and landing the transaction stays with the signer.
 */
export async function buildOwedFeeSettlement({
	pool,
	admin,
	treasury,
	sweep,
	collect,
}: {
	pool: OwedFeePool;
	admin: PublicKey;
	treasury: PublicKey;
	sweep: () => Promise<TransactionInstruction>;
	collect: (destinations: { a: PublicKey; b: PublicKey }) => Promise<TransactionInstruction>;
}): Promise<TransactionInstruction[]> {
	if (pool.protocolFeeRate === PROGRAM_UNGAUGED_PROTOCOL_FEE_RATE) {
		return [await sweep()];
	}
	const own = (mint: PublicKey) => getAssociatedTokenAddressSync(mint, admin, true);
	const theirs = (mint: PublicKey) => getAssociatedTokenAddressSync(mint, treasury, true);
	const ata = (mint: PublicKey, owner: PublicKey) =>
		createAssociatedTokenAccountIdempotentInstruction(
			admin,
			getAssociatedTokenAddressSync(mint, owner, true),
			owner,
			mint,
			TOKEN_PROGRAM_ID,
			ASSOCIATED_TOKEN_PROGRAM_ID,
		);
	const instructions: TransactionInstruction[] = [
		ata(pool.tokenMintA, admin),
		ata(pool.tokenMintB, admin),
		ata(pool.tokenMintA, treasury),
		ata(pool.tokenMintB, treasury),
		await collect({ a: own(pool.tokenMintA), b: own(pool.tokenMintB) }),
	];
	const owedA = BigInt(pool.protocolFeeOwedA.toString());
	const owedB = BigInt(pool.protocolFeeOwedB.toString());
	if (owedA > BigInt(0))
		instructions.push(
			createTransferInstruction(own(pool.tokenMintA), theirs(pool.tokenMintA), admin, owedA),
		);
	if (owedB > BigInt(0))
		instructions.push(
			createTransferInstruction(own(pool.tokenMintB), theirs(pool.tokenMintB), admin, owedB),
		);
	return instructions;
}
